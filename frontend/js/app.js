/**
 * SilverMoon App - real-time visual conversation assistant.
 *
 * Modes:
 *   Push-to-talk: hold mic button, speak, release to send
 *   Auto: continuous listening, each utterance triggers query
 *   Vision: AI proactively describes what it sees every few seconds
 */
import { startCamera, captureFrame, stopCamera } from "./camera.js";
import { requestMic, startListening, stopListening, releaseMic, setCallbacks as setAudioCallbacks } from "./audio.js";
import { connect, disconnect, send, setCallbacks as setWsCallbacks, isConnected } from "./websocket.js";

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const chatMessages = document.getElementById("chat-messages");
const interimText = document.getElementById("interim-text");
const btnTalk = document.getElementById("btn-talk");
const btnVision = document.getElementById("btn-vision");
const btnAuto = document.getElementById("btn-auto");
const btnMute = document.getElementById("btn-mute");
const btnSpeaker = document.getElementById("btn-speaker");
const cameraIndicator = document.getElementById("camera-indicator");
const cameraIcon = document.getElementById("camera-icon");

let autoMode = false;
let visionMode = false;
let speakerOn = true;
let muted = false;
let lastFrameCaptureTs = 0;
let visionTimer = null;
const FRAME_THROTTLE_MS = 1500;
const VISION_INTERVAL_MS = 4000;

function setStatus(state) {
  const map = { connecting: ["", "连接中..."], connected: ["已连接", "已连接"], listening: ["listening", "聆听中..."], thinking: ["listening", "思考中..."], capturing: ["", "拍摄中..."], error: ["错误", "错误"] };
  const [cls, text] = map[state] || ["", state];
  if (statusDot) statusDot.className = cls;
  if (statusText) statusText.textContent = text;
}

