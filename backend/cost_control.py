"""Cost-control layer: rate limiting, frame throttling."""

import time
import logging
from dataclasses import dataclass, field
from backend.config import (
    MIN_REQUEST_INTERVAL_S,
    MAX_REQUESTS_PER_SESSION,
    MAX_FRAME_SIZE_PX,
    JPEG_QUALITY,
)

logger = logging.getLogger(__name__)


@dataclass
class SessionBudget:
    last_request_ts: float = 0.0
    request_count: int = 0
    last_activity_ts: float = field(default_factory=time.time)

    def can_request(self) -> bool:
        now = time.time()
        if self.request_count >= MAX_REQUESTS_PER_SESSION:
            return False
        if now - self.last_request_ts < MIN_REQUEST_INTERVAL_S:
            return False
        return True

    def record_request(self):
        now = time.time()
        self.last_request_ts = now
        self.request_count += 1
        self.last_activity_ts = now

    def is_idle(self, timeout_s: int) -> bool:
        return (time.time() - self.last_activity_ts) > timeout_s


async def compress_frame(image_bytes: bytes) -> bytes:
    try:
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("RGB")

        w, h = img.size
        scale = min(MAX_FRAME_SIZE_PX / max(w, h), 1.0)
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return out.getvalue()
    except Exception:
        logger.exception("Frame compression failed, sending original bytes")
        return image_bytes
