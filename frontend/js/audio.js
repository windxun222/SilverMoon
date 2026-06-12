 /**
  * Audio module – mic access + Web Speech API STT.
  *
  * Cost-control rationale:
  *   Client-side STT means zero server processing cost for audio.
  *   Only the transcribed text (plus an optional frame) goes to the
  *   backend, keeping VLM calls lean.
  */
 
 const SpeechRecognition =
   window.SpeechRecognition || window.webkitSpeechRecognition;
 
 let recognition = null;
 let isListening = false;
 let micStream = null;
 
 // Callbacks set by app.js
 let onInterimResult = null; // (text: string) => void
 let onFinalResult = null;   // (text: string) => void
 let onStateChange = null;   // (listening: boolean) => void
 
 /**
  * Request microphone access (needed for SpeechRecognition on some
  * browsers). Call once on init.
  */
 export async function requestMic() {
   try {
     micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
   } catch (e) {
     console.warn("Mic access denied, STT may not work:", e);
   }
 }
 
 /**
  * Set event handlers.
  */
 export function setCallbacks({ onInterim, onFinal, onState }) {
   onInterimResult = onInterim;
   onFinalResult = onFinal;
   onStateChange = onState;
 }
 
 /**
  * Start speech recognition. Creates a fresh Recognition instance each
  * time for better mobile compatibility.
  */
 export function startListening() {
   if (!SpeechRecognition) {
     console.warn("SpeechRecognition not available");
     return;
   }
   if (isListening) return;
 
   recognition = new SpeechRecognition();
   recognition.continuous = false;
   recognition.interimResults = true;
   recognition.lang = "zh-CN"; // default; can be made configurable
 
   recognition.onresult = (event) => {
     let interim = "";
     let final = "";
     for (let i = event.resultIndex; i < event.results.length; i++) {
       const transcript = event.results[i][0].transcript;
       if (event.results[i].isFinal) {
         final += transcript;
       } else {
         interim += transcript;
       }
     }
     if (interim && onInterimResult) onInterimResult(interim);
     if (final && onFinalResult) onFinalResult(final);
   };
 
   recognition.onerror = (event) => {
     console.warn("STT error:", event.error);
     if (event.error === "no-speech" || event.error === "aborted") {
       // Normal – just restart if still in listening mode
     }
     stopListening();
   };
 
   recognition.onend = () => {
     isListening = false;
     if (onStateChange) onStateChange(false);
   };
 
   recognition.start();
   isListening = true;
   if (onStateChange) onStateChange(true);
 }
 
 /**
  * Stop the current recognition session.
  */
 export function stopListening() {
   if (recognition) {
     try { recognition.stop(); } catch (_) { /* already stopped */ }
     recognition = null;
   }
   isListening = false;
 }
 
 /**
  * Release microphone stream.
  */
 export function releaseMic() {
   stopListening();
   if (micStream) {
     micStream.getTracks().forEach((t) => t.stop());
     micStream = null;
   }
 }
 
 export { isListening };
