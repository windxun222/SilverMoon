/**
 * Camera module - opens rear-facing camera, captures JPEG frames.
 */
const MAX_FRAME_DIM = 640;
const JPEG_QUALITY = 0.7;

let videoEl = null;
let canvasEl = null;
let stream = null;

async function startCamera() {
  videoEl = document.getElementById("camera-video");
  canvasEl = document.getElementById("camera-canvas");

  // Video only first (more reliable on mobile)
  const constraints = {
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  videoEl.srcObject = stream;
  await videoEl.play();
  await new Promise((resolve) => { videoEl.addEventListener("loadeddata", resolve, { once: true }); });
}

function captureFrame() {
  if (!videoEl || !canvasEl || videoEl.readyState < 2) return null;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (vw === 0 || vh === 0) return null;
  let w = vw, h = vh;
  const scale = Math.min(MAX_FRAME_DIM / Math.max(w, h), 1.0);
  w = Math.round(w * scale); h = Math.round(h * scale);
  canvasEl.width = w; canvasEl.height = h;
  canvasEl.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  return canvasEl.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (videoEl) videoEl.srcObject = null;
}


/**
 * Audio module - mic access + Web Speech API STT.
 */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isListening = false;
let micStream = null;

let onInterimResult = null;
let onFinalResult = null;
let onStateChange = null;

async function requestMic() {
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { console.warn("Mic access denied:", e); }
}

function setCallbacks({ onInterim, onFinal, onState }) {
  onInterimResult = onInterim;
  onFinalResult = onFinal;
  onStateChange = onState;
}

function startListening() {
  if (!SpeechRecognition) { console.warn("SpeechRecognition not available"); return; }
  if (isListening) { console.log("[audio] Already listening, skip"); return; }
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "zh-CN";

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    console.log("[audio] onresult, interim=", interim, "final=", final);
    if (interim && onInterimResult) onInterimResult(interim);
    if (final && onFinalResult) onFinalResult(final);
  };

  recognition.onerror = (event) => {
    console.warn("[audio] error:", event.error);
    stopListening();
  };

  recognition.onend = () => {
    console.log("[audio] onend");
    isListening = false;
    if (onStateChange) onStateChange(false);
  };

  recognition.start();
  isListening = true;
  if (onStateChange) onStateChange(true);
  console.log("[audio] recognition started");
}

function stopListening() {
  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  isListening = false;
  console.log("[audio] recognition stopped");
}

function releaseMic() {
  stopListening();
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}




 /**
  * WebSocket module 闂?connects to SilverMoon backend,
  * handles send/receive, auto-reconnect.
  */
 
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
 const RECONNECT_DELAY_MS = 2000;
 const MAX_RECONNECT_DELAY_MS = 30000;
 
 let ws = null;
 let reconnectTimer = null;
 let reconnectAttempts = 0;
 
 let onMessage = null; // (data: object) => void
 let onConnectionChange = null; // (connected: boolean) => void
 
 function setCallbacks({ onMsg, onConn }) {
   onMessage = onMsg;
   onConnectionChange = onConn;
 }
 
 function connect() {
   if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
     return;
   }
 
   ws = new WebSocket(WS_URL);
 
   ws.onopen = () => {
     console.log("WebSocket connected");
     reconnectAttempts = 0;
     if (onConnectionChange) onConnectionChange(true);
   };
 
   ws.onmessage = (event) => {
     try {
       const data = JSON.parse(event.data);
       if (onMessage) onMessage(data);
     } catch (e) {
       console.warn("Invalid WS message:", event.data);
     }
   };
 
   ws.onclose = () => {
     console.log("WebSocket closed");
     if (onConnectionChange) onConnectionChange(false);
     scheduleReconnect();
   };
 
   ws.onerror = (e) => {
     console.warn("WebSocket error:", e);
   };
 }
 
 function send(data) {
   if (ws && ws.readyState === WebSocket.OPEN) {
     ws.send(JSON.stringify(data));
   } else {
     console.warn("WebSocket not open, dropping message");
   }
 }
 
 function disconnect() {
   if (reconnectTimer) {
     clearTimeout(reconnectTimer);
     reconnectTimer = null;
   }
   if (ws) {
     ws.onclose = null; // prevent reconnect
     ws.close();
     ws = null;
   }
 }
 
 function scheduleReconnect() {
   if (reconnectTimer) return;
   const delay = Math.min(
     RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
     MAX_RECONNECT_DELAY_MS,
   );
   reconnectAttempts++;
   console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
   reconnectTimer = setTimeout(() => {
     reconnectTimer = null;
     connect();
   }, delay);
 }
 
 function isConnected() {
   return ws && ws.readyState === WebSocket.OPEN;
 }


/**
 * SilverMoon App - single file, no imports.
 */
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
let lastFrameCaptureTs = 0, visionTimer = null;
let _audioCtx = null, _pcmChunks = [], _autoTimer = null;
const FRAME_THROTTLE_MS = 1500, VISION_INTERVAL_MS = 4000, ASR_RATE = 16000, ASR_MS = 4000;

