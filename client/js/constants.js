// Mirrors the option sets and limits defined in server/roomManager.ts.
// There's no build step to share these between server and browser, so keep
// the two files in sync by hand — the comment at the top of roomManager.ts
// points back here.

export const TTL_OPTIONS = [
  { label: "5 min", value: 5 * 60_000 },
  { label: "15 min", value: 15 * 60_000 },
  { label: "30 min", value: 30 * 60_000 },
  { label: "1 hr", value: 60 * 60_000 },
  { label: "3 hr", value: 3 * 60 * 60_000 },
  { label: "12 hr", value: 12 * 60 * 60_000 },
  { label: "24 hr", value: 24 * 60 * 60_000 },
];
export const DEFAULT_TTL_MS = TTL_OPTIONS[2].value; // 30 minutes

export const MAX_USERS_OPTIONS = [
  { label: "Just us", value: 2 },
  { label: "Small group", value: 5 },
  { label: "Medium group", value: 10 },
  { label: "Large group", value: 20 },
];
export const DEFAULT_MAX_USERS = MAX_USERS_OPTIONS[3].value; // 20

export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_NAME_LENGTH = 32;
export const MAX_TOPIC_LENGTH = 40;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const ADJECTIVES = ["Warm", "Toasty", "Fresh", "Golden", "Fluffy", "Cozy", "Sweet", "Sunny", "Glazed", "Steamy"];

/** A friendly default display name, e.g. "Toasty Bun 482". Always editable. */
export function randomName() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const number = Math.floor(Math.random() * 900 + 100);
  return `${adjective} Bun ${number}`;
}