function addMessage(role, text, imageSrc) {
  if (!chatMessages || !text) return;
  const el = document.createElement("div");
  el.className = "chat-msg " + role + "-msg";
  el.textContent = text;
  if (imageSrc) { const img = document.createElement("img"); img.className = "snapshot-preview"; img.src = imageSrc; el.appendChild(img); }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

function setInterim(text) { if (interimText) interimText.textContent = text || ""; }

function showCameraIndicator(label, capturing) {
  if (!cameraIndicator) return;
  cameraIndicator.classList.remove("hidden");
  cameraIndicator.classList.toggle("capturing", !!capturing);
  if (cameraIcon) cameraIcon.textContent = capturing ? "\u{1F4F8}" : "\u{1F4F7}";
  const lbl = cameraIndicator.querySelector("#camera-label, span:last-child");
  if (lbl) lbl.textContent = label || "摄像头就绪";
}

function sendQuery(text) {
  console.log("[SilverMoon] sendQuery, text=", text, "connected=", isConnected());
  if (!text || !text.trim() || !isConnected()) { console.log("[SilverMoon] sendQuery aborted"); return; }
  setStatus("thinking");
  addMessage("user", text.trim());
  setInterim("");
  const msg = { type: "query", text: text.trim() };
  const now = Date.now();
  const frame = captureFrame();
  if (frame) { msg.image = frame; lastFrameCaptureTs = now; showCameraIndicator("已拍摄", true); setTimeout(() => showCameraIndicator("摄像头就绪", false), 1000); }
  send(msg);
}

function sendVisionQuery() {
  if (!isConnected() || !visionMode) return;
  setStatus("capturing");
  const frame = captureFrame();
  if (!frame) { console.log("[SilverMoon] vision: no frame"); return; }
    const msg = { type: "query", text: "用一句话描述你通过摄像头看到了什么。", image: frame };
  send(msg);
  lastFrameCaptureTs = Date.now();
  showCameraIndicator("拍摄中...", true);
}

function startVisionLoop() {
  stopVisionLoop();
  if (!visionMode) return;
  showCameraIndicator("视觉已开启", false);
  visionTimer = setInterval(() => { if (visionMode && isConnected()) sendVisionQuery(); }, VISION_INTERVAL_MS);
}
function stopVisionLoop() { if (visionTimer) { clearInterval(visionTimer); visionTimer = null; } }

function toggleVision() {
  visionMode = !visionMode;
  btnVision.classList.toggle("on", visionMode);
  if (visionMode) {
    startVisionLoop();
    sendVisionQuery();
  } else {
    stopVisionLoop();
    if (cameraIndicator) cameraIndicator.classList.add("hidden");
    setStatus(isConnected() ? "已连接" : "connecting");
  }
}

function enterListeningMode() { if (muted) return; startListening(); setStatus("listening"); }
function exitListeningMode() { stopListeningMode(); }
function stopListeningMode() { stopListening(); setStatus(isConnected() ? "已连接" : "connecting"); }
function toggleAuto() { autoMode = !autoMode; btnAuto.classList.toggle("on", autoMode); if (autoMode) startAutoLoop(); else stopAutoLoop(); }
function toggleMute() {
  muted = !muted; btnMute.classList.toggle("on", muted);
  btnMute.querySelector(".btn-icon").textContent = muted ? "\uD83D\uDD0A" : "\uD83D\uDD07";
  if (muted) stopAutoLoop(); else if (autoMode) startAutoLoop();
}

btnTalk.addEventListener("pointerdown", (e) => { e.preventDefault(); if (muted) return; btnTalk.classList.add("active"); enterListeningMode(); });
btnTalk.addEventListener("pointerup", (e) => { e.preventDefault(); btnTalk.classList.remove("active"); exitListeningMode(); });
btnTalk.addEventListener("pointerleave", () => { btnTalk.classList.remove("active"); exitListeningMode(); });
btnTalk.addEventListener("pointercancel", () => { btnTalk.classList.remove("active"); exitListeningMode(); });
btnVision.addEventListener("click", toggleVision);
btnAuto.addEventListener("click", toggleAuto);
btnMute.addEventListener("click", toggleMute);
btnSpeaker.addEventListener("click", toggleSpeaker);

async function init() {
  setStatus("connecting");
  setAudioCallbacks({
    onInterim: setInterim,
    onFinal: (text) => {
      console.log("[SilverMoon] onFinal, text=", text);
      setInterim("");
      if (text && text.trim()) { console.log("[SilverMoon] calling sendQuery"); sendQuery(text.trim()); }
      else console.log("[SilverMoon] onFinal: empty text");
      
    },
    onState: (listening) => { setStatus(listening ? "listening" : (isConnected() ? "已连接" : "connecting")); },
  });
  setWsCallbacks({
    onMsg: (data) => {
      console.log("[SilverMoon] WS:", data.type, data.text ? data.text.substring(0, 50) : "");
      if (data.type === "response") {
        const role = visionMode ? "vision" : "assistant";
        addMessage(role, data.text);
        // Vision responses are silent to avoid spam; user queries get audio
        const isVision = visionMode;
        if (speakerOn && !isVision) speakText(data.text);
        if (isConnected()) setStatus(visionMode ? "已连接" : "已连接");
      } else if (data.type === "错误") {
        addMessage("system", "错误: " + data.detail);
        setStatus("错误");
      }
    },
    onConn: (conn) => {
      setStatus(conn ? "已连接" : "connecting");
      if (conn && visionMode) { startVisionLoop(); showCameraIndicator("视觉已开启", false); }
    },
  });
  connect();
  try { await Promise.all([startCamera().catch(e => console.warn("Camera:", e)), requestMic().catch(e => console.warn("Mic:", e))]); }
  catch (e) { console.warn("Hardware:", e); }
  if (cameraIndicator) cameraIndicator.classList.remove("hidden");
  showCameraIndicator("摄像头就绪", false);
  setInterval(() => { if (isConnected()) send({ type: "ping" }); }, 30000);
}

// --- Backend TTS (Windows SpeechSynthesizer, 100% reliable) ---
let _ttsAudio = null;

function initTTS() {
  _ttsAudio = document.createElement("audio");
  _ttsAudio.style.display = "none";
  document.body.appendChild(_ttsAudio);
}

async function speakText(text) {
  if (!text) return;
  if (!_ttsAudio) initTTS();
  try {
    const resp = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text })
    });
    if (!resp.ok) { console.warn("[SilverMoon] TTS HTTP error:", resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    _ttsAudio.src = url;
    _ttsAudio.onended = () => { URL.revokeObjectURL(url); if (isConnected()) setStatus("已连接"); };
    _ttsAudio.onerror = () => { URL.revokeObjectURL(url); if (isConnected()) setStatus("已连接"); };
    await _ttsAudio.play();
    console.log("[SilverMoon] TTS playing:", text.substring(0, 30));
  } catch(e) { console.warn("[SilverMoon] TTS failed:", e); }
}


