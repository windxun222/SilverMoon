/**
 * SilverMoon App - visual conversation with backend ASR auto mode.
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

let autoMode = false, visionMode = false, speakerOn = true, muted = false;
let lastFrameCaptureTs = 0, visionTimer = null, _autoTimer = null;
let _audioCtx = null, _audioStream = null, _pcmChunks = [];
const FRAME_THROTTLE_MS = 1500, VISION_INTERVAL_MS = 4000, ASR_RATE = 16000, ASR_MS = 4000;

function setStatus(s) {
  const m = { connecting: ["","连接中..."], connected: ["connected","已连接"], listening: ["listening","聆听中..."], thinking: ["listening","思考中..."], capturing: ["","拍摄中..."], error: ["error","错误"] };
  const [c,t] = m[s]||["",s]; if(statusDot)statusDot.className=c; if(statusText)statusText.textContent=t;
}
function addMessage(role, text) {
  if(!chatMessages||!text)return; const e=document.createElement("div"); e.className="chat-msg "+role+"-msg"; e.textContent=text; chatMessages.appendChild(e); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function setInterim(t) { if(interimText)interimText.textContent=t||""; }
function showCI(l,c) { if(!cameraIndicator)return; cameraIndicator.classList.remove("hidden"); cameraIndicator.classList.toggle("capturing",!!c); if(cameraIcon)cameraIcon.textContent=c?"\uD83D\uDCF8":"\uD83D\uDCF7"; const x=cameraIndicator.querySelector("span:last-child"); if(x)x.textContent=l||"摄像头就绪"; }

function sendQuery(text) {
  if(!text||!text.trim()||!isConnected())return;
  setStatus("thinking"); addMessage("user",text.trim()); setInterim("");
  const m={type:"query",text:text.trim()}, f=captureFrame();
  if(f){m.image=f;lastFrameCaptureTs=Date.now();showCI("已拍摄",true);setTimeout(()=>showCI("摄像头就绪",false),1000);}
  send(m);
}

function sendVisionQuery() { if(!isConnected()||!visionMode)return; const f=captureFrame(); if(!f)return; send({type:"query",text:"用一句话描述你通过摄像头看到了什么。",image:f}); lastFrameCaptureTs=Date.now(); showCI("拍摄中...",true); }
function startVisionLoop() { stopVisionLoop(); if(!visionMode)return; showCI("视觉已开启",false); visionTimer=setInterval(()=>{if(visionMode&&isConnected())sendVisionQuery();},VISION_INTERVAL_MS); }
function stopVisionLoop() { if(visionTimer){clearInterval(visionTimer);visionTimer=null;} }
function toggleVision() { visionMode=!visionMode; btnVision.classList.toggle("on",visionMode); visionMode?(startVisionLoop(),sendVisionQuery()):(stopVisionLoop(),cameraIndicator&&cameraIndicator.classList.add("hidden"),setStatus(isConnected()?"已连接":"connecting")); }

function enterLM() { if(muted)return; startListening(); setStatus("listening"); }
function exitLM() { stopListening(); setStatus(isConnected()?"已连接":"connecting"); }

// == AUTO MODE: AudioContext PCM-WAV + backend ASR ==
function encodeWAV(samples) {
  const n=samples.length, b=new ArrayBuffer(44+n*2), v=new DataView(b);
  const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  w(0,"RIFF");v.setUint32(4,36+n*2,true);w(8,"WAVE");w(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);
  v.setUint16(22,1,true);v.setUint32(24,ASR_RATE,true);v.setUint32(28,ASR_RATE*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
  w(36,"data");v.setUint32(40,n*2,true);
  for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.max(-32768,Math.min(32767,samples[i])),true);
  return new Blob([b],{type:"audio/wav"});
}
async function startAutoASR() {
  stopAutoASR(); if(!autoMode||muted)return;
  try {
    _audioStream=await navigator.mediaDevices.getUserMedia({audio:{sampleRate:ASR_RATE,channelCount:1,echoCancellation:true,noiseSuppression:true}});
    _audioCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:ASR_RATE});
    const src=_audioCtx.createMediaStreamSource(_audioStream), proc=_audioCtx.createScriptProcessor(4096,1,1);
    _pcmChunks=[]; src.connect(proc); proc.connect(_audioCtx.destination);
    proc.onaudioprocess=e=>{const d=e.inputBuffer.getChannelData(0); for(let i=0;i<d.length;i++)_pcmChunks.push(Math.round(d[i]*32767));};
    setStatus("listening"); console.log("[auto] AudioContext ASR started");
    _autoTimer=setInterval(async()=>{if(_pcmChunks.length===0)return;const w=encodeWAV(_pcmChunks);_pcmChunks=[];setStatus("thinking");
      try{const r=await fetch("/asr",{method:"POST",body:w}),d=await r.json();if(d.text&&d.text.trim()){console.log("[auto] ASR:",d.text);sendQuery(d.text.trim());}}catch(e){console.warn("[auto] ASR fetch:",e);}},ASR_MS);
  }catch(e){console.warn("[auto] Audio failed:",e);addMessage("system","麦克风不可用："+e.message);setStatus("error");}
}
function stopAutoASR() { if(_autoTimer){clearInterval(_autoTimer);_autoTimer=null;} if(_audioCtx){try{_audioCtx.close();}catch(_){}_audioCtx=null;} if(_audioStream){_audioStream.getTracks().forEach(t=>t.stop());_audioStream=null;} _pcmChunks=[]; }

function toggleAuto() { autoMode=!autoMode; btnAuto.classList.toggle("on",autoMode); autoMode?startAutoASR():stopAutoASR(); }
function toggleMute() { muted=!muted; btnMute.classList.toggle("on",muted); btnMute.querySelector(".btn-icon").textContent=muted?"\uD83D\uDD0A":"\uD83D\uDD07"; muted?stopAutoASR():(autoMode&&startAutoASR()); }
function toggleSpeaker() { speakerOn=!speakerOn; if(btnSpeaker){btnSpeaker.classList.toggle("on",!speakerOn);btnSpeaker.querySelector(".btn-icon").textContent=speakerOn?"\uD83D\uDD0A":"\uD83D\uDD07";} if(!speakerOn&&window.speechSynthesis)window.speechSynthesis.cancel(); }

btnTalk.addEventListener("pointerdown",e=>{e.preventDefault();if(muted)return;btnTalk.classList.add("active");enterLM();});
btnTalk.addEventListener("pointerup",e=>{e.preventDefault();btnTalk.classList.remove("active");exitLM();});
btnTalk.addEventListener("pointerleave",()=>{btnTalk.classList.remove("active");exitLM();});
btnTalk.addEventListener("pointercancel",()=>{btnTalk.classList.remove("active");exitLM();});
btnVision.addEventListener("click",toggleVision);
btnAuto.addEventListener("click",toggleAuto);
btnMute.addEventListener("click",toggleMute);
btnSpeaker.addEventListener("click",toggleSpeaker);

async function init() {
  setStatus("connecting");
  setAudioCallbacks({ onInterim:setInterim, onFinal:t=>{setInterim("");if(t&&t.trim())sendQuery(t.trim());}, onState:l=>{setStatus(l?"listening":(isConnected()?"已连接":"connecting"));} });
  setWsCallbacks({ onMsg:d=>{if(d.type==="response"){addMessage(visionMode?"vision":"assistant",d.text);if(speakerOn&&!visionMode)speakText(d.text);if(isConnected())setStatus("已连接");}else if(d.type==="error"){addMessage("system","错误: "+d.detail);setStatus("error");}}, onConn:c=>{setStatus(c?"已连接":"connecting");if(c&&visionMode)startVisionLoop();} });
  connect();
  try{await Promise.all([startCamera().catch(e=>console.warn("Camera:",e)),requestMic().catch(e=>console.warn("Mic:",e))]);}catch(e){console.warn("HW:",e);}
  if(cameraIndicator)cameraIndicator.classList.remove("hidden"); showCI("摄像头就绪",false);
  setInterval(()=>{if(isConnected())send({type:"ping"});},30000);
}

// TTS
let _a=null; function initTTS(){_a=document.createElement("audio");_a.style.display="none";document.body.appendChild(_a);}
async function speakText(t){if(!t)return;if(!_a)initTTS();try{const r=await fetch("/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t})});if(!r.ok)return;const b=await r.blob(),u=URL.createObjectURL(b);_a.src=u;_a.onended=()=>{URL.revokeObjectURL(u);if(isConnected())setStatus("已连接");};_a.onerror=()=>{URL.revokeObjectURL(u);};await _a.play();}catch(e){console.warn("TTS:",e);}}

// Text input
!function(){const d=document.createElement("div");d.style.cssText="display:flex;gap:8px;padding:4px 0";const i=document.createElement("input");i.type="text";i.placeholder="输入消息，回车发送...";i.style.cssText="flex:1;padding:8px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.5);color:#fff;font-size:14px;outline:none";i.addEventListener("keydown",e=>{if(e.key==="Enter"&&i.value.trim()){sendQuery(i.value.trim());i.value="";}});d.appendChild(i);const p=document.getElementById("chat-controls");if(p)p.insertBefore(d,p.firstChild);}();

window.addEventListener("beforeunload",()=>{stopVisionLoop();stopAutoASR();stopCamera();releaseMic();disconnect();});
init();
