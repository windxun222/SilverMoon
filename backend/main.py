import os, sys, base64, json, logging, time, ssl
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
  sys.path.insert(0, str(_PROJECT_ROOT))
_FRONTEND_DIR = str(_PROJECT_ROOT / "frontend")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

from backend.config import HOST, PORT, SESSION_IDLE_TIMEOUT_S, MAX_REQUESTS_PER_SESSION, LOG_LEVEL, OLLAMA_MODEL
from backend.cost_control import SessionBudget, compress_frame
from backend.ollama_client import OllamaClient

logging.basicConfig(level=getattr(logging, LOG_LEVEL.upper(), logging.INFO), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("silvermoon")

app = FastAPI(title="SilverMoon", version="0.1.0")
ollama = OllamaClient()


# Whisper model singleton
_whisper_model = None
def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        import os as _os
        _os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper_model

@app.get("/health")
async def health():
  return {"status": "ok", "version": "0.1.0", "model": OLLAMA_MODEL}

@app.get("/")
async def root():
  return FileResponse(str(_PROJECT_ROOT / "frontend" / "index.html"))

@app.post("/asr")
async def asr_endpoint(request: Request):
    import tempfile, os as _os
    data = await request.body()
    if not data or len(data) < 1000:
        return {"text": ""}
    wav = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
            t.write(data)
            wav = t.name
        model = _get_whisper()
        segments, _ = model.transcribe(wav, language="zh", beam_size=5)
        text = " ".join(s.text.strip() for s in segments if s.text.strip())
        return {"text": text}
    except Exception as e:
        logger.warning("Whisper ASR failed: %s", e)
        return {"text": ""}
    finally:
        if wav and _os.path.exists(wav):
            try: _os.unlink(wav)
            except: pass

@app.post("/tts")
async def tts_endpoint(request: Request):
    import tempfile, os as _os, asyncio
    data = await request.json()
    text = (data.get("text") or "").strip()
    if not text or len(text) > 500:
        return Response(content=b"", media_type="audio/mpeg")
    voice = data.get("voice", "zh-CN-XiaoyiNeural")
    rate = data.get("rate", "+20%")
    mp3_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            mp3_path = tmp.name
        from edge_tts import Communicate
        tts = Communicate(text, voice, rate=rate)
        await tts.save(mp3_path)
        if _os.path.exists(mp3_path) and _os.path.getsize(mp3_path) > 0:
            with open(mp3_path, "rb") as f:
                audio = f.read()
            return Response(content=audio, media_type="audio/mpeg")
        return Response(content=b"", media_type="audio/mpeg")
    except Exception as e:
        logger.warning("TTS failed: %s", e)
        return Response(content=b"", media_type="audio/mpeg")
    finally:
        if mp3_path and _os.path.exists(mp3_path):
            try: _os.unlink(mp3_path)
            except: pass

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
  await ws.accept()
  budget = SessionBudget()
  history: list[dict] = []
  logger.info("WebSocket connected")
  try:
    while True:
      raw = await ws.receive_text()
      budget.last_activity_ts = time.time()
      try:
        msg = json.loads(raw)
      except json.JSONDecodeError:
        await ws.send_json({"type": "error", "detail": "Invalid JSON"})
        continue
      msg_type = msg.get("type")
      if msg_type == "ping":
        await ws.send_json({"type": "pong"})
        continue
      if msg_type != "query":
        await ws.send_json({"type": "error", "detail": f"Unknown type: {msg_type}"})
        continue
      if not budget.can_request():
        detail = "Rate limit reached. Please wait." if budget.request_count >= MAX_REQUESTS_PER_SESSION else "Too many requests."
        await ws.send_json({"type": "error", "detail": detail})
        continue
      user_text = (msg.get("text") or "").strip()
      if not user_text:
        await ws.send_json({"type": "error", "detail": "Empty text"})
        continue
      image_b64 = None
      raw_image_b64 = msg.get("image")
      if raw_image_b64:
        try:
          image_bytes = base64.b64decode(raw_image_b64)
          compressed = await compress_frame(image_bytes)
          image_b64 = base64.b64encode(compressed).decode("utf-8")
        except Exception:
          logger.exception("Image decode failed")
      budget.record_request()
      try:
        response_text = await ollama.chat(user_text=user_text, image_base64=image_b64, history=history)
      except Exception as e:
        logger.exception("Ollama call failed")
        await ws.send_json({"type": "error", "detail": f"Model error: {e}"})
        continue
      history.append({"role": "user", "content": user_text})
      history.append({"role": "assistant", "content": response_text})
      await ws.send_json({"type": "response", "text": response_text})
      logger.info("Response sent: %d chars", len(response_text))
      if budget.is_idle(SESSION_IDLE_TIMEOUT_S):
        logger.info("Session idle timeout")
        await ws.close()
        break
  except WebSocketDisconnect:
    logger.info("WebSocket disconnected (requests: %d)", budget.request_count)
  except Exception:
    logger.exception("WebSocket error")
  finally:
    await ollama.close()

try:
  app.mount("/static", StaticFiles(directory=_FRONTEND_DIR), name="static")
except RuntimeError:
  pass

if __name__ == "__main__":
  import uvicorn
  logger.info("Starting SilverMoon on %s:%d", HOST, PORT)
  logger.info("Ollama model: %s", OLLAMA_MODEL)
  _ssl_cert = str(_PROJECT_ROOT / "cert.pem")
  _ssl_key = str(_PROJECT_ROOT / "key.pem")
  _ssl_kwargs = {}
  if Path(_ssl_cert).exists() and Path(_ssl_key).exists():
    _ssl_kwargs = {"ssl_certfile": _ssl_cert, "ssl_keyfile": _ssl_key, "ssl_version": ssl.PROTOCOL_TLS_SERVER}
    logger.info("HTTPS enabled (TLS 1.2+)")
  uvicorn.run(app, host=HOST, port=PORT, log_level=LOG_LEVEL.lower(), **_ssl_kwargs)