function setStatus(s) {
  const m = { connecting: ["","闁哄鏅濋崑鐐垫暜鐎涙鈻?.."], connected: ["connected","閻庤鐡曠亸顏嗘崲濞戙垹绠?], listening: ["listening","闂佺厧宕Λ妤呭箚婢跺鈻?.."], thinking: ["listening","闂佽鍓氱换鍡涘焵椤掆偓閸熲晠鎳?.."], capturing: ["","闂佺懓鍢茬粔鐢稿箟濮橆厾鈻?.."], error: ["error","闂備焦瀵ч悷銊╊敋?] };
  const [c,t] = m[s]||["",s]; if(statusDot)statusDot.className=c; if(statusText)statusText.textContent=t;
}
function addMessage(role, text) {
  if(!chatMessages||!text)return; const e=document.createElement("div"); e.className="chat-msg "+role+"-msg"; e.textContent=text; chatMessages.appendChild(e); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function setInterim(t) { if(interimText)interimText.textContent=t||""; }
function showCI(l,c) { if(!cameraIndicator)return; cameraIndicator.classList.remove("hidden"); cameraIndicator.classList.toggle("capturing",!!c); if(cameraIcon)cameraIcon.textContent=c?"濡絽鍟幊?:"濡絽鍟幊?; const x=cameraIndicator.querySelector("span:last-child"); if(x)x.textContent=l||"闂佺妫勭€氼剟宕曞顓炵窞闁哄鍨堕惃鎴犵磽?; }

function sendQuery(text) {
  if(!text||!text.trim()||!isConnected())return;
  setStatus("thinking"); addMessage("user",text.trim()); setInterim("");
  const msg={type:"query",text:text.trim()}, f=captureFrame();
  if(f){msg.image=f;lastFrameCaptureTs=Date.now();showCI("閻庡湱顭堝鑸靛垔閸ф绠?,true);setTimeout(()=>showCI("闂佺妫勭€氼剟宕曞顓炵窞闁哄鍨堕惃鎴犵磽?,false),1000);}
  send(msg);
}

function sendVisionQuery() { if(!isConnected()||!visionMode)return; const f=captureFrame(); if(!f)return; send({type:"query",text:"闂佹椿娼块崝瀣博閹绢喖鐭楅柕澶堝妿濡牓鏌熺拠鑼闁割偒浜濋幏鍛存偐閻戔晛浜炬慨妯虹－缁犳牠鏌熼挊澶婎仼闁稿孩纰嶅鍕偓闈涙啞缁犳瑩鏌涢幒妤婃殥缂併劉鍓濈粋鎺楀焵椤掍胶鈻曢柛顐ｇ▓閸?,image:f}); lastFrameCaptureTs=Date.now();showCI("闂佺懓鍢茬粔鐢稿箟濮橆厾鈻?..",true); }
function startVisionLoop() { stopVisionLoop(); if(!visionMode)return; showCI("闁荤喐鐟ュΛ婊堬綖鎼粹槅鍟呴柟缁樺笧绾惧鏌?,false); visionTimer=setInterval(()=>{if(visionMode&&isConnected())sendVisionQuery();},VISION_INTERVAL_MS); }
function stopVisionLoop() { if(visionTimer){clearInterval(visionTimer);visionTimer=null;} }
let _camStarted=false; function startCamOnce(){if(_camStarted)return;_camStarted=true;startCamera().then(()=>{if(cameraIndicator)cameraIndicator.classList.remove("hidden");}).catch(e=>console.warn("Camera:",e));}
function toggleVision() { startCamOnce(); visionMode=!visionMode; btnVision.classList.toggle("on",visionMode); visionMode?(startVisionLoop(),sendVisionQuery()):(stopVisionLoop(),cameraIndicator&&cameraIndicator.classList.add("hidden"),setStatus(isConnected()?"閻庤鐡曠亸顏嗘崲濞戙垹绠?:"connecting")); }

function enterLM() { if(muted)return; startListening(); setStatus("listening"); }
function exitLM() { stopListening(); setStatus(isConnected()?"閻庤鐡曠亸顏嗘崲濞戙垹绠?:"connecting"); }
btnTalk.addEventListener("pointerdown",e=>{e.preventDefault();if(muted)return;btnTalk.classList.add("active");enterLM();});
btnTalk.addEventListener("pointerup",e=>{e.preventDefault();btnTalk.classList.remove("active");exitLM();});
btnTalk.addEventListener("pointerleave",()=>{btnTalk.classList.remove("active");exitLM();});
btnTalk.addEventListener("pointercancel",()=>{btnTalk.classList.remove("active");exitLM();});

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
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: ASR_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    _audioCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:ASR_RATE});
    const src=_audioCtx.createMediaStreamSource(micStream), proc=_audioCtx.createScriptProcessor(4096,1,1);
    _pcmChunks=[]; src.connect(proc); proc.connect(_audioCtx.destination);
    proc.onaudioprocess=e=>{const d=e.inputBuffer.getChannelData(0); for(let i=0;i<d.length;i++)_pcmChunks.push(Math.round(d[i]*32767));};
    setStatus("listening"); console.log("[auto] ASR started");
    _autoTimer=setInterval(async()=>{if(_pcmChunks.length===0)return;const w=encodeWAV(_pcmChunks);_pcmChunks=[];setStatus("thinking");
      try{const r=await fetch("/asr",{method:"POST",body:w}),d=await r.json();if(d.text&&d.text.trim()){console.log("[auto] ASR:",d.text);sendQuery(d.text.trim());}}catch(e){console.warn("[auto] ASR:",e);}},ASR_MS);
  }catch(e){console.warn("[auto] Mic failed:",e);addMessage("system","婵°倗娅㈢粻鎴﹀储閻樻剚妲归幖娣灪缂嶁偓闂傚倸瀚崝姗€锝為敃鍌氱闁圭儤姊婚崡婊堟煥濞戞鐒锋い鏇ㄥ墴瀹曠兘濡搁敂淇卞仸闁荤喐鐟ラ悧鍡椻枍閹烘梹濯奸柛鎾楀懏鐎繛鎴炴惄閸樺ジ宕㈤幋鐘冲?);setStatus("error");}
}
function stopAutoASR() { if(_autoTimer){clearInterval(_autoTimer);_autoTimer=null;} if(_audioCtx){try{_audioCtx.close();}catch(_){}_audioCtx=null;} _pcmChunks=[]; }

function toggleAuto() { startCamOnce(); autoMode=!autoMode; btnAuto.classList.toggle("on",autoMode); autoMode?startAutoASR():stopAutoASR(); }
function toggleMute() { muted=!muted; btnMute.classList.toggle("on",muted); btnMute.querySelector(".btn-icon").textContent=muted?"濡絽鍟弫?:"濡絽鍟弫?; muted?stopAutoASR():(autoMode&&startAutoASR()); }
function toggleSpeaker() { speakerOn=!speakerOn; if(btnSpeaker){btnSpeaker.classList.toggle("on",!speakerOn);btnSpeaker.querySelector(".btn-icon").textContent=speakerOn?"濡絽鍟弫?:"濡絽鍟弫?;} if(!speakerOn&&window.speechSynthesis)window.speechSynthesis.cancel(); }

btnVision.addEventListener("click",toggleVision);
btnAuto.addEventListener("click",toggleAuto);
btnMute.addEventListener("click",toggleMute);
btnSpeaker.addEventListener("click",toggleSpeaker);

setStatus("connecting");
setCallbacks({ onInterim:setInterim, onFinal:t=>{setInterim("");if(t&&t.trim())sendQuery(t.trim());}, onState:l=>{setStatus(l?"listening":(isConnected()?"閻庤鐡曠亸顏嗘崲濞戙垹绠?:"connecting"));} });
setWsCallbacks({
  onMsg: d => {
    if(d.type==="response"){ addMessage(visionMode?"vision":"assistant",d.text); if(speakerOn&&!visionMode)speakText(d.text); if(isConnected())setStatus("閻庤鐡曠亸顏嗘崲濞戙垹绠?); }
    else if(d.type==="error"){ addMessage("system","闂備焦瀵ч悷銊╊敋? "+d.detail);setStatus("error"); }
  },
  onConn: c => { setStatus(c?"閻庤鐡曠亸顏嗘崲濞戙垹绠?:"connecting"); if(c&&visionMode)startVisionLoop(); }
});
connect();
setTimeout(() => { if(statusText&&statusText.textContent==='闁哄鏅濋崑鐐垫暜鐎涙鈻?..') setStatus('閻庤鐡曠亸顏嗘崲濞戙垹绠?); }, 2000);
setInterval(() => { if(isConnected())send({type:"ping"}); }, 30000);



let _a=null; function initTTS(){_a=document.createElement("audio");_a.style.display="none";document.body.appendChild(_a);}
async function speakText(t){if(!t)return;if(!_a)initTTS();try{const r=await fetch("/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t})});if(!r.ok)return;const b=await r.blob(),u=URL.createObjectURL(b);_a.src=u;_a.onended=()=>{URL.revokeObjectURL(u)};_a.onerror=()=>{URL.revokeObjectURL(u)};await _a.play();}catch(e){console.warn("TTS:",e);}}

!function(){const d=document.createElement("div");d.style.cssText="display:flex;gap:8px;padding:4px 0";const i=document.createElement("input");i.type="text";i.placeholder="闁哄鐗婇幐鎼佸矗閸℃せ妲堥柛顐ゅ枍缁辨牠鏌ㄥ☉妯垮婵炲弶鐗楀顏堟晝閳ь剝銇愰崒鐐寸劵?..";i.style.cssText="flex:1;padding:8px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.5);color:#fff;font-size:14px;outline:none";i.addEventListener("keydown",e=>{if(e.key==="Enter"&&i.value.trim()){sendQuery(i.value.trim());i.value="";}});d.appendChild(i);const p=document.getElementById("chat-controls");if(p)p.insertBefore(d,p.firstChild);}();

window.addEventListener("beforeunload",()=>{stopVisionLoop();stopAutoASR();stopCamera();releaseMic();disconnect();});