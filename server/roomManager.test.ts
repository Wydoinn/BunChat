import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_USERS, DEFAULT_TTL_MS, isValidMaxUsers, isValidTtl, MAX_USERS_OPTIONS, RoomManager, TTL_OPTIONS } from "./roomManager";

describe("RoomManager", () => {
  test("creates rooms with unique, valid IDs", async () => {
    const rooms = new RoomManager();
    const a = await rooms.create();
    const b = await rooms.create();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[a-z0-9]{6,16}$/);
    expect(a.passwordHash).toBeUndefined();
  });

  test("applies sensible defaults when no options are given", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create();
    expect(room.ttlMs).toBe(DEFAULT_TTL_MS);
    expect(room.maxUsers).toBe(DEFAULT_MAX_USERS);
    expect(room.imagesEnabled).toBe(true);
    expect(room.topic).toBeUndefined();
  });

  test("honors a valid custom ttl and participant limit", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create({ ttlMs: TTL_OPTIONS[0].ms, maxUsers: MAX_USERS_OPTIONS[0].value, topic: "Movie night", imagesEnabled: false });
    expect(room.ttlMs).toBe(TTL_OPTIONS[0].ms);
    expect(room.maxUsers).toBe(MAX_USERS_OPTIONS[0].value);
    expect(room.topic).toBe("Movie night");
    expect(room.imagesEnabled).toBe(false);
  });

  test("falls back to defaults for an out-of-range ttl or participant limit", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create({ ttlMs: 999, maxUsers: 999 });
    expect(room.ttlMs).toBe(DEFAULT_TTL_MS);
    expect(room.maxUsers).toBe(DEFAULT_MAX_USERS);
  });

  test("isValidTtl / isValidMaxUsers only accept listed values", () => {
    expect(isValidTtl(TTL_OPTIONS[0].ms)).toBe(true);
    expect(isValidTtl(1234)).toBe(false);
    expect(isValidMaxUsers(MAX_USERS_OPTIONS[0].value)).toBe(true);
    expect(isValidMaxUsers(7)).toBe(false);
  });

  test("hashes and verifies passwords", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create({ password: "hunter2" });
    expect(room.passwordHash).toBeDefined();
    expect(await rooms.passwordIsValid(room)).toBe(false);
    expect(await rooms.passwordIsValid(room, "wrong")).toBe(false);
    expect(await rooms.passwordIsValid(room, "hunter2")).toBe(true);
  });

  test("open rooms accept any join attempt", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create();
    expect(await rooms.passwordIsValid(room)).toBe(true);
    expect(await rooms.passwordIsValid(room, "anything")).toBe(true);
  });

  test("destroy removes the room and wipes its state", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create();
    room.messages.push({ id: "1", kind: "text", senderId: "u1", senderName: "Bun", text: "hi", sentAt: Date.now() });
    rooms.destroy(room.id);
    expect(rooms.get(room.id)).toBeUndefined();
    expect(room.messages.length).toBe(0);
    expect(room.passwordHash).toBeUndefined();
  });

  test("destroyExpiredRooms sweeps only rooms past their own fixed lifetime", async () => {
    const rooms = new RoomManager();
    const stale = await rooms.create({ ttlMs: TTL_OPTIONS[0].ms });
    const fresh = await rooms.create();
    stale.createdAt = Date.now() - stale.ttlMs - 1;
    rooms.destroyExpiredRooms();
    expect(rooms.get(stale.id)).toBeUndefined();
    expect(rooms.get(fresh.id)).toBeDefined();
  });

  test("expiresAt is fixed from creation and does not move", async () => {
    const rooms = new RoomManager();
    const room = await rooms.create({ ttlMs: TTL_OPTIONS[0].ms });
    const original = rooms.expiresAt(room);
    expect(original).toBe(room.createdAt + room.ttlMs);
    // Simulate time passing / activity happening — nothing here should push the deadline back.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rooms.expiresAt(room)).toBe(original);
  });

  test("destroyAll clears every room", async () => {
    const rooms = new RoomManager();
    await rooms.create();
    await rooms.create();
    expect(rooms.size).toBe(2);
    rooms.destroyAll("shutdown");
    expect(rooms.size).toBe(0);
  });
});
