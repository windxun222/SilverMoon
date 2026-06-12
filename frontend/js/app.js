/**
 * SilverMoon App - orchestrates camera, audio (STT), WebSocket, and chat UI.
 *
 * Cost-control on the client side:
 *   - Frame capture is throttled to at most one every 1.5 s
 *   - Frames only captured when a query is actually being sent
 *   - STT is entirely client-side (Web Speech API) - zero server cost
 */

import { startCamera, captureFrame, stopCamera } from "./camera.js";
import {
  requestMic,
  startListening,
  stopListening,
  releaseMic,
  setCallbacks as setAudioCallbacks,
} from "./audio.js";
import {
  connect,
  disconnect,
  send,
  setCallbacks as setWsCallbacks,
  isConnected,
} from "./websocket.js";

// DOM refs
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const chatMessages = document.getElementById("chat-messages");
const interimText = document.getElementById("interim-text");
const btnTalk = document.getElementById("btn-talk");
const btnAuto = document.getElementById("btn-auto");
const btnMute = document.getElementById("btn-mute");

// State
let autoMode = false;
let muted = false;
let lastFrameCaptureTs = 0;
const FRAME_THROTTLE_MS = 1500;

// Status helpers
function setStatus(state) {
  const map = {
    connecting: ["", "Connecting..."],
    connected:  ["connected", "Connected"],
    listening:  ["listening", "Listening..."],
    thinking:   ["listening", "Thinking..."],
    error:      ["error", "Error"],
  };
  const [cls, text] = map[state] || ["", state];
  statusDot.className = cls;
  statusText.textContent = text;
}

// Chat UI
function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}-msg`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

function setInterim(text) {
  interimText.textContent = text || "";
}

// Send query
function sendQuery(text) {
  if (!text || !isConnected()) return;
  setStatus("thinking");
  addMessage("user", text);
  setInterim("");
  const msg = { type: "query", text };
  const now = Date.now();
  if (now - lastFrameCaptureTs >= FRAME_THROTTLE_MS) {
    const frame = captureFrame();
    if (frame) {
      msg.image = frame;
      lastFrameCaptureTs = now;
    }
  }
  send(msg);
}

// Microphone mode management
function enterListeningMode() {
  if (muted) return;
  startListening();
  setStatus("listening");
}

function exitListeningMode() {
  stopListening();
  if (isConnected()) {
    setStatus("connected");
  } else {
    setStatus("connecting");
  }
}

function toggleAuto() {
  autoMode = !autoMode;
  btnAuto.classList.toggle("on", autoMode);
  if (autoMode) enterListeningMode();
  else exitListeningMode();
}

function toggleMute() {
  muted = !muted;
  btnMute.classList.toggle("on", muted);
  btnMute.querySelector(".btn-icon").textContent = muted ? "\uD83D\uDD0A" : "\uD83D\uDD07";
  if (muted) exitListeningMode();
  else if (autoMode) enterListeningMode();
}

// Push-to-talk
btnTalk.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (muted) return;
  btnTalk.classList.add("active");
  enterListeningMode();
});

btnTalk.addEventListener("pointerup", (e) => {
  e.preventDefault();
  btnTalk.classList.remove("active");
  exitListeningMode();
});

btnTalk.addEventListener("pointerleave", () => {
  btnTalk.classList.remove("active");
  exitListeningMode();
});

btnTalk.addEventListener("pointercancel", () => {
  btnTalk.classList.remove("active");
  exitListeningMode();
});

// Auto / Mute buttons
btnAuto.addEventListener("click", toggleAuto);
btnMute.addEventListener("click", toggleMute);

// Boot sequence
async function init() {
  setStatus("connecting");

  // Wire up cross-module callbacks
  setAudioCallbacks({
    onInterim: setInterim,
    onFinal: (text) => {
      setInterim("");
      if (text) sendQuery(text);
      if (autoMode && !muted) {
        setTimeout(() => {
          if (autoMode && !muted) startListening();
        }, 1500);
      }
    },
    onState: (listening) => {
      if (listening) setStatus("listening");
      else if (isConnected()) setStatus("connected");
    },
  });

  setWsCallbacks({
    onMsg: (data) => {
      if (data.type === "response") {
        addMessage("assistant", data.text);
        speakText(data.text);
        if (isConnected()) setStatus("connected");
      } else if (data.type === "error") {
        addMessage("system", "\u26A0\uFE0F " + data.detail);
        setStatus("error");
      } else if (data.type === "pong") {
        // heartbeat OK
      }
    },
    onConn: (conn) => {
      if (conn) setStatus("connected");
      else setStatus("connecting");
    },
  });

  // Connect WebSocket IMMEDIATELY (critical: must not wait for camera/mic)
  connect();

  // Start hardware non-blocking (may need user gesture for getUserMedia)
  try {
    await Promise.all([
      startCamera().catch((e) => console.warn("Camera init delayed:", e)),
      requestMic().catch((e) => console.warn("Mic init delayed:", e)),
    ]);
  } catch (e) {
    console.warn("Hardware init:", e);
  }

  // Heartbeat ping every 30 s
  setInterval(() => {
    if (isConnected()) send({ type: "ping" });
  }, 30000);
}

// TTS (client-side, no server cost)
function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.lang.startsWith("zh") || v.lang.startsWith("en-US"),
  );
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  stopCamera();
  releaseMic();
  disconnect();
});

// Start
init();
