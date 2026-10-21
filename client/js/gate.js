import { $, el, icon } from "./dom.js";
import { fetchRoomMeta } from "./api.js";
import { connectAndJoin } from "./socket.js";
import { randomName, MAX_NAME_LENGTH, MAX_PASSWORD_LENGTH } from "./constants.js";
import { showView } from "./views.js";
import { enterRoom } from "./chat.js";

const card = $("gate-card");
let requestToken = 0; // guards a slow fetch from clobbering a newer navigation

export async function renderGate(roomId) {
  const token = ++requestToken;
  showView("gate");
  renderLoading();

  const { ok, body } = await fetchRoomMeta(roomId);
  if (token !== requestToken) return; // the user has since navigated elsewhere

  if (!ok) return renderUnavailable(body?.error);
  if (!body?.exists) return renderNotFound();
  if (body.full) return renderFull(body);
  renderJoinForm(roomId, body);
}

function renderLoading() {
  card.replaceChildren(el("p", { class: "gate-status" }, ["Checking the room…"]));
}

function renderNotFound() {
  card.replaceChildren(
    el("h2", { text: "This room has burned away" }),
    el("p", { class: "card-sub", text: "It never existed, or everyone already left and it disappeared for good." }),
    el("a", { class: "button primary", href: "/start" }, [el("span", { text: "Start a new room" }), icon("arrow")]),
  );
}

function renderUnavailable(message) {
  card.replaceChildren(
    el("h2", { text: "We could not check this room" }),
    el("p", { class: "card-sub", text: message || "The room lookup failed. Check your connection and try again." }),
    el("button", { class: "button primary", type: "button", text: "Try again", onClick: () => renderGate(location.pathname.split("/").pop()) }),
  );
}

function renderFull(meta) {
  card.replaceChildren(
    el("h2", { text: meta.topic || "This room is full" }),
    el("p", { class: "card-sub", text: `${meta.userCount}/${meta.maxUsers} buns are already inside. Ask someone to leave, or start your own room.` }),
    el("a", { class: "button primary", href: "/start" }, [el("span", { text: "Start a new room" }), icon("arrow")]),
  );
}

function renderJoinForm(roomId, meta) {
  const suggestedName = randomName();
  const nameInput = el("input", { maxlength: String(MAX_NAME_LENGTH), placeholder: suggestedName });
  let passwordInput = null;

  const fields = [el("label", { class: "field" }, [el("span", { class: "field-label", text: "Your name" }), nameInput])];
  if (meta.protected) {
    passwordInput = el("input", { type: "password", maxlength: String(MAX_PASSWORD_LENGTH), placeholder: "Room password" });
    fields.push(el("label", { class: "field" }, [el("span", { class: "field-label", text: "Password" }), passwordInput]));
  }

  const errorEl = el("p", { class: "gate-error hidden" });
  const submitBtn = el("button", { class: "button primary", type: "submit" }, [el("span", { text: "Enter room" }), icon("arrow")]);
  const form = el("form", { autocomplete: "off" }, [...fields, errorEl, submitBtn]);

  card.replaceChildren(
    el("h2", { text: meta.topic || `Room ${roomId}` }),
    el("p", { class: "gate-status" }, [
      icon(meta.protected ? "lock" : "sun"),
      el("span", { text: `${meta.protected ? "Password protected" : "Open room"} · ${meta.userCount}/${meta.maxUsers} buns here` }),
    ]),
    form,
  );
  nameInput.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    const name = nameInput.value.trim() || suggestedName;
    const password = passwordInput?.value;
    try {
      const joined = await connectAndJoin({ roomId, name, password });
      enterRoom(joined);
    } catch (message) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
    }
  });
}
