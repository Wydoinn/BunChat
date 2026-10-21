import { $, el, icon } from "./dom.js";
import { state } from "./state.js";
import { on, send, disconnect } from "./socket.js";
import { showToast } from "./toast.js";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./constants.js";
import { showView } from "./views.js";

const els = {
  view: $("view-chat"),
  messages: $("messages"),
  form: $("message-form"),
  input: $("message-input"),
  imageInput: $("image-input"),
  uploadLabel: $("upload-label"),
  roomLabel: $("room-label"),
  burnTimer: $("burn-timer"),
  connectionStatus: $("connection-status"),
  privacyStatus: $("privacy-status"),
  userCount: $("user-count"),
  userCountLabel: $("user-count").querySelector("span"),
  users: $("users"),
  inviteLink: $("invite-link"),
  copyBtn: $("copy-link"),
  shareBtn: $("share-link"),
  roomIdValue: $("room-id-value"),
  copyRoomIdBtn: $("copy-room-id"),
  leaveBtn: $("leave-button"),
  typingIndicator: $("typing-indicator"),
  jumpLatest: $("jump-latest"),
  dropOverlay: $("drop-overlay"),
  burnOverlay: $("burn-overlay"),
  lightbox: $("lightbox"),
  lightboxImage: $("lightbox-image"),
  lightboxClose: $("lightbox-close"),
  messageCount: $("message-count"),
  voiceButton: $("voice-button"),
  replyBar: $("reply-bar"),
  replyLabel: $("reply-label"),
  cancelReply: $("cancel-reply"),
};

let mounted = false;
let lastGroup = null; // { senderId, timestamp, articleEl }
const typingUsers = new Map(); // userId -> { name, timer }
let typingActive = false;
let stopTypingTimer = null;
let replyTo = null;
let recorder = null;
let recordingStartedAt = 0;
let recordingChunks = [];
let recordingStream = null;
let recordingContext = null;
let recordingProcessor = null;
let recordingSource = null;

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function avatarTint(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `avatar-${hash % 5}`;
}

function isNearBottom() {
  const node = els.messages;
  return node.scrollHeight - node.scrollTop - node.clientHeight < 120;
}

function scrollToEnd() {
  els.messages.scrollTop = els.messages.scrollHeight;
  els.jumpLatest.classList.add("hidden");
}

let lightboxReturnFocus = null;

function openLightbox(src, alt) {
  lightboxReturnFocus = document.activeElement;
  els.lightboxImage.src = src;
  els.lightboxImage.alt = alt;
  els.lightbox.classList.remove("hidden");
  els.lightboxClose.focus();
}

function closeLightbox() {
  els.lightbox.classList.add("hidden");
  els.lightboxImage.src = "";
  if (lightboxReturnFocus instanceof HTMLElement) lightboxReturnFocus.focus();
  lightboxReturnFocus = null;
}

