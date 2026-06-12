 /**
  * Camera module – opens rear-facing camera, captures JPEG frames.
  *
  * Cost-control: frames are captured on demand, not streamed.
  * Resolution is constrained by the video element; JS-side resize
  * happens via canvas drawImage with a capped target dimension.
  */
 
 const MAX_FRAME_DIM = 640; // match backend MAX_FRAME_SIZE_PX
 const JPEG_QUALITY = 0.7;
 
 let videoEl = null;
 let canvasEl = null;
 let stream = null;
 
 /**
  * Start the camera and return a promise that resolves when the
  * first frame is ready. Prefers the environment-facing camera
  * on mobile; falls back to any available camera.
  */
 export async function startCamera() {
   videoEl = document.getElementById("camera-video");
   canvasEl = document.getElementById("camera-canvas");
 
   const constraints = {
     video: {
       facingMode: { ideal: "environment" },
       width: { ideal: 1280 },
       height: { ideal: 720 },
     },
     audio: false,
   };
 
   try {
     stream = await navigator.mediaDevices.getUserMedia(constraints);
   } catch {
     // Fallback: any camera
     stream = await navigator.mediaDevices.getUserMedia({
       video: true,
       audio: false,
     });
   }
 
   videoEl.srcObject = stream;
   await videoEl.play();
 
   // Wait for the first frame to actually render
   await new Promise((resolve) => {
     videoEl.addEventListener("loadeddata", resolve, { once: true });
   });
 }
 
 /**
  * Capture the current video frame as a base64 JPEG string (no data-URI prefix).
  * Returns null if camera is not ready.
  */
 export function captureFrame() {
   if (!videoEl || !canvasEl || videoEl.readyState < 2) return null;
 
   const vw = videoEl.videoWidth;
   const vh = videoEl.videoHeight;
   if (vw === 0 || vh === 0) return null;
 
   // Downscale to MAX_FRAME_DIM on the longer side
   let w = vw;
   let h = vh;
   const scale = Math.min(MAX_FRAME_DIM / Math.max(w, h), 1.0);
   w = Math.round(w * scale);
   h = Math.round(h * scale);
 
   canvasEl.width = w;
   canvasEl.height = h;
   const ctx = canvasEl.getContext("2d");
   ctx.drawImage(videoEl, 0, 0, w, h);
 
   return canvasEl.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
 }
 
 /**
  * Stop the camera and release the media stream.
  */
 export function stopCamera() {
   if (stream) {
     stream.getTracks().forEach((t) => t.stop());
     stream = null;
   }
   if (videoEl) {
     videoEl.srcObject = null;
   }
 }
