import type { Server } from "bun";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VOICE_TYPES,
  DEFAULT_MAX_USERS,
  DEFAULT_TTL_MS,
  isValidMaxUsers,
  isValidTtl,
  MAX_IMAGE_BYTES,
  MAX_MESSAGE_LENGTH,
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_TOPIC_LENGTH,
  RoomManager,
  type ChatMessage,
  type ClientSocket,
  type Room,
  type SocketData,
} from "./roomManager";
import { RateLimiter } from "./rateLimiter";

const clientRoot = new URL("../client/", import.meta.url);
const rooms = new RoomManager();
const ROOM_ID = /^[a-z0-9]{6,16}$/;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; frame-ancestors 'none'",
};

// Per-IP token bucket, throttles room creation so one client can't flood memory with rooms.
const createRoomLimiters = new Map<string, RateLimiter>();
function clientIp(request: Request, server: Server<SocketData>): string {
  return server.requestIP(request)?.address ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
function allowRoomCreation(ip: string): boolean {
  let limiter = createRoomLimiters.get(ip);
  if (!limiter) {
    limiter = new RateLimiter(5, 1 / 60); // 5 rooms burst, refills 1/min
    createRoomLimiters.set(ip, limiter);
  }
  return limiter.allow();
}
setInterval(() => { if (createRoomLimiters.size > 10_000) createRoomLimiters.clear(); }, 10 * 60_000).unref();

const sweepInterval = setInterval(() => rooms.destroyExpiredRooms(), 60_000).unref();

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...SECURITY_HEADERS } });
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value.trim() : null;
}

function parsePassword(raw: unknown): { password?: string; error?: string } {
  if (raw === undefined || raw === "") return {};
  const value = text(raw, MAX_PASSWORD_LENGTH);
  if (value === null) return { error: "Password must be 1-128 characters." };
  return { password: value };
}

/** Optional, free-text display label for a room (e.g. "Movie night plans"). */
function parseTopic(raw: unknown): { topic?: string; error?: string } {
  if (raw === undefined || raw === "") return {};
  const value = text(raw, MAX_TOPIC_LENGTH);
  if (value === null) return { error: `Room name must be 1-${MAX_TOPIC_LENGTH} characters.` };
  return { topic: value.replace(/[<>]/g, "") };
}

function parseTtl(raw: unknown): { ttlMs: number; error?: string } {
  if (raw === undefined) return { ttlMs: DEFAULT_TTL_MS };
  if (typeof raw !== "number" || !isValidTtl(raw)) return { ttlMs: DEFAULT_TTL_MS, error: "Invalid room lifetime." };
  return { ttlMs: raw };
}

function parseMaxUsers(raw: unknown): { maxUsers: number; error?: string } {
  if (raw === undefined) return { maxUsers: DEFAULT_MAX_USERS };
  if (typeof raw !== "number" || !isValidMaxUsers(raw)) return { maxUsers: DEFAULT_MAX_USERS, error: "Invalid participant limit." };
  return { maxUsers: raw };
}

function sanitizeName(raw: unknown): string {
  return text(raw, MAX_NAME_LENGTH)?.replace(/[<>]/g, "") || "Guest";
}

function send(socket: ClientSocket, payload: unknown): void {
  socket.send(JSON.stringify(payload));
}

function roomSnapshot(room: Room) {
  return {
    id: room.id,
    protected: Boolean(room.passwordHash),
    topic: room.topic ?? null,
    maxUsers: room.maxUsers,
    imagesEnabled: room.imagesEnabled,
    users: [...room.users.entries()].map(([id, socket]) => ({ id, name: socket.data.name })),
    messages: room.messages,
    expiresAt: rooms.expiresAt(room),
  };
}

function broadcastRoom(roomId: string, payload: unknown, excludeUserId?: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const encoded = JSON.stringify(payload);
  for (const [userId, socket] of room.users) {
    if (userId !== excludeUserId) socket.send(encoded);
  }
}

function publishPresence(room: Room): void {
  broadcastRoom(room.id, {
    type: "presence",
    users: [...room.users.entries()].map(([id, socket]) => ({ id, name: socket.data.name })),
  });
}

