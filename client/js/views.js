import { $ } from "./dom.js";

const sections = {
  landing: $("view-landing"),
  actions: $("view-actions"),
  gate: $("view-gate"),
  chat: $("view-chat"),
};

export function showView(name) {
  for (const [key, section] of Object.entries(sections)) {
    section.classList.toggle("hidden", key !== name);
  }
}
