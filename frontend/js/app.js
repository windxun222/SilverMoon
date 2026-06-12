 /**
  * SilverMoon App – orchestrates camera, audio (STT), WebSocket, and chat UI.
  *
  * Two interaction modes:
  *   1. Push-to-talk  – hold the mic button to speak, release to send
  *   2. Auto           – continuous listening; each final utterance triggers a query
  *
  * Cost-control on the client side:
  *   • Frame capture is throttled to at most one every 1.5 s
  *   • Frames only captured when a query is actually being sent
  *   • STT is entirely client-side (Web Speech API) – zero server cost
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
 
 // ── DOM refs ────────────────────────────────────────────
 const statusDot = document.getElementById("status-dot");
 const statusText = document.getElementById("status-text");
 const chatMessages = document.getElementById("chat-messages");
 const interimText = document.getElementById("interim-text");
 const btnTalk = document.getElementById("btn-talk");
 const btnAuto = document.getElementById("btn-auto");
 const btnMute = document.getElementById("btn-mute");
 
 // ── State ───────────────────────────────────────────────
 let autoMode = false;
 let muted = false;
 let lastFrameCaptureTs = 0;
 const FRAME_THROTTLE_MS = 1500; // match backend MIN_REQUEST_INTERVAL_S
 
 // ── Status helpers ──────────────────────────────────────
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
 
 // ── Chat UI ─────────────────────────────────────────────
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
 
 // ── Send query ──────────────────────────────────────────
 function sendQuery(text) {
   if (!text || !isConnected()) return;
 
   setStatus("thinking");
   addMessage("user", text);
   setInterim("");
 
   const msg = { type: "query", text };
 
   // Throttled frame capture
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
 
 // ── Microphone mode management ──────────────────────────
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
 
   if (autoMode) {
     enterListeningMode();
   } else {
     exitListeningMode();
   }
 }
 
 function toggleMute() {
   muted = !muted;
   btnMute.classList.toggle("on", muted);
   btnMute.querySelector(".btn-icon").textContent = muted ? "🔊" : "🔇";
 
   if (muted) {
     exitListeningMode();
   } else if (autoMode) {
     enterListeningMode();
   }
 }
 
 // ── Push-to-talk (hold to speak) ────────────────────────
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
 
 // ── Auto / Mute buttons ─────────────────────────────────
 btnAuto.addEventListener("click", toggleAuto);
 btnMute.addEventListener("click", toggleMute);
 
 // ── Boot sequence ───────────────────────────────────────
 async function init() {
   setStatus("connecting");
 
   // Wire up cross-module callbacks
   setAudioCallbacks({
     onInterim: setInterim,
     onFinal: (text) => {
       setInterim("");
       if (text) sendQuery(text);
       // In auto mode, restart listening after a short cooldown
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
         // Speak the response via TTS
         speakText(data.text);
         if (isConnected()) setStatus("connected");
       } else if (data.type === "error") {
         addMessage("system", `⚠️ ${data.detail}`);
         setStatus("error");
       } else if (data.type === "pong") {
         // heartbeat OK
       }
     },
     onConn: (conn) => {
       if (conn) {
         setStatus("connected");
       } else {
         setStatus("connecting");
       }
     },
   });
 
   // Start hardware
   try {
     await Promise.all([startCamera(), requestMic()]);
   } catch (e) {
     console.error("Hardware init failed:", e);
     addMessage("system", "❌ Camera or microphone access denied. Please allow permissions.");
     setStatus("error");
     return;
   }
 
   // Connect WebSocket
   connect();
 
   // Heartbeat ping every 30 s
   setInterval(() => {
     if (isConnected()) send({ type: "ping" });
   }, 30000);
 }
 
 // ── TTS (client-side, no server cost) ───────────────────
 function speakText(text) {
   if (!window.speechSynthesis) return;
   // Cancel any ongoing speech
   window.speechSynthesis.cancel();
 
   const utterance = new SpeechSynthesisUtterance(text);
   utterance.rate = 1.0;
   utterance.pitch = 1.0;
 
   // Try to find a good voice
   const voices = window.speechSynthesis.getVoices();
   const preferred = voices.find(
     (v) => v.lang.startsWith("zh") || v.lang.startsWith("en-US"),
   );
   if (preferred) utterance.voice = preferred;
 
   window.speechSynthesis.speak(utterance);
 }
 
 // Ensure voices are loaded
 if (window.speechSynthesis) {
   window.speechSynthesis.getVoices();
   window.speechSynthesis.onvoiceschanged = () => {
     window.speechSynthesis.getVoices();
   };
 }
 
 // ── Cleanup on page unload ──────────────────────────────
 window.addEventListener("beforeunload", () => {
   stopCamera();
   releaseMic();
   disconnect();
 });
 
 // ── Start ───────────────────────────────────────────────
 init();