function dataUrlByteLength(value: string): number {
  const comma = value.indexOf(",");
  if (comma === -1) return Infinity;
  const payload = value.slice(comma + 1).replace(/\s/g, "");
  return Math.floor((payload.length * 3) / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
}

function replySnapshot(room: Room, raw: unknown): ChatMessage["replyTo"] | undefined {
  if (typeof raw !== "string") return undefined;
  const original = room.messages.find((message) => message.id === raw);
  if (!original) return undefined;
  const textValue = original.kind === "text" ? original.text ?? "" : original.kind === "image" ? "Image" : "Voice message";
  return { id: original.id, senderName: original.senderName, kind: original.kind, text: textValue.slice(0, 160) };
}

function roomMeta(room: Room) {
  return {
    exists: true as const,
    protected: Boolean(room.passwordHash),
    topic: room.topic ?? null,
    userCount: room.users.size,
    maxUsers: room.maxUsers,
    imagesEnabled: room.imagesEnabled,
    full: room.users.size >= room.maxUsers,
  };
}

const server = Bun.serve<SocketData>({
  port: Number(Bun.env.PORT ?? 3000),
  maxRequestBodySize: 6 * 1024 * 1024,
  fetch: async (request, server) => {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return server.upgrade(request, { data: {} }) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/health") return json({ status: "ok", rooms: rooms.size });

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!allowRoomCreation(clientIp(request, server))) return json({ error: "Too many rooms created. Try again in a bit." }, 429);
      try {
        const body = (await request.json()) as Record<string, unknown>;
        const { password, error: passwordError } = parsePassword(body.password);
        const { topic, error: topicError } = parseTopic(body.topic);
        const { ttlMs, error: ttlError } = parseTtl(body.ttlMs);
        const { maxUsers, error: maxUsersError } = parseMaxUsers(body.maxUsers);
        const error = passwordError || topicError || ttlError || maxUsersError;
        if (error) return json({ error }, 400);
        const imagesEnabled = typeof body.imagesEnabled === "boolean" ? body.imagesEnabled : true;
        const room = await rooms.create({ password, topic, ttlMs, maxUsers, imagesEnabled });
        return json(
          { id: room.id, protected: Boolean(password), topic: room.topic ?? null, ttlMs: room.ttlMs, maxUsers: room.maxUsers, imagesEnabled: room.imagesEnabled, expiresAt: rooms.expiresAt(room) },
          201,
        );
      } catch {
        return json({ error: "Invalid request." }, 400);
      }
    }

    // Lightweight room lookup so an invite link can show "needs a password" /
    // "room's gone" before the visitor commits to a WebSocket handshake.
    if (url.pathname.startsWith("/api/rooms/") && request.method === "GET") {
      const id = url.pathname.slice("/api/rooms/".length).toLowerCase();
      if (!ROOM_ID.test(id)) return json({ error: "Invalid room ID." }, 400);
      const room = rooms.get(id);
      return json(room ? roomMeta(room) : { exists: false });
    }

    // Deep links (/room/abc123) and refreshes serve the SPA shell; the client reads the room ID from the URL.
    const isRoomLink = url.pathname.startsWith("/room/") && ROOM_ID.test(url.pathname.slice("/room/".length));
    const isStartPage = url.pathname === "/start";
    const path = url.pathname === "/" || isRoomLink || isStartPage ? "index.html" : url.pathname.slice(1);
    if (!/^[a-zA-Z0-9._/-]+$/.test(path) || path.includes("..")) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    const file = Bun.file(new URL(path, clientRoot));
    if (await file.exists()) return new Response(file, { headers: { "Cache-Control": "no-store", ...SECURITY_HEADERS } });
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  },
  websocket: {
    maxPayloadLength: 7 * 1024 * 1024,
    idleTimeout: 120,
    open() {},
    message: async (socket, raw) => {
      if (typeof raw !== "string" || raw.length > 7 * 1024 * 1024) return socket.close(1009, "Payload too large");
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { return send(socket, { type: "error", message: "Invalid message." }); }
      const type = event.type;

      if (type === "join") {
        if (socket.data.roomId) return send(socket, { type: "error", message: "Already joined." });
        const roomId = text(event.roomId, 16)?.toLowerCase();
        const name = sanitizeName(event.name);
        if (!roomId || !ROOM_ID.test(roomId)) return send(socket, { type: "error", message: "Invalid room ID." });
        const room = rooms.get(roomId);
        if (!room) return send(socket, { type: "error", message: "That room has burned." });
        if (room.users.size >= room.maxUsers) return send(socket, { type: "error", message: "This room is full." });
        const { password, error: passwordError } = parsePassword(event.password);
        if (passwordError) return send(socket, { type: "error", message: passwordError });
        if (room.passwordHash && password === undefined) return send(socket, { type: "error", message: "This room needs a password." });
        if (!(await rooms.passwordIsValid(room, password))) return send(socket, { type: "error", message: "Incorrect room password." });
        socket.data.userId = crypto.randomUUID();
        socket.data.roomId = roomId;
        socket.data.name = name;
        socket.data.limiter = new RateLimiter(5, 5);
        socket.data.typingLimiter = new RateLimiter(3, 1);
        room.users.set(socket.data.userId, socket);
        send(socket, { type: "joined", userId: socket.data.userId, room: roomSnapshot(room) });
        publishPresence(room);
        return;
      }

      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!roomId || !room || !userId || !socket.data.limiter) return send(socket, { type: "error", message: "Join a room first." });

      if (type === "typing") {
        if (socket.data.typingLimiter?.allow()) {
          broadcastRoom(roomId, { type: "typing", userId, name: socket.data.name ?? "Guest", isTyping: Boolean(event.isTyping) }, userId);
        }
        return;
      }

      if (!socket.data.limiter.allow()) return send(socket, { type: "error", message: "Slow down a little." });

      if (type === "chat") {
        const messageText = text(event.text, MAX_MESSAGE_LENGTH);
        if (!messageText) return send(socket, { type: "error", message: "Messages must be 1-2,000 characters." });
        const message: ChatMessage = { id: crypto.randomUUID(), kind: "text", senderId: userId, senderName: socket.data.name ?? "Guest", text: messageText, replyTo: replySnapshot(room, event.replyTo), sentAt: Date.now() };
        room.messages.push(message);
        broadcastRoom(roomId, { type: "message", message });
      } else if (type === "image") {
        if (!room.imagesEnabled) return send(socket, { type: "error", message: "Images are turned off in this room." });
        const mime = text(event.mime, 32);
        const data = text(event.data, 7 * 1024 * 1024);
        const alt = (typeof event.alt === "string" ? event.alt : "Shared image").slice(0, 160).replace(/[<>]/g, "");
        if (!mime || !ALLOWED_IMAGE_TYPES.has(mime) || !data || !data.startsWith(`data:${mime};base64,`) || dataUrlByteLength(data) > MAX_IMAGE_BYTES) return send(socket, { type: "error", message: "Images must be PNG, JPG, GIF, or WebP under 5 MB." });
        const message: ChatMessage = { id: crypto.randomUUID(), kind: "image", senderId: userId, senderName: socket.data.name ?? "Guest", image: { mime, data, alt }, replyTo: replySnapshot(room, event.replyTo), sentAt: Date.now() };
        room.messages.push(message);
        broadcastRoom(roomId, { type: "message", message });
      } else if (type === "voice") {
        const mime = text(event.mime, 32);
        const data = text(event.data, 2 * MAX_VOICE_BYTES);
        const durationMs = typeof event.durationMs === "number" ? event.durationMs : 0;
        const baseMime = mime?.split(";")[0];
        if (!mime || !baseMime || !ALLOWED_VOICE_TYPES.has(baseMime) || !data || !data.startsWith(`data:${mime};base64,`) || dataUrlByteLength(data) > MAX_VOICE_BYTES || durationMs < 250 || durationMs > MAX_VOICE_DURATION_MS) {
          return send(socket, { type: "error", message: "Voice messages must be under 60 seconds and 3 MB." });
        }
        const message: ChatMessage = { id: crypto.randomUUID(), kind: "voice", senderId: userId, senderName: socket.data.name ?? "Guest", voice: { mime, data, durationMs }, replyTo: replySnapshot(room, event.replyTo), sentAt: Date.now() };
        room.messages.push(message);
        broadcastRoom(roomId, { type: "message", message });
      }
    },
    close(socket) {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (!roomId || !userId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      room.users.delete(userId);
      if (room.users.size === 0) rooms.destroy(roomId, "empty");
      else publishPresence(room);
    },
  },
});

console.info(`BunChat listening on http://localhost:${server.port}`);

function shutdown(signal: string): void {
  console.info(`Received ${signal}, burning all rooms and shutting down.`);
  clearInterval(sweepInterval);
  rooms.destroyAll("server-shutdown");
  server.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