function renderMessage(message) {
  els.messages.querySelector(".empty-state")?.remove();
  const mine = message.senderId === state.userId;
  const sameGroup = lastGroup && lastGroup.senderId === message.senderId && message.sentAt - lastGroup.timestamp < 4 * 60_000;

  let bubble;
  const quoted = message.replyTo
    ? el("div", { class: "reply-quote" }, [
        el("span", { class: "reply-quote-label", text: `Replying to ${message.replyTo.senderName}` }),
        el("span", { text: message.replyTo.text || (message.replyTo.kind === "image" ? "Image" : message.replyTo.kind === "voice" ? "Voice message" : "Message") }),
      ])
    : null;
  if (message.kind === "image") {
    const img = new Image();
    img.src = message.image.data;
    img.alt = message.image.alt || "Shared image";
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(img.src, img.alt));
    bubble = el("div", { class: "bubble image-bubble" }, [img]);
  } else if (message.kind === "voice") {
    const voice = message.voice;
    if (!voice?.data) {
      bubble = el("div", { class: "bubble voice-bubble voice-unavailable", text: "Voice message unavailable" });
    } else {
      const audio = el("audio", { controls: "true", preload: "metadata" });
      audio.src = voice.data;
      audio.type = voice.mime || "audio/wav";
      audio.addEventListener("error", () => {
        audio.replaceWith(el("span", { class: "voice-unavailable", text: "Audio format not supported" }));
      }, { once: true });
      audio.load();
      bubble = el("div", { class: "bubble voice-bubble" }, [audio, el("span", { class: "voice-duration", text: formatDuration(voice.durationMs) })]);
    }
  } else {
    bubble = el("div", { class: "bubble", text: message.text });
  }
  const replyButton = el("button", { class: "message-reply", type: "button", title: "Reply", "aria-label": "Reply to message" }, [icon("reply")]);
  replyButton.addEventListener("click", () => startReply(message));
  const content = el("div", { class: "message-item" }, [quoted, bubble, replyButton]);

  if (sameGroup) {
    lastGroup.articleEl.append(content);
  } else {
    const meta = el("div", { class: "message-meta" }, [
      !mine ? el("span", { class: `avatar ${avatarTint(message.senderId)}`, text: initials(message.senderName) }) : null,
      el("span", { text: `${message.senderName || "Guest"} · ${formatTime(message.sentAt)}` }),
    ]);
    const article = el("article", { class: `message ${mine ? "mine" : ""}` }, [meta, content]);
    els.messages.append(article);
    lastGroup = { senderId: message.senderId, timestamp: message.sentAt, articleEl: article };
  }

}

function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function startReply(message) {
  replyTo = message;
  els.replyLabel.textContent = `${message.senderName}: ${message.kind === "text" ? message.text : message.kind === "image" ? "Image" : "Voice message"}`;
  els.replyBar.classList.remove("hidden");
  els.input.focus();
}

function cancelReply() {
  replyTo = null;
  els.replyBar.classList.add("hidden");
}

function renderPrivacyStatus(room) {
  els.privacyStatus.replaceChildren(
    icon(room.protected ? "lock" : "sun"),
    el("span", { text: room.protected ? "Password protected" : "Open room" }),
  );
}

function updateUsers(users) {
  els.userCountLabel.textContent = `${users.length} ${users.length === 1 ? "bun" : "buns"} here`;
  els.users.replaceChildren(
    ...users.map((user) =>
      el("span", { class: "user-chip" }, [
        el("span", { class: `avatar ${avatarTint(user.id)}`, text: initials(user.name) }),
        el("span", { text: user.id === state.userId ? `${user.name || "Guest"} (you)` : user.name || "Guest" }),
      ]),
    ),
  );
}

function renderEmptyState() {
  els.messages.replaceChildren(
    el("div", { class: "empty-state" }, [
      el("span", { class: "empty-icon" }, [icon("bun")]),
      el("strong", { text: "This room is yours" }),
      el("span", { text: "Say hello, share an idea, or drop an image to get things moving." }),
    ]),
  );
}

function setConnectionStatus(label, stateName) {
  els.connectionStatus.className = `connection-status ${stateName}`;
  els.connectionStatus.lastElementChild.textContent = label;
}

function renderTypingIndicator() {
  const names = [...typingUsers.values()].map((entry) => entry.name || "Guest");
  if (!names.length) {
    els.typingIndicator.classList.add("hidden");
    return;
  }
  const label =
    names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names.length} buns are typing`;
  els.typingIndicator.replaceChildren(
    el("span", { text: label }),
    el("span", { class: "typing-dots" }, [el("span"), el("span"), el("span")]),
  );
  els.typingIndicator.classList.remove("hidden");
}

function clearTypingFor(userId) {
  const entry = typingUsers.get(userId);
  if (!entry) return;
  clearTimeout(entry.timer);
  typingUsers.delete(userId);
  renderTypingIndicator();
}

function updateTimer() {
  if (!state.expiresAt) return;
  const remaining = Math.max(0, state.expiresAt - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  els.burnTimer.textContent = `Burns in ${minutes}:${String(seconds).padStart(2, "0")}`;
  els.burnTimer.classList.toggle("urgent", remaining > 0 && remaining <= 60_000);
}
setInterval(updateTimer, 1000);

function autoResizeComposer() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`;
}

