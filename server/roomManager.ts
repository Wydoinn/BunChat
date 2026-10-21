import type { ServerWebSocket } from "bun";
import { RateLimiter } from "./rateLimiter";

// ---------------------------------------------------------------------------
// Domain constants. This file is the single source of truth for every limit
// and default in the app - server.ts validates against these, and
// client/js/constants.js mirrors the *display* values (label + value) for
// rendering the create-room options. If you change a value here, update the
// matching entry in client/js/constants.js too.
// ---------------------------------------------------------------------------

export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_NAME_LENGTH = 32;
export const MAX_TOPIC_LENGTH = 40;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
export const MAX_VOICE_DURATION_MS = 60_000;
export const ALLOWED_VOICE_TYPES = new Set(["audio/wav"]);
export const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** How long a room lives, counted from creation — a fixed countdown, not an idle timer. Activity does not extend it. */
export const TTL_OPTIONS = [
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "30 minutes", ms: 30 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "3 hours", ms: 3 * 60 * 60_000 },
  { label: "12 hours", ms: 12 * 60 * 60_000 },
  { label: "24 hours", ms: 24 * 60 * 60_000 },
] as const;
export const DEFAULT_TTL_MS = TTL_OPTIONS[2].ms; // 30 minutes

/** How many buns can pile into one room at once. */
export const MAX_USERS_OPTIONS = [
  { label: "Just us", value: 2 },
  { label: "Small group", value: 5 },
  { label: "Medium group", value: 10 },
  { label: "Large group", value: 20 },
] as const;
export const DEFAULT_MAX_USERS = MAX_USERS_OPTIONS[3].value; // 20
export const MAX_USERS_HARD_CAP = Math.max(...MAX_USERS_OPTIONS.map((option) => option.value));

const ALLOWED_TTL_MS = new Set<number>(TTL_OPTIONS.map((option) => option.ms));
const ALLOWED_MAX_USERS = new Set<number>(MAX_USERS_OPTIONS.map((option) => option.value));

export function isValidTtl(ms: number): boolean {
  return ALLOWED_TTL_MS.has(ms);
}

export function isValidMaxUsers(value: number): boolean {
  return ALLOWED_MAX_USERS.has(value);
}

export type ChatMessage = {
  id: string;
  kind: "text" | "image" | "voice";
  senderId: string;
  senderName: string;
  text?: string;
  image?: { mime: string; data: string; alt: string };
  voice?: { mime: string; data: string; durationMs: number };
  replyTo?: { id: string; senderName: string; kind: ChatMessage["kind"]; text: string };
  sentAt: number;
};

export type SocketData = {
  userId?: string;
  roomId?: string;
  name?: string;
  limiter?: RateLimiter;
  typingLimiter?: RateLimiter;
};

export type ClientSocket = ServerWebSocket<SocketData>;

export type RoomOptions = {
  password?: string;
  ttlMs?: number;
  maxUsers?: number;
  topic?: string;
  imagesEnabled?: boolean;
};

export type Room = {
  id: string;
  passwordHash?: string;
  users: Map<string, ClientSocket>;
  messages: ChatMessage[];
  createdAt: number;
  ttlMs: number;
  maxUsers: number;
  topic?: string;
  imagesEnabled: boolean;
};

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  async create(options: RoomOptions = {}): Promise<Room> {
    const id = this.generateId();
    const now = Date.now();
    const room: Room = {
      id,
      passwordHash: options.password ? await Bun.password.hash(options.password, { algorithm: "argon2id" }) : undefined,
      users: new Map(),
      messages: [],
      createdAt: now,
      // Defensive defaults: server.ts rejects invalid values before they get
      // here, but this class stays safe to use on its own (e.g. in tests).
      ttlMs: options.ttlMs !== undefined && isValidTtl(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS,
      maxUsers: options.maxUsers !== undefined && isValidMaxUsers(options.maxUsers) ? options.maxUsers : DEFAULT_MAX_USERS,
      topic: options.topic,
      imagesEnabled: options.imagesEnabled ?? true,
    };
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Fixed deadline from room creation. Chatting or people joining does not push this back. */
  expiresAt(room: Room): number {
    return room.createdAt + room.ttlMs;
  }

  async passwordIsValid(room: Room, password?: string): Promise<boolean> {
    if (!room.passwordHash) return true;
    if (!password) return false;
    return Bun.password.verify(password, room.passwordHash);
  }

  destroy(id: string, reason = "burned"): void {
    const room = this.rooms.get(id);
    if (!room) return;
    this.rooms.delete(id);
    for (const socket of room.users.values()) {
      socket.send(JSON.stringify({ type: "room-burned", reason }));
      socket.close(1000, "Room burned");
    }
    room.users.clear();
    room.messages.length = 0;
    room.passwordHash = undefined;
  }

  destroyAll(reason: string): void {
    for (const id of [...this.rooms.keys()]) this.destroy(id, reason);
  }

  destroyExpiredRooms(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (now - room.createdAt >= room.ttlMs) this.destroy(room.id, "expired");
    }
  }

  private generateId(): string {
    let id: string;
    do id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    while (this.rooms.has(id));
    return id;
  }
}
