"""SilverMoon backend: FastAPI + WebSocket server.

Data flow: Browser (Web Speech STT + camera JPEG) --WS--> FastAPI --HTTP--> Ollama (minicpm-v4.5:8b) --> response --> Browser (TTS).

Cost-control: client-side STT/TTS (free), JPEG resize+compress, 1.5s rate limit, 200 req/session cap, 5 min idle timeout.
"""

import os, sys, base64, json, logging, time
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
_FRONTEND_DIR = str(_PROJECT_ROOT / "frontend")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import (
     HOST,
     PORT,
     SESSION_IDLE_TIMEOUT_S,
     MAX_REQUESTS_PER_SESSION,
     LOG_LEVEL,
     OLLAMA_MODEL,
)
from backend.cost_control import SessionBudget, compress_frame
from backend.ollama_client import OllamaClient

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("silvermoon")

app = FastAPI(title="SilverMoon", version="0.1.0")
ollama = OllamaClient()


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0", "model": OLLAMA_MODEL}


@app.get("/")
async def root():
    return FileResponse(str(_PROJECT_ROOT / "frontend" / "index.html"))


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
                detail = (
                    "Rate limit reached. Please wait."
                    if budget.request_count >= MAX_REQUESTS_PER_SESSION
                    else "Too many requests. Wait before sending again."
                )
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
                    logger.debug("Frame compressed: %d -> %d bytes",
                                  len(image_bytes), len(compressed))
                except Exception:
                    logger.exception("Image decode failed, proceeding without image")

            budget.record_request()

            try:
                response_text = await ollama.chat(
                    user_text=user_text,
                    image_base64=image_b64,
                    history=history,
                )
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
    import uvicorn, ssl
    logger.info("Starting SilverMoon on %s:%d", HOST, PORT)
    logger.info("Ollama model: %s", OLLAMA_MODEL)
    _ssl_cert = str(_PROJECT_ROOT / "cert.pem")
    _ssl_key = str(_PROJECT_ROOT / "key.pem")
    _ssl_kwargs = {}
    if Path(_ssl_cert).exists() and Path(_ssl_key).exists():
        _ssl_kwargs = {
            "ssl_certfile": _ssl_cert,
            "ssl_keyfile": _ssl_key,
            "ssl_version": ssl.PROTOCOL_TLS_SERVER,
        }
        logger.info("HTTPS enabled (TLS 1.2+)")
    uvicorn.run(app, host=HOST, port=PORT, log_level=LOG_LEVEL.lower(), **_ssl_kwargs)