async function handleImageFile(file) {
  if (!state.imagesEnabled) return showToast("Images are turned off in this room.");
  if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
    return showToast("Choose a PNG, JPG, GIF, or WebP under 5 MB.");
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  send({ type: "image", mime: file.type, data, alt: file.name, replyTo: replyTo?.id });
}

function mergeAudioChunks(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsampleAudio(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), input.length);
    let sum = 0;
    for (let source = start; source < end; source += 1) sum += input[source];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function toggleVoiceRecording() {
  if (recorder) {
    await recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) return showToast("Microphone recording is not supported in this browser.");
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return showToast("Audio recording is not supported in this browser.");
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingContext = new AudioContextClass();
    await recordingContext.resume();
    recordingSource = recordingContext.createMediaStreamSource(recordingStream);
    recordingProcessor = recordingContext.createScriptProcessor(4096, 1, 1);
    recordingChunks = [];
    recordingStartedAt = Date.now();
    recordingProcessor.addEventListener("audioprocess", (event) => {
      recordingChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    });
    recordingSource.connect(recordingProcessor);
    recordingProcessor.connect(recordingContext.destination);
    recorder = {
      stop: async () => {
      const durationMs = Date.now() - recordingStartedAt;
      recorder = null;
      recordingProcessor?.disconnect();
      recordingSource?.disconnect();
      await recordingContext?.close();
      const samples = downsampleAudio(mergeAudioChunks(recordingChunks), recordingContext?.sampleRate ?? 44100, 16_000);
      const blob = encodeWav(samples, 16_000);
      recordingChunks = [];
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      recordingContext = null;
      recordingProcessor = null;
      recordingSource = null;
      els.voiceButton.classList.remove("recording");
      els.voiceButton.title = "Record voice message";
      if (durationMs < 250) return;
      if (blob.size > 3 * 1024 * 1024) return showToast("Keep voice messages under 3 MB.");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      send({ type: "voice", mime: "audio/wav", data, durationMs, replyTo: replyTo?.id });
      cancelReply();
      },
    };
    els.voiceButton.classList.add("recording");
    els.voiceButton.title = "Stop recording";
    showToast("Recording… tap the mic again to send.");
    setTimeout(() => { if (recorder) recorder.stop(); }, 60_000);
  } catch (error) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    showToast(error?.name === "NotAllowedError" ? "Microphone access was denied." : "Could not start recording.");
  }
}

function syncRoom(event) {
  state.userId = event.userId;
  state.roomId = event.room.id;
  state.expiresAt = event.room.expiresAt;
  state.imagesEnabled = event.room.imagesEnabled;
  lastGroup = null;

  els.roomLabel.textContent = event.room.topic || `Room ${event.room.id}`;
  els.inviteLink.value = `${location.origin}/room/${event.room.id}`;
  els.roomIdValue.value = event.room.id;
  renderPrivacyStatus(event.room);
  els.uploadLabel.classList.toggle("hidden", !event.room.imagesEnabled);

  els.messages.replaceChildren();
  if (event.room.messages.length) event.room.messages.forEach(renderMessage);
  else renderEmptyState();
  updateUsers(event.room.users);
  updateTimer();
  scrollToEnd();
  showView("chat");
  setConnectionStatus("Connected", "connected");
}

