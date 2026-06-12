# 🌙 银月 — AI 视觉对话助手

> 对准摄像头，自然说话。让你本地的 AI 看见你所见的，听见你所说的。

银月是一个实时视觉语言助手。用手机打开网页，自然说话或打字，本地运行的
[Ollama](https://ollama.com) **minicpm-v4.5:8b** 模型就能看到你的摄像头画面，
听到你的声音，并用自然的中文语音回复你。

---

## 🏗 系统架构

```
手机浏览器 (HTTPS)
 ├─ 摄像头 → JPEG 截图（按需触发）
 ├─ 麦克风 → PCM → WAV → POST /asr（Whisper 语音识别）
 └─ 扬声器 ← MP3 ← POST /tts（edge-tts 语音合成）
      │
      │  WebSocket (wss://)
      │  {type:"query", text, image?}
      │  {type:"stream_token", content}  ← 流式推送
      │  {type:"stream_end"}
      ▼
FastAPI 服务端 (Python 3.11+)
 ├─ /ws         WebSocket 处理 + 对话历史
 ├─ /asr        faster-whisper base（语音转文字）
 ├─ /tts        edge-tts 晓晓（文字转语音）
 ├─ /health     健康检查
 └─ /           提供 index.html 单页应用
      │
      ▼
Ollama（本地运行）
 └─ minicpm-v4.5:8b（stream: true）
```

### 数据流

1. **手机摄像头** → JPEG 截图（最低间隔 1.5 秒）
2. **手机麦克风**（Auto 模式）→ PCM → 发送到 `/asr` → Whisper 转写为中文文本
3. **WebSocket** → `{type: "query", text: "...", image: "<base64>"}` 发送到服务端
4. **服务端** → 频率检查 → JPEG 压缩 → Ollama `/api/chat`（stream: true）
5. **流式输出** → token 逐条以 `stream_token` 消息推回前端，界面逐字渲染
6. **语音合成** → 遇到句末标点触发 `/tts` 请求 → edge-tts 晓晓语音 → `<audio>` 播放

---

## 🛠 技术栈

| 层级 | 技术 | 用途 |
|-------|-----------|------|
| **前端** | 原生 JS + HTML5 + CSS3（单文件 `index.html`） | 摄像头、麦克风、聊天界面、语音播放 |
| **语音识别** | faster-whisper（base, CPU int8） | 语音转文字（服务端） |
| **语音合成** | edge-tts（zh-CN-XiaoyiNeural） | 文字转语音（服务端） |
| **传输** | WebSocket（wss://）| 实时流式通信 |
| **服务端** | Python 3.11+ / FastAPI + uvicorn | 路由、WebSocket、ASR/TTS 端点 |
| **视觉模型** | Ollama + minicpm-v4.5:8b | 视觉语言对话 |
| **图像处理** | Pillow（PIL）| 截图缩放与 JPEG 压缩 |

---

## 📦 部署

### 环境要求

- **Python 3.11+** 并安装 `pip`
- **Ollama** 已安装并在本地运行（`ollama serve`）
- **minicpm-v4.5:8b** 模型：`ollama pull minicpm-v4.5:8b`
- **HTTPS 证书** — 项目根目录需要自签名 `cert.pem` + `key.pem`：
  ```bash
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
  ```

### 1. 克隆并安装

```bash
git clone https://github.com/windxun222/SilverMoon.git
cd SilverMoon
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r backend/requirements.txt
```

### 2. 启动

```bash
cd backend
python main.py
```

服务启动在 `https://0.0.0.0:8765`（HTTPS，自签名证书）。

### 3. 手机访问

确保手机和电脑在**同一 Wi-Fi** 下，打开：
```
https://<你的电脑IP>:8765
```
需要接受自签名证书警告（点击"高级 → 继续"）。

查看电脑 IP：`ipconfig`（Windows）或 `ifconfig`（macOS/Linux）。

---

## 🎮 使用方式

| 操作 | 说明 |
|---------|--------|
| **Auto** 开关 | 连续聆听模式 — 自由说话，停顿 1 秒自动发送 |
| **Mute** 开关 | 静音/取消静音麦克风 |
| **文字输入** | 打字后按回车发送 |
| **新对话打断** | 语音播放中发送新消息会立即中断并开始新的回复 |

### 交互示例

> "这是什么植物？" *(对准一盆绿植)*
> "帮我看看这个路牌上写的什么" *(对准路牌)*
> "我的衣服是什么颜色的？"
> "描述一下你现在看到的房间"

---

## 🧠 对话上下文

银月为每个 WebSocket 连接维护一个 **8 轮滑动窗口** 的对话历史：

- 每轮存储 `user` + `assistant` 消息（可附带摄像头图片）
- 每次查询将最近 16 条消息（8 轮）发送给 Ollama
- 系统提示词设定人设："银月"，称呼用户"主人"，中文回复，呆傻可爱
- 历史记录**仅存内存** — 刷新页面即清空
- `MAX_HISTORY_TURNS` 可在 `config.py` 中调整

### 系统提示词

```
你叫银月是一个实时视觉助手，自称时用银月代替"我"。
你能看到用户手机摄像头当前的画面。
请用中文回复，简洁自然地与用户交流，主动称呼用户为主人。
对话专注于和主人交流，画面只是辅助了解对话内容，保持语气呆傻可爱
不要生成()，不要询问主人太多问题
```

---

## 🎙️ 流式语音合成设计

回复以**逐 token 流式**从 Ollama 输出，逐句语音播报：

```
Ollama 流 → WebSocket stream_token → _sbuf（显示缓冲）
                                    → _ttsBuf（语音队列）
                                         │
                                         ▼ 句末标点（。！？.!?）
                                      _tqueue → POST /tts → edge-tts → <audio>.play()
                                                     │
                                                     ▼ 预缓冲
                                      _preTTS() 后台提前获取下一句音频
                                      当前句播放时下一句已就绪 → 无缝衔接
```

| 特性 | 实现方式 |
|---------|---------------|
| **流式输出** | Ollama `stream: true` → WebSocket 逐 token 推送 |
| **分句检测** | `.` `!` `?` `。` `！` `？` `；` `;` 触发语音合成 |
| **预缓冲** | 当前句播放时后台并步获取下一句音频 |
| **新消息打断** | `_ttsGen` 计数器 — 旧 `playTTS()` 循环检测到 gen 不匹配立即退出 |
| **语音** | `zh-CN-XiaoyiNeural` 晓晓，语速 `+20%` |

---

## 🔇 语音识别

Auto 模式使用 **faster-whisper**（base 模型）进行中文语音识别：

1. 麦克风通过 `AudioContext` 采集 PCM 16kHz 单声道
2. 音频块缓冲 → VAD（振幅阈值）检测说话/静音
3. 静音 1 秒触发发送 → `/asr` 端点 → Whisper 转写
4. 转写结果作为文本 → 自动附带摄像头截图提交查询

首次运行会从 HuggingFace 镜像下载 Whisper base 模型（约 140MB）。

---

## ⚙️ 配置

所有可调参数在 [`backend/config.py`](backend/config.py) 中。环境变量可覆盖默认值。

### 服务端

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `SILVERMOON_HOST` | `0.0.0.0` | 服务器绑定地址 |
| `SILVERMOON_PORT` | `8765` | 服务器端口 |
| `SILVERMOON_LOG_LEVEL` | `INFO` | 日志级别 |

### Ollama

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API 地址 |
| `OLLAMA_MODEL` | `minicpm-v4.5:8b` | 模型名称 |

### 成本控制

| 常量 | 默认值 | 用途 |
|----------|---------|---------|
| `MAX_FRAME_SIZE_PX` | 640 | 截图最大尺寸 |
| `JPEG_QUALITY` | 70 | JPEG 压缩质量 (0-100) |
| `MIN_REQUEST_INTERVAL_S` | 1.5 | VLM 调用最小间隔 |
| `MAX_REQUESTS_PER_SESSION` | 200 | 每个 WebSocket 连接上限 |
| `SESSION_IDLE_TIMEOUT_S` | 300 | 闲置 5 分钟自动断开 |
| `MAX_HISTORY_TURNS` | 8 | 上下文窗口轮数 |

---

## 💰 成本控制策略

| 策略 | 位置 | 效果 |
|----------|-------|--------|
| **本地推理** | Ollama（自建）| 零云端 API 费用 |
| **流式输出** | Ollama `stream: true` | token 逐条渲染，无需等待完整回复 |
| **截图限频** | 浏览器 + 服务端 | 每会话 ≤1 帧/1.5 秒 |
| **JPEG 压缩** | 服务端（Pillow）| 截图缩放到 640px，JPEG 质量 70 |
| **频率限制** | 服务端 | VLM 调用间隔 ≥1.5 秒 |
| **会话上限** | 服务端 | 每连接最多 200 次 VLM 调用 |
| **闲置超时** | 服务端 | 5 分钟无活动自动断开 |
| **Whisper base** | 服务端（CPU int8）| 最小可用模型，纯 CPU 推理 |

---

## 📁 项目结构

```
SilverMoon/
├── backend/
│   ├── main.py              # FastAPI 应用，WebSocket，/asr，/tts 端点
│   ├── ollama_client.py     # 异步 Ollama 客户端（chat + chat_stream）
│   ├── config.py            # 所有可调常量
│   ├── cost_control.py      # 频率限制、截图缩放/压缩
│   └── requirements.txt
├── frontend/
│   └── index.html           # 单页应用 — 所有 HTML/CSS/JS 内联
├── cert.pem                 # 自签名 TLS 证书（自动生成）
├── key.pem                  # TLS 私钥（自动生成）
├── .gitignore
└── README.md
```

---

## 🔧 参与贡献

### 提交规范

| 前缀 | 用途 |
|--------|---------|
| `feat:` | 新功能 |
| `fix:` | 缺陷修复 |
| `perf:` | 性能优化 |
| `refactor:` | 代码重构 |
| `docs:` | 文档更新 |
| `chore:` | 构建、依赖、工具 |

### PR 流程

1. 从 `master` 创建功能分支：`git checkout -b feature/名称`
2. 修改代码，本地测试（`cd backend && python main.py`）
3. 用规范消息提交：`feat: 添加某某功能` / `fix: 修复某某问题`
4. Push 并对 `master` 发起 PR
5. UI 变更请附截图，描述测试情况

---

## 📄 许可证

MIT — 详见 [LICENSE](LICENSE) 文件。