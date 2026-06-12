# 🌙 SilverMoon — AI Visual Conversation Assistant

> 对准摄像头，自然说话。让你本地的 AI 看见你所见的，听见你所说的。

SilverMoon is a real-time vision-language assistant. Open the web app on your
phone, speak naturally or type, and a locally-running
[Ollama](https://ollama.com) **minicpm-v4.5:8b** model sees your camera,
hears your voice, and responds in natural Chinese speech.

---

## 🏗 Architecture

```
Mobile Browser (HTTPS)
 ├─ Camera  → JPEG capture (on-demand)
 ├─ Mic     → PCM → WAV → POST /asr (Whisper)
 └─ Speaker ← MP3 ← POST /tts (edge-tts)
      │
      │  WebSocket (wss://)
      │  {type:"query", text, image?}
      │  {type:"stream_token", content}  ← streaming
      │  {type:"stream_end"}
      ▼
FastAPI Server  (Python 3.11+)
 ├─ /ws         WebSocket handler + history
 ├─ /asr        faster-whisper base (Speech-to-Text)
 ├─ /tts        edge-tts XiaoyiNeural (Text-to-Speech)
 ├─ /health     Health check
 └─ /           Serves index.html (SPA)
      │
      ▼
Ollama  (local)
 └─ minicpm-v4.5:8b  (stream: true)
```

### Data flow

1. **Phone camera** → JPEG frame captured (on-demand, ≥1.5 s throttle)
2. **Phone mic** (Auto mode) → PCM → sent to `/asr` → Whisper transcribes to Chinese text
3. **WebSocket** → `{type: "query", text: "...", image: "<base64>"}` sent to FastAPI
4. **Server** → rate-limit check → JPEG compress → Ollama `/api/chat` with `stream: true`
5. **Streaming** → tokens pushed back as `stream_token` messages, frontend renders incrementally
6. **TTS** → sentence boundaries trigger `/tts` fetch → edge-tts Xiaoyi voice → `<audio>` playback

---

## 🛠 Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | Vanilla JS + HTML5 + CSS3 (single `index.html`) | Camera, mic, chat UI, TTS playback |
| **ASR** | faster-whisper (base, CPU int8) | Speech-to-text (backend) |
| **TTS** | edge-tts (zh-CN-XiaoyiNeural) | Text-to-speech (backend) |
| **Transport** | WebSocket (wss://) | Real-time streaming |
| **Server** | Python 3.11+ / FastAPI + uvicorn | Routes, WebSocket, ASR/TTS endpoints |
| **VLM** | Ollama + minicpm-v4.5:8b | Vision-language chat |
| **Image** | Pillow (PIL) | Frame resize & JPEG compression |

---

## 📦 Setup

### Prerequisites

- **Python 3.11+** with `pip`
- **Ollama** installed and running locally (`ollama serve`)
- **minicpm-v4.5:8b** model: `ollama pull minicpm-v4.5:8b`
- **HTTPS cert** — self-signed `cert.pem` + `key.pem` in project root:
  ```bash
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
  ```

### 1. Clone & install

```bash
git clone https://github.com/windxun222/SilverMoon.git
cd SilverMoon
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r backend/requirements.txt
```

### 2. Start

```bash
cd backend
python main.py
```

Server starts on `https://0.0.0.0:8765` (HTTPS with self-signed cert).

### 3. Access from mobile

Ensure phone and PC are on the **same Wi-Fi**, then open:
```
https://<your-pc-ip>:8765
```
Accept the self-signed certificate warning (tap "Advanced → Proceed").

Find your PC IP with: `ipconfig` (Windows) or `ifconfig` (macOS/Linux).

---

## 🎮 Usage

| Control | Action |
|---------|--------|
| **Auto** toggle | Continuous listening — speaks freely, pauses 1s → auto-sends |
| **Mute** toggle | Mute/unmute microphone |
| **Text input** | Type and press Enter to send a query |
| **New query** | Sending while TTS is playing immediately interrupts and starts fresh |

### Example interactions

> "这是什么植物？" *(对准一盆绿植)*
> "帮我看看这个路牌上写的什么" *(对准路牌)*
> "我的衣服是什么颜色的？"
> "描述一下你现在看到的房间"

---

## 🧠 Conversation Context

SilverMoon maintains an **8-turn sliding window** of conversation history
per WebSocket connection:

- Each turn stores `user` + `assistant` messages (with optional camera image)
- The last 16 messages (8 turns) are sent to Ollama with every query
- System prompt sets personality: "银月", calls user "主人", speaks Chinese, cute tone
- History is **in-memory only** — refresh the page and context resets
- `MAX_HISTORY_TURNS` configurable in `config.py`

### System prompt

```
你叫银月是一个实时视觉助手，自称时用银月代替"我"。
你能看到用户手机摄像头当前的画面。
请用中文回复，简洁自然地与用户交流，主动称呼用户为主人。
对话专注于和主人交流，画面只是辅助了解对话内容，保持语气呆傻可爱
不要生成()，不要询问主人太多问题
```

---

## 🎙️ Streaming TTS Design

Responses are **streamed token-by-token** from Ollama and spoken sentence-by-sentence:

```
Ollama stream → WebSocket stream_token → _sbuf (display)
                                      → _ttsBuf (TTS queue)
                                         │
                                         ▼ sentence boundary (。！？.!?)
                                      _tqueue → POST /tts → edge-tts → <audio>.play()
                                                     │
                                                     ▼ pre-buffering
                                      _preTTS() fetches NEXT sentence in background
                                      while current one plays → seamless transitions
```

| Feature | Implementation |
|---------|---------------|
| **Streaming** | Ollama `stream: true` → tokens via WebSocket |
| **Sentence detection** | `.` `!` `?` `。` `！` `？` `；` `;` triggers TTS |
| **Pre-buffering** | Next sentence's `/tts` fetch starts while current plays |
| **Abort on new query** | `_ttsGen` counter — old `playTTS()` loop exits on mismatch |
| **Voice** | `zh-CN-XiaoyiNeural` via edge-tts, rate `+20%` |

---

## 🔇 ASR (Speech-to-Text)

Auto mode uses **faster-whisper** (base model) for Chinese speech recognition:

1. Mic captures PCM 16kHz mono via `AudioContext`
2. Chunks buffered → VAD (amplitude threshold) detects speech vs. silence
3. 1 second of silence triggers send → `/asr` endpoint → Whisper transcribes
4. Result returned as text → auto-submitted as query with camera frame

First run downloads the Whisper base model (~140MB) from HuggingFace mirror.

---

## ⚙️ Configuration

All tunables in [`backend/config.py`](backend/config.py). Environment variables override defaults.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `SILVERMOON_HOST` | `0.0.0.0` | Server bind address |
| `SILVERMOON_PORT` | `8765` | Server port |
| `SILVERMOON_LOG_LEVEL` | `INFO` | Logging level |

### Ollama

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API address |
| `OLLAMA_MODEL` | `minicpm-v4.5:8b` | Model name |

### Cost control

| Constant | Default | Purpose |
|----------|---------|---------|
| `MAX_FRAME_SIZE_PX` | 640 | Max frame dimension |
| `JPEG_QUALITY` | 70 | JPEG compression (0-100) |
| `MIN_REQUEST_INTERVAL_S` | 1.5 | Min seconds between VLM calls |
| `MAX_REQUESTS_PER_SESSION` | 200 | Hard cap per WebSocket session |
| `SESSION_IDLE_TIMEOUT_S` | 300 | Auto-disconnect after 5 min idle |
| `MAX_HISTORY_TURNS` | 8 | Conversation turns in context window |

---

## 💰 Cost Control Strategy

| Strategy | Where | Impact |
|----------|-------|--------|
| **Local inference** | Ollama (on-prem) | Zero cloud API costs |
| **Streaming** | Ollama `stream: true` | Tokens rendered progressively, no full-response wait |
| **Frame throttling** | Browser + Server | ≤1 frame per 1.5 s per session |
| **JPEG compression** | Server (Pillow) | Frames resized to 640px, JPEG Q70 |
| **Rate limiting** | Server | Min 1.5 s between VLM calls |
| **Session cap** | Server | Max 200 VLM calls per connection |
| **Idle timeout** | Server | Auto-disconnect after 5 min idle |
| **Whisper base model** | Server (CPU int8) | Smallest viable model, CPU-only inference |

---

## 📁 Project Structure

```
SilverMoon/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket, /asr, /tts endpoints
│   ├── ollama_client.py     # Async Ollama client (chat + chat_stream)
│   ├── config.py            # All tunable constants
│   ├── cost_control.py      # Rate limiting, frame resize/compress
│   └── requirements.txt
├── frontend/
│   └── index.html           # SPA — all HTML/CSS/JS inline
├── cert.pem                 # Self-signed TLS certificate (auto-generated)
├── key.pem                  # TLS private key (auto-generated)
├── .gitignore
└── README.md
```

---

## 🔧 Contributing

### Commit conventions

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `perf:` | Performance improvement |
| `refactor:` | Code restructuring |
| `docs:` | Documentation |
| `chore:` | Build, deps, tooling |

### PR workflow

1. Create feature branch from `master`: `git checkout -b feature/name`
2. Make changes, test locally (`cd backend && python main.py`)
3. Commit with conventional message: `feat: add X` / `fix: resolve Y`
4. Push and open PR against `master`
5. Include screenshots for UI changes, describe testing performed

---

## 📄 License

MIT — see [LICENSE](LICENSE) file.