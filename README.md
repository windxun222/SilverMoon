 # 🌙 SilverMoon — AI Visual Conversation Assistant
 
 > Point your phone camera at anything. Speak naturally. Let AI see what you see
 > and respond intelligently — all processed locally via Ollama.
 
 SilverMoon is a real-time vision-language assistant that runs a web app on your
 phone, captures camera frames and speech, and sends them to a **locally
 deployed [Ollama](https://ollama.com) minicpm-v4.5:8b model** for multimodal
 understanding and natural conversation.
 
 ---
 
 ## 🏗 Architecture
 
 ```
 ┌─────────────────────────────────────────────────────────┐
 │  Mobile Browser (HTTPS via ngrok / LAN)                 │
 │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │
 │  │ Camera   │  │ Mic +    │  │ Chat UI + TTS      │    │
 │  │ (JPEG)   │  │ Web      │  │ (display response) │    │
 │  │          │  │ Speech   │  │                    │    │
 │  │          │  │ API STT  │  │                    │    │
 │  └────┬─────┘  └────┬─────┘  └────────▲───────────┘    │
 │       │             │                 │                 │
 └───────┼─────────────┼─────────────────┼─────────────────┘
         │             │                 │
         │   ┌─────────▼─────────┐       │
         │   │  WebSocket        │       │
         │   │  {type:"query",   │       │
         │   │   text, image?}   │       │
         │   └─────────┬─────────┘       │
         │             │                 │
 ┌───────▼─────────────▼─────────────────▼─────────────────┐
 │  FastAPI Server (Python)                                │
 │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
 │  │ Cost Control │  │ Frame        │  │ Ollama       │  │
 │  │ (rate limit, │──│ Compression  │──│ Client       │  │
 │  │  session cap)│  │ (resize+JPEG)│  │ (async HTTP) │  │
 │  └──────────────┘  └──────────────┘  └──────┬───────┘  │
 └──────────────────────────────────────────────┼──────────┘
                                                │
                                        ┌───────▼───────┐
                                        │  Ollama        │
                                        │  minicpm-v4.5  │
                                        │  :8b (local)   │
                                        └───────────────┘
 ```
 
 ### Data flow
 1. **Phone camera** → JPEG frame captured on-demand (every ≥1.5 s)
 2. **Phone mic** → Web Speech API transcribes speech to text (client-side, zero server cost)
 3. **WebSocket** → `{type: "query", text: "...", image: "<base64>"}` sent to FastAPI
 4. **FastAPI** → rate-limit check → JPEG compress/resize → Ollama `/api/chat`
 5. **minicpm-v4.5:8b** → multimodal response returned
 6. **Browser** → response displayed in chat + spoken via TTS
 
 ---
 
 ## 🛠 Tech Stack
 
 | Layer | Technology | Role |
 |-------|-----------|------|
 | **Frontend** | Vanilla JS (ES modules) + HTML5 + CSS3 | Camera, mic, STT, chat UI |
 | **STT** | Web Speech API | Client-side speech-to-text |
 | **TTS** | SpeechSynthesis API | Client-side text-to-speech |
 | **Transport** | WebSocket | Real-time bidirectional messaging |
 | **Backend** | Python 3.11+ / FastAPI + uvicorn | Server, routing, WebSocket handler |
 | **VLM** | Ollama + minicpm-v4.5:8b | Vision-language understanding |
 | **Image** | Pillow (PIL) | Frame resize & JPEG compression |
 
 ---
 
 ## 📦 Setup
 
 ### Prerequisites
 
 - **Python 3.11+** with `pip`
 - **Ollama** installed and running locally
 - **minicpm-v4.5:8b** model pulled: `ollama pull minicpm-v4.5:8b`
 - (Optional) **ngrok** for HTTPS access from mobile
 
 ### 1. Clone & enter
 
 ```bash
 git clone <repo-url> && cd SilverMoon
 ```
 
 ### 2. Install Python dependencies
 
 ```bash
 python -m venv .venv
 .venv\Scripts\activate   # Windows
 # source .venv/bin/activate  # macOS/Linux
 pip install -r backend/requirements.txt
 ```
 
 ### 3. Start Ollama (if not already running)
 
 ```bash
 ollama serve
 ```
 
 ### 4. Start SilverMoon backend
 
 ```bash
 cd backend
 python main.py
 ```
 
 The server starts at `http://0.0.0.0:8765`.
 
 ### 5. Access from mobile
 
 **Option A — LAN (same Wi-Fi):**
 Open `http://<your-pc-ip>:8765` on your phone browser.
 
 **Option B — ngrok (HTTPS, required for camera on some browsers):**
 ```bash
 ngrok http 8765
 ```
 Open the ngrok HTTPS URL on your phone.
 
 ---
 
 ## 🎮 Usage
 
 ### Interaction modes
 
 | Mode | How | Best for |
 |------|-----|----------|
 | **Push-to-talk** | Hold 🎤 button, speak, release | Quick queries, noisy environments |
 | **Auto** | Tap 🔄 to toggle continuous listening | Hands-free conversation |
 
 ### Buttons
 
 - **🎤 Hold to Talk** — press & hold to speak, release to send
 - **🔄 Auto** — toggle continuous listening mode
 - **🔇 Mute** — mute/unmute the microphone
 
 ### Example interactions
 
 > "What plant is this?" *(point camera at a plant)*
 > "Read the text on this sign." *(point camera at a sign)*
 > "What color is my shirt?"
 > "Describe what you see in the room."
 
 ---
 
 ## ⚙️ Configuration
 
 All tunables live in [`backend/config.py`](backend/config.py). Set environment
 variables to override defaults:
 
| Variable | Default | Description |
 |----------|---------|-------------|
 | `SILVERMOON_HOST` | `0.0.0.0` | Server bind address |
 | `SILVERMOON_PORT` | `8765` | Server port |
 | `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
 | `OLLAMA_MODEL` | `minicpm-v4.5:8b` | Model name |
 | `SILVERMOON_LOG_LEVEL` | `INFO` | Logging verbosity |
 
 Cost-control constants (edit in `config.py`):
 
 | Constant | Default | Purpose |
 |----------|---------|---------|
 | `MAX_FRAME_SIZE_PX` | 640 | Max frame dimension after resize |
 | `JPEG_QUALITY` | 70 | JPEG compression quality (0-100) |
 | `MIN_REQUEST_INTERVAL_S` | 1.5 | Min seconds between VLM calls |
 | `MAX_REQUESTS_PER_SESSION` | 200 | Hard cap per WebSocket session |
 | `SESSION_IDLE_TIMEOUT_S` | 300 | Close idle connections after 5 min |
 
 ---
 
 ## 💰 Cost Control Strategy
 
 SilverMoon is designed to **minimize computational cost** while maintaining
 a natural conversational experience:
 
 | Strategy | Where | Impact |
 |----------|-------|--------|
 | **Client-side STT** | Browser (Web Speech API) | Zero server GPU/CPU cost for audio |
 | **Client-side TTS** | Browser (SpeechSynthesis) | Zero server cost for speech output |
 | **Frame throttling** | Browser + Server | ≤1 frame per 1.5 s per session |
 | **JPEG compression** | Server (Pillow) | Frames resized to 640px, JPEG Q70 |
 | **Rate limiting** | Server | Min 1.5 s between VLM calls |
 | **Session cap** | Server | Max 200 VLM calls per connection |
 | **Idle timeout** | Server | Auto-disconnect after 5 min idle |
 | **Local inference** | Ollama (on-prem) | No cloud API costs |
 
 ---
 
 ## 🔧 Development & Contributing
 
 ### Project structure
 
 ```
 SilverMoon/
 ├── backend/
 │   ├── __init__.py
 │   ├── main.py              # FastAPI + WebSocket server
 │   ├── ollama_client.py     # Async Ollama chat client
 │   ├── config.py            # All tunables
 │   ├── cost_control.py      # Rate limiting, frame compression
 │   └── requirements.txt
 ├── frontend/
 │   ├── index.html           # Single-page app
 │   ├── css/
 │   │   └── style.css        # Mobile-first dark theme
 │   └── js/
 │       ├── app.js           # Main orchestrator
 │       ├── camera.js        # Camera + frame capture
 │       ├── audio.js         # Mic + Web Speech STT
 │       └── websocket.js     # WebSocket client + reconnect
 ├── .gitignore
 └── README.md
 ```
 
 ### GitHub PR workflow
 
 1. **Fork** the repository
 2. **Create a feature branch** from `main`:
    ```bash
    git checkout -b feature/your-feature-name
    ```
 3. **Make changes** following the existing code style:
    - Python: follow PEP 8, type hints encouraged
    - JavaScript: ES modules, `async/await`, JSDoc for public APIs
    - CSS: kebab-case class names, mobile-first
 4. **Test locally**:
    ```bash
    cd backend && python main.py
    ```
    Open `http://localhost:8765` and verify camera/mic/chat work.
 5. **Commit** with conventional commit messages:
    ```
    feat: add auto-language detection for STT
    fix: handle Ollama timeout gracefully
    docs: update cost-control thresholds
    ```
 6. **Push** and open a **Pull Request** against `main`
 7. **PR description** should include:
    - What problem this solves
    - Screenshots / screen recordings if UI changes
    - Testing performed
    - Any config changes needed
 
 ### Commit conventions
 
 | Prefix | Use for |
 |--------|---------|
 | `feat:` | New feature |
 | `fix:` | Bug fix |
 | `docs:` | Documentation only |
 | `style:` | Formatting, missing semicolons, etc. |
 | `refactor:` | Code change that neither fixes a bug nor adds a feature |
 | `perf:` | Performance improvement |
 | `test:` | Adding or updating tests |
 | `chore:` | Build process, tooling, dependencies |
 
 ---
 
 ## 📝 Roadmap
 
 - [ ] Multi-language STT auto-detection
 - [ ] Conversation history persistence (SQLite)
 - [ ] Streaming responses (Ollama `stream: true`)
 - [ ] Gesture-based interaction (wave to trigger query)
 - [ ] Screen reader mode for accessibility
 - [ ] Docker Compose one-command deployment
 
 ---
 
 ## 📄 License
 
 MIT — see [LICENSE](LICENSE) file.
### Monitoring

- **`GET /health`** — returns `{"status":"ok","version":"0.1.0","model":"minicpm-v4.5:8b"}`
