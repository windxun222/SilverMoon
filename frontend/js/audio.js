/**
 * Audio module - mic access + Web Speech API STT.
 */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let _recId = 0;
let isListening = false;
let micStream = null;

let onInterimResult = null;
let onFinalResult = null;
let onStateChange = null;

export async function requestMic() {
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { console.warn("Mic access denied:", e); }
}

export function setCallbacks({ onInterim, onFinal, onState }) {
  onInterimResult = onInterim;
  onFinalResult = onFinal;
  onStateChange = onState;
}

export function startListening() {
  if (!SpeechRecognition) { console.warn("SpeechRecognition not available"); return; }
  if (isListening) return;
  const myId = ++_recId;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "zh-CN";

  recognition.onresult = (event) => {
    if (myId !== _recId) return;
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    if (interim && onInterimResult) onInterimResult(interim);
    if (final && onFinalResult) onFinalResult(final);
  };

  recognition.onerror = (event) => {
    if (myId !== _recId) return;
    console.warn("STT error:", event.error);
    stopListening();
  };

  recognition.onend = () => {
    if (myId !== _recId) return;
    isListening = false;
    if (onStateChange) onStateChange(false);
  };

  recognition.start();
  isListening = true;
  if (onStateChange) onStateChange(true);
}

export function stopListening() {
  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  isListening = false;
}

export function releaseMic() {
  stopListening();
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}

export { isListening };
