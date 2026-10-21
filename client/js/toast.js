import { $ } from "./dom.js";

const toastEl = $("toast");
let hideTimer = null;

export function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl.classList.remove("visible"), 3200);
}
