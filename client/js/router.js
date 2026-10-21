import { showView } from "./views.js";
import { renderGate } from "./gate.js";

export function roomIdFromPath() {
  const match = location.pathname.match(/^\/room\/([a-z0-9]{6,16})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Used by the room setup page's "join by code" form. */
export function goToRoom(roomId) {
  history.pushState({}, "", `/room/${roomId}`);
  renderGate(roomId);
}

export function initRouter() {
  const roomId = roomIdFromPath();
  if (roomId) renderGate(roomId);
  else if (location.pathname === "/start") showView("actions");
  else showView("landing");

  // Back/forward navigation is rare in a single-room session; a full reload
  // is the simplest way to guarantee the socket, timers, and view state all
  // come back in sync with wherever the user landed.
  window.addEventListener("popstate", () => location.reload());
}
