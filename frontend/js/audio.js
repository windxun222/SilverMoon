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

export function stopListening() {
  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  isListening = false;
  console.log("[audio] recognition stopped");
}

export function releaseMic() {
  stopListening();
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}

export { isListening };