function mountOnce() {
  on("joined", syncRoom); // catches resyncs after a reconnect
  on("message", (event) => {
    const wasNearBottom = isNearBottom();
    renderMessage(event.message);
    clearTypingFor(event.message.senderId);
    if (wasNearBottom) scrollToEnd();
    else els.jumpLatest.classList.remove("hidden");
  });
  on("presence", (event) => updateUsers(event.users));
  on("typing", (event) => {
    if (!event.isTyping) return clearTypingFor(event.userId);
    clearTimeout(typingUsers.get(event.userId)?.timer);
    const timer = setTimeout(() => clearTypingFor(event.userId), 4000);
    typingUsers.set(event.userId, { name: event.name, timer });
    renderTypingIndicator();
  });
  on("error", (event) => showToast(event.message));
  on("_disconnected", () => {
    setConnectionStatus("Reconnecting", "reconnecting");
    showToast("Disconnected. Reconnecting…");
  });
  on("room-burned", () => {
    showToast("This room has burned away.");
    els.burnOverlay.classList.add("active");
    setTimeout(() => location.assign("/"), reducedMotion() ? 200 : 650);
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.input.value.trim();
    if (!value) return;
    send({ type: "chat", text: value, replyTo: replyTo?.id });
    els.input.value = "";
    els.messageCount.textContent = "0/2000";
    els.messageCount.classList.remove("near-limit");
    cancelReply();
    autoResizeComposer();
    clearTimeout(stopTypingTimer);
    if (typingActive) {
      typingActive = false;
      send({ type: "typing", isTyping: false });
    }
  });

  els.input.addEventListener("input", () => {
    autoResizeComposer();
    els.messageCount.textContent = `${els.input.value.length}/2000`;
    els.messageCount.classList.toggle("near-limit", els.input.value.length > 1800);
    if (!typingActive) {
      typingActive = true;
      send({ type: "typing", isTyping: true });
    }
    clearTimeout(stopTypingTimer);
    stopTypingTimer = setTimeout(() => {
      typingActive = false;
      send({ type: "typing", isTyping: false });
    }, 2500);
  });

  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.imageInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) handleImageFile(file);
  });
  els.uploadLabel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    els.imageInput.click();
  });
  els.voiceButton.addEventListener("click", toggleVoiceRecording);
  els.cancelReply.addEventListener("click", cancelReply);

  els.messages.addEventListener("scroll", () => {
    if (isNearBottom()) els.jumpLatest.classList.add("hidden");
  });
  els.jumpLatest.addEventListener("click", scrollToEnd);

  els.copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.inviteLink.value);
      showToast("Invite link copied.");
    } catch {
      els.inviteLink.select();
      showToast("Press Ctrl/Cmd+C to copy.");
    }
  });

  els.copyRoomIdBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.roomIdValue.value);
      showToast("Room ID copied.");
    } catch {
      els.roomIdValue.select();
      showToast("Press Ctrl/Cmd+C to copy.");
    }
  });

  if (navigator.share) {
    els.shareBtn.classList.remove("hidden");
    els.shareBtn.addEventListener("click", async () => {
      try {
        await navigator.share({ title: "Join my BunChat room", url: els.inviteLink.value });
      } catch {
        // User dismissed the share sheet — nothing to do.
      }
    });
  }

  els.leaveBtn.addEventListener("click", () => {
    disconnect();
    location.assign("/");
  });

  els.lightboxClose.addEventListener("click", closeLightbox);
  els.lightbox.addEventListener("click", (event) => { if (event.target === els.lightbox) closeLightbox(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.lightbox.classList.contains("hidden")) closeLightbox();
  });

  let dragHideTimer = null;
  document.addEventListener("dragover", (event) => {
    if (els.view.classList.contains("hidden") || !state.imagesEnabled) return;
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    els.dropOverlay.classList.remove("hidden");
    clearTimeout(dragHideTimer);
    dragHideTimer = setTimeout(() => els.dropOverlay.classList.add("hidden"), 150);
  });
  document.addEventListener("drop", (event) => {
    if (els.view.classList.contains("hidden")) return;
    event.preventDefault();
    els.dropOverlay.classList.add("hidden");
    const file = event.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });
}

export function enterRoom(event) {
  if (!mounted) {
    mountOnce();
    mounted = true;
  }
  syncRoom(event);
}