// ===== Auto mode: silence-detection based, independent of audio.js =====
let _autoRec = null;
let _autoTimer = null;
let _autoSilenceTimer = null;
let _autoLastText = "";
let _autoLastTime = 0;
let _autoSent = false;
const AUTO_SILENCE_MS = 2000;
const AUTO_MAX_DURATION_MS = 15000;

function startAutoLoop() {
  stopAutoLoop();
  if (!autoMode || muted) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn("[auto] SpeechRecognition unavailable"); return; }
  _autoLastText = ""; _autoLastTime = Date.now(); _autoSent = false;
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = "zh-CN";
  rec.onresult = (e) => {
    let t = "";
    for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
    if (t) { setInterim(t); _autoLastText = t; _autoLastTime = Date.now(); setStatus("listening"); }
  };
  rec.onerror = (e) => { console.warn("[auto] error:", e.error); scheduleAutoRestart(); };
  rec.onend = () => {
    if (_autoLastText && !_autoSent) { _autoSent = true; setInterim(""); sendQuery(_autoLastText); }
    scheduleAutoRestart();
  };
  try { rec.start(); _autoRec = rec; setStatus("listening"); console.log("[auto] loop started"); }
  catch(e) { console.warn("[auto] start failed:", e); scheduleAutoRestart(); }
  // Silence timer: stop recognition if no speech for AUTO_SILENCE_MS
  _autoSilenceTimer = setInterval(() => {
    if (_autoLastText && !_autoSent && Date.now() - _autoLastTime > AUTO_SILENCE_MS) {
      if (_autoRec) { try { _autoRec.stop(); } catch(_) {} }
    }
  }, 500);
  // Max duration: force restart to prevent stuck state
  _autoTimer = setTimeout(() => { if (_autoRec) { try { _autoRec.stop(); } catch(_) {} } }, AUTO_MAX_DURATION_MS);
}

function scheduleAutoRestart() { stopAutoLoop(); if (autoMode && !muted) setTimeout(startAutoLoop, 1500); }

function stopAutoLoop() {
  if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
  if (_autoSilenceTimer) { clearInterval(_autoSilenceTimer); _autoSilenceTimer = null; }
  if (_autoRec) { try { _autoRec.stop(); } catch(_) {} _autoRec = null; }
  _autoSent = false;
}

// Text input fallback
(function() {
  const div = document.createElement("div");
  div.style.cssText = "display:flex;gap:8px;padding:4px 0";
  const input = document.createElement("input");
  input.type = "text"; input.placeholder = "输入消息，回车发送...";
  input.style.cssText = "flex:1;padding:8px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.5);color:#fff;font-size:14px;outline:none";
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) { sendQuery(input.value.trim()); input.value = ""; } });
  div.appendChild(input);
  const chatPanel = document.getElementById("chat-controls");
  if (chatPanel) chatPanel.insertBefore(div, chatPanel.firstChild);
})();

window.addEventListener("beforeunload", () => { stopVisionLoop(); stopAutoLoop(); stopCamera(); releaseMic(); disconnect(); });
init();
function toggleSpeaker() {
  speakerOn = !speakerOn;
  const btn = document.getElementById("btn-speaker");
  if (btn) {
    btn.classList.toggle("on", !speakerOn);
    btn.querySelector(".btn-icon").textContent = speakerOn ? "\uD83D\uDD0A" : "\uD83D\uDD07";
  }
  if (!speakerOn && window.speechSynthesis) window.speechSynthesis.cancel();
}
