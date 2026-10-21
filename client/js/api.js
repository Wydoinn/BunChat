async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(response) {
  return { ok: response.ok, status: response.status, body: await readJsonSafely(response) };
}

async function requestJson(url, options) {
  try {
    return await request(await fetch(url, options));
  } catch (error) {
    if (error instanceof TypeError) {
      return { ok: false, status: 0, body: { error: "The network is unavailable. Check your connection and try again." } };
    }
    throw error;
  }
}

export async function createRoom(options) {
  return requestJson("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
}

export async function fetchRoomMeta(roomId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomId)}`);
}
