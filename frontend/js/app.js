/**
 * SilverMoon App - orchestrates camera, audio (STT), WebSocket, and chat UI.
 */
import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { requestMic, startListening, stopListening, releaseMic, setCallbacks as setAudioCallbacks } from "./audio.js";
import { connect, disconnect, send, setCallbacks as setWsCallbacks, isConnected } from "./websocket.js";

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const chatMessages = document.getElementById("chat-messages");
const interimText = document.getElementById("interim-text");
const btnTalk = document.getElementById("btn-talk");
const btnAuto = document.getElementById("btn-auto");
const btnMute = document.getElementById("btn-mute");

let autoMode = false;
let muted = false;
let lastFrameCaptureTs = 0;
const FRAME_THROTTLE_MS = 1500;

function setStatus(state) {
  const map = { connecting: ["", "Connecting..."], connected: ["connected", "Connected"], listening: ["listening", "Listening..."], thinking: ["listening", "Thinking..."], error: ["error", "Error"] };
  const [cls, text] = map[state] || ["", state];
  if (statusDot) statusDot.className = cls;
  if (statusText) statusText.textContent = text;
}

function addMessage(role, text) {
  if (!chatMessages || !text) return;
  const el = document.createElement("div");
  el.className = "chat-msg " + role + "-msg";
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

function setInterim(text) { if (interimText) interimText.textContent = text || ""; }

function sendQuery(text) {
  console.log("[SilverMoon] sendQuery called, text=", text, "connected=", isConnected());
  if (!text || !text.trim() || !isConnected()) { console.log("[SilverMoon] sendQuery aborted"); return; }
  setStatus("thinking");
  addMessage("user", text.trim());
  setInterim("");
  const msg = { type: "query", text: text.trim() };
  const now = Date.now();
  if (now - lastFrameCaptureTs >= FRAME_THROTTLE_MS) {
    const frame = captureFrame();
    if (frame) { msg.image = frame; lastFrameCaptureTs = now; }
  }
  send(msg);
}

function enterListeningMode() { if (muted) return; startListening(); setStatus("listening"); }
function exitListeningMode() { stopListening(); setStatus(isConnected() ? "connected" : "connecting"); }
function toggleAuto() { autoMode = !autoMode; btnAuto.classList.toggle("on", autoMode); autoMode ? enterListeningMode() : exitListeningMode(); }
function toggleMute() { muted = !muted; btnMute.classList.toggle("on", muted); btnMute.querySelector(".btn-icon").textContent = muted ? "\uD83D\uDD0A" : "\uD83D\uDD07"; if (muted) exitListeningMode(); else if (autoMode) enterListeningMode(); }

btnTalk.addEventListener("pointerdown", (e) => { e.preventDefault(); if (muted) return; btnTalk.classList.add("active"); enterListeningMode(); });
btnTalk.addEventListener("pointerup", (e) => { e.preventDefault(); btnTalk.classList.remove("active"); exitListeningMode(); });
btnTalk.addEventListener("pointerleave", () => { btnTalk.classList.remove("active"); exitListeningMode(); });
btnTalk.addEventListener("pointercancel", () => { btnTalk.classList.remove("active"); exitListeningMode(); });
btnAuto.addEventListener("click", toggleAuto);
btnMute.addEventListener("click", toggleMute);

async function init() {
  setStatus("connecting");
  setAudioCallbacks({
    onInterim: setInterim,
    onFinal: (text) => {
      console.log("[SilverMoon] onFinal called, text=", text);
      setInterim("");
      if (text && text.trim()) { console.log("[SilverMoon] calling sendQuery"); sendQuery(text.trim()); }
      else console.log("[SilverMoon] onFinal: empty text, skipping");
      if (autoMode && !muted) setTimeout(() => { if (autoMode && !muted) startListening(); }, 1500);
    },
    onState: (listening) => { setStatus(listening ? "listening" : (isConnected() ? "connected" : "connecting")); },
  });
  setWsCallbacks({
    onMsg: (data) => {
      console.log("[SilverMoon] WS message:", data.type, data.text ? data.text.substring(0, 50) : "");
      if (data.type === "response") { addMessage("assistant", data.text); speakText(data.text); if (isConnected()) setStatus("connected"); }
      else if (data.type === "error") { addMessage("system", "ERR: " + data.detail); setStatus("error"); }
      else if (data.type === "pong") { /* heartbeat */ }
    },
    onConn: (conn) => { setStatus(conn ? "connected" : "connecting"); },
  });
  // Connect WebSocket immediately
  connect();
  // Start hardware non-blocking
  try { await Promise.all([startCamera().catch(e => console.warn("Camera:", e)), requestMic().catch(e => console.warn("Mic:", e))]); }
  catch (e) { console.warn("Hardware:", e); }
  setInterval(() => { if (isConnected()) send({ type: "ping" }); }, 30000);
}

function speakText(text) { if (!window.speechSynthesis) return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.0; u.pitch = 1.0; const voices = speechSynthesis.getVoices(); const p = voices.find(v => v.lang.startsWith("zh") || v.lang.startsWith("en-US")); if (p) u.voice = p; speechSynthesis.speak(u); }
if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }

// Add text input fallback for debugging
(function() {
  const div = document.createElement("div");
  div.style.cssText = "display:flex;gap:8px;padding:4px 0";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type and press Enter (fallback)...";
  input.style.cssText = "flex:1;padding:8px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.5);color:#fff;font-size:14px;outline:none";
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) { sendQuery(input.value.trim()); input.value = ""; } });
  div.appendChild(input);
  const chatPanel = document.getElementById("chat-controls");
  if (chatPanel) chatPanel.insertBefore(div, chatPanel.firstChild);
})();

window.addEventListener("beforeunload", () => { stopCamera(); releaseMic(); disconnect(); });
init();
