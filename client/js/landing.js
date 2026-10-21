import { $, renderPillGroup, getPillValue } from "./dom.js";
import { createRoom } from "./api.js";
import { connectAndJoin } from "./socket.js";
import { showToast } from "./toast.js";
import { randomName, TTL_OPTIONS, DEFAULT_TTL_MS, MAX_USERS_OPTIONS, DEFAULT_MAX_USERS } from "./constants.js";
import { goToRoom } from "./router.js";
import { renderGate } from "./gate.js";
import { enterRoom } from "./chat.js";

let createForm;
let joinForm;
let ttlGroup;
let maxUsersGroup;
let nameInput;

export function initLanding() {
  createForm = $("create-form");
  joinForm = $("join-form");
  ttlGroup = $("create-ttl");
  maxUsersGroup = $("create-max-users");
  nameInput = $("create-name");
  renderPillGroup(ttlGroup, { name: "ttl", options: TTL_OPTIONS, selectedValue: DEFAULT_TTL_MS });
  renderPillGroup(maxUsersGroup, { name: "max-users", options: MAX_USERS_OPTIONS, selectedValue: DEFAULT_MAX_USERS });
  nameInput.placeholder = randomName();

  createForm.addEventListener("submit", handleCreateSubmit);
  joinForm.addEventListener("submit", handleJoinSubmit);
}

async function handleCreateSubmit(event) {
  event.preventDefault();
  const submitBtn = createForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const password = $("create-password").value;
  const name = nameInput.value.trim() || nameInput.placeholder;
  const topic = $("create-topic").value.trim();
  const ttlMs = getPillValue(ttlGroup) ?? DEFAULT_TTL_MS;
  const maxUsers = getPillValue(maxUsersGroup) ?? DEFAULT_MAX_USERS;
  const imagesEnabled = $("create-images").checked;

  const { ok, body } = await createRoom({ password, topic, ttlMs, maxUsers, imagesEnabled });
  if (!ok) {
    showToast(body?.error || "Could not create the room.");
    submitBtn.disabled = false;
    return;
  }

  history.pushState({}, "", `/room/${body.id}`);
  try {
    const joined = await connectAndJoin({ roomId: body.id, name, password });
    enterRoom(joined);
  } catch (message) {
    showToast(message || "Could not join the room you just created.");
    submitBtn.disabled = false;
    renderGate(body.id); // URL already points at it; let them retry from the gate
  }
}

function handleJoinSubmit(event) {
  event.preventDefault();
  const roomId = $("join-room-id").value.trim().toLowerCase();
  if (roomId) goToRoom(roomId);
}
