// Owns the single live WebSocket connection for the page. Consumers
// subscribe with on(type, handler) rather than reaching into the socket
// directly, so reconnect logic lives in exactly one place.

const listeners = new Map();
let socket = null;
let reconnectAttempt = 0;
let currentRoomId = null;
let currentAuth = { name: undefined, password: undefined };

// Bumped every time connectAndJoin()/disconnect() intentionally starts or
// ends a connection. Each socket's callbacks capture the epoch that was
// current when they were created; if the module's epoch has since moved on,
// that socket has been superseded (replaced by a retry, or the user left) and
// its close/reconnect handling becomes a no-op instead of firing a spurious
// "disconnected" event or racing a duplicate reconnect against the new one.
let epoch = 0;
const INITIAL_CONNECTION_TIMEOUT_MS = 10_000;

export function on(type, handler) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(handler);
  return () => listeners.get(type)?.delete(handler);
}

function emit(event) {
  for (const handler of listeners.get(event.type) ?? []) handler(event);
}

function openSocket(myEpoch) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = ws;

  ws.addEventListener("open", () => {
    if (myEpoch !== epoch) return;
    reconnectAttempt = 0;
    ws.send(JSON.stringify({ type: "join", roomId: currentRoomId, ...currentAuth }));
  });
  ws.addEventListener("message", ({ data }) => {
    if (myEpoch !== epoch) return;
    try {
      emit(JSON.parse(data));
    } catch {
      // Malformed frame — ignore rather than throw and tear down the socket.
    }
  });
  ws.addEventListener("close", () => {
    if (myEpoch !== epoch) return; // superseded by a retry or an explicit disconnect()
    emit({ type: "_disconnected" });
    const delay = Math.min(1000 * 2 ** reconnectAttempt++, 10_000);
    setTimeout(() => { if (myEpoch === epoch) openSocket(myEpoch); }, delay);
  });
}

/**
 * Opens a fresh connection (superseding any previous one) and resolves with
 * the `joined` event, or rejects with the server's error message. Later
 * `joined`/`message`/etc. events — including on reconnect — go through
 * `on()` instead, so callers only use this once per room.
 */
export function connectAndJoin({ roomId, name, password }) {
  epoch += 1;
  const myEpoch = epoch;
  socket?.close();
  currentRoomId = roomId;
  currentAuth = { name, password };
  reconnectAttempt = 0;

  return new Promise((resolve, reject) => {
    const offJoined = on("joined", (event) => { cleanup(); resolve(event); });
    const offError = on("error", (event) => { cleanup(); reject(event.message); });
    const timeout = setTimeout(() => {
      cleanup();
      if (myEpoch === epoch) {
        epoch += 1;
        socket?.close();
      }
      reject("The connection timed out. Check your connection and try again.");
    }, INITIAL_CONNECTION_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timeout);
      offJoined();
      offError();
    }
    try {
      openSocket(myEpoch);
    } catch {
      cleanup();
      reject("Could not connect to the room. Check your connection and try again.");
    }
  });
}

export function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

export function disconnect() {
  epoch += 1;
  socket?.close();
}
