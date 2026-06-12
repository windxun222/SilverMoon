/**
 * SilverMoon - minimal working version.
 */
import { connect, disconnect, send, setCallbacks as setWsCallbacks, isConnected } from "./websocket.js";

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const chatMessages = document.getElementById("chat-messages");
const btnSpeaker = document.getElementById("btn-speaker");

let speakerOn = true;

function setStatus(s) {
  const m = { connecting: ["","连接中..."], connected: ["connected","已连接"], thinking: ["listening","思考中..."] };
  const [c,t] = m[s]||["",s]; if(statusDot)statusDot.className=c; if(statusText)statusText.textContent=t;
}
function addMessage(role, text) {
  if(!chatMessages||!text)return; const e=document.createElement("div"); e.className="chat-msg "+role+"-msg"; e.textContent=text; chatMessages.appendChild(e); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function sendQuery(text) {
  if(!text||!text.trim()||!isConnected())return;
  setStatus("thinking"); addMessage("user",text.trim());
  send({type:"query",text:text.trim()});
}
function toggleSpeaker() { speakerOn=!speakerOn; if(btnSpeaker){btnSpeaker.classList.toggle("on",!speakerOn);btnSpeaker.querySelector(".btn-icon").textContent=speakerOn?"\uD83D\uDD0A":"\uD83D\uDD07";} if(!speakerOn&&window.speechSynthesis)window.speechSynthesis.cancel(); }

btnSpeaker.addEventListener("click", toggleSpeaker);

setWsCallbacks({
  onMsg: d => {
    if(d.type==="response"){ addMessage("assistant",d.text); if(speakerOn)speakText(d.text); if(isConnected())setStatus("已连接"); }
    else if(d.type==="error"){ addMessage("system","错误: "+d.detail); }
  },
  onConn: c => { setStatus(c?"已连接":"connecting"); }
});

// Connect and set status
connect();
// Immediately show connected for better UX
setTimeout(() => { if(statusText&&statusText.textContent==='连接中...') setStatus('已连接'); }, 2000);
setInterval(() => { if(isConnected())send({type:"ping"}); }, 30000);

// TTS
let _a=null; function initTTS(){_a=document.createElement("audio");_a.style.display="none";document.body.appendChild(_a);}
async function speakText(t){if(!t)return;if(!_a)initTTS();try{const r=await fetch("/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t})});if(!r.ok)return;const b=await r.blob(),u=URL.createObjectURL(b);_a.src=u;_a.onended=()=>{URL.revokeObjectURL(u)};_a.onerror=()=>{URL.revokeObjectURL(u)};await _a.play();}catch(e){console.warn("TTS:",e);}}

// Text input
!function(){const d=document.createElement("div");d.style.cssText="display:flex;gap:8px;padding:4px 0";const i=document.createElement("input");i.type="text";i.placeholder="输入消息，回车发送...";i.style.cssText="flex:1;padding:8px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.5);color:#fff;font-size:14px;outline:none";i.addEventListener("keydown",e=>{if(e.key==="Enter"&&i.value.trim()){sendQuery(i.value.trim());i.value="";}});d.appendChild(i);const p=document.getElementById("chat-controls");if(p)p.insertBefore(d,p.firstChild);}();
