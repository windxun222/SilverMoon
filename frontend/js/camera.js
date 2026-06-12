/**
 * Camera module - opens rear-facing camera, captures JPEG frames.
 */
const MAX_FRAME_DIM = 640;
const JPEG_QUALITY = 0.7;

let videoEl = null;
let canvasEl = null;
let stream = null;

export async function startCamera() {
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

export function captureFrame() {
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

export function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (videoEl) videoEl.srcObject = null;
}
