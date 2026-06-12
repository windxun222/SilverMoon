"""SilverMoon configuration."""

import os

# Server
HOST: str = os.getenv("SILVERMOON_HOST", "0.0.0.0")
PORT: int = int(os.getenv("SILVERMOON_PORT", "8765"))

# Ollama
OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "minicpm-v4.5:8b")

# Cost Control
MAX_FRAME_SIZE_PX: int = 640
JPEG_QUALITY: int = 70
MIN_REQUEST_INTERVAL_S: float = 1.5
MAX_REQUESTS_PER_SESSION: int = 200
SESSION_IDLE_TIMEOUT_S: int = 300

# Conversation
MAX_CONTEXT_IMAGES: int = 3
MAX_HISTORY_TURNS: int = 8

# Logging
LOG_LEVEL: str = os.getenv("SILVERMOON_LOG_LEVEL", "INFO")
