"""Async Ollama client for minicpm-v4.5:8b - vision + chat."""

import logging
from typing import Optional

import httpx

from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL, MAX_HISTORY_TURNS

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "你是 SilverMoon，一个实时视觉助手。"
    "你能看到用户手机摄像头当前的画面。"
    "请用中文回复，简洁自然地描述你看到的物体、人物、文字、颜色、场景。"
    "如果画面模糊或昏暗，简单提一下。每次回复控制在3句话以内。"
)


class OllamaClient:
    """Thin async wrapper around Ollama chat API."""

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self):
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=OLLAMA_BASE_URL,
                timeout=httpx.Timeout(60.0),
            )

    async def chat(
        self,
        user_text: str,
        image_base64: Optional[str] = None,
        history: Optional[list[dict]] = None,
    ) -> str:
        await self._ensure_client()

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        if history:
            recent = history[-(MAX_HISTORY_TURNS * 2):]
            messages.extend(recent)

        user_msg: dict = {"role": "user", "content": user_text}
        if image_base64:
            user_msg["images"] = [image_base64]
        messages.append(user_msg)

        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
        }

        logger.debug("Sending to Ollama: model=%s text_len=%d has_image=%s",
                      OLLAMA_MODEL, len(user_text), image_base64 is not None)

        try:
            resp = await self._client.post("/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return content.strip()
        except httpx.HTTPError as e:
            logger.error("Ollama request failed: %s", e)
            raise

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
