# 银月（SilverMoon）设计文档

> AI 视觉对话助手 — 题目一设计文档

---

## 一、项目概述

银月是一款基于 Web 的实时视觉语言对话助手。用户通过手机浏览器打开网页，摄像头画面和语音输入被实时采集，发送至本地运行的 Ollama minicpm-v4.5:8b 多模态模型进行处理，模型以流式方式生成中文回复，并通过语音合成播报给用户。

**核心架构**：手机浏览器（HTTPS）→ WebSocket 流式通信 → FastAPI 服务端 → Ollama 本地推理。

---

## 二、用户故事

### 2.1 计划实现的用户故事

| 编号 | 用户故事 | 优先级 | 状态 |
|------|---------|--------|------|
| US-01 | 作为用户，我希望能用手机摄像头对准物体，AI 能看见并描述它 | P0 | ✅ 已实现 |
| US-02 | 作为用户，我希望能直接用语音与 AI 对话，无需打字 | P0 | ✅ 已实现 |
| US-03 | 作为用户，我希望 AI 能用自然的中文语音回复我 | P0 | ✅ 已实现 |
| US-04 | 作为用户，我希望 AI 的回复能边说边显示，而不是等半天才出来 | P1 | ✅ 已实现 |
| US-05 | 作为用户，我希望 AI 能记住刚才说过的话，支持多轮对话 | P1 | ✅ 已实现 |
| US-06 | 作为用户，我希望在 AI 说话时发起新问题，旧语音立即停止 | P2 | ✅ 已实现 |
| US-07 | 作为用户，我希望语音播报句子之间不要有太长的停顿 | P2 | ✅ 已实现 |
| US-08 | 作为用户，我希望系统能在我的电脑上本地运行，保护隐私 | P0 | ✅ 已实现 |
| US-09 | 作为用户，我希望语音识别的准确率足够高 | P1 | ✅ 已实现 |
| US-10 | 作为用户，我希望能通过文字输入与 AI 交互（作为语音的备选） | P1 | ✅ 已实现 |
| US-11 | 作为用户，我希望对话历史能持久化保存，下次打开还能继续 | P3 | ❌ 未实现 |
| US-12 | 作为用户，我希望支持多语言语音识别（中英文混合） | P3 | ❌ 未实现 |
| US-13 | 作为用户，我希望有手势交互（挥手触发查询） | P4 | ❌ 未实现 |
| US-14 | 作为用户，我希望一键 Docker 部署 | P4 | ❌ 未实现 |

### 2.2 已实现功能的详细说明

**US-01 视觉识别**：前端通过 `getUserMedia` 打开后置摄像头，按需截取 JPEG 帧（640px，质量 70%），以 base64 编码通过 WebSocket 随查询发送。Ollama minicpm-v4.5:8b 模型原生支持图片输入，无需额外预处理。

**US-02 语音输入**：采用两种模式——（1）Auto 模式：连续聆听，基于振幅 VAD 检测说话/静音，静音 1 秒后自动将 PCM 音频发送至服务端 faster-whisper 转写；（2）文字备选：输入框直接打字发送。

**US-03 语音回复**：服务端 edge-tts 调用微软晓晓语音（`zh-CN-XiaoyiNeural`，语速 +20%），生成 MP3 返回前端通过 `<audio>` 播放。

**US-04 流式输出**：Ollama 启用 `stream: true`，token 通过 WebSocket 逐条推送（`stream_token`），前端实时渲染到聊天界面。遇到句末标点（`。！？.!?；;`）时触发 TTS 分句播报。

**US-05 多轮对话**：服务端 WebSocket handler 内维护 `history` 列表，每轮存储 user + assistant 消息（含图片 base64），采用 8 轮滑动窗口（`MAX_HISTORY_TURNS=8`），超出部分自动截断。

**US-06 打断机制**：基于代际计数器 `_ttsGen` 的取消机制。每次新查询递增计数器，`playTTS()` 循环在多个检查点比对 gen 值，不匹配立即退出。同时 `_curA.pause()` 直接暂停当前播放的音频。

**US-07 预缓冲**：`_preTTS()` 在当前句播放时后台并步预取下一句的 TTS 音频，播放完当前句后立即无缝衔接，消除句间 fetch 延迟。

**US-08 本地运行**：所有推理在 Ollama 本地完成，语音识别使用 faster-whisper base 模型 CPU 推理，零云端 API 调用。

**US-09 语音识别**：采用 faster-whisper base 模型，中文优化（`language="zh"`, `beam_size=5`），通过 HuggingFace 镜像下载。前端 VAD 过滤静音段，仅上传有效语音，减少无效转写。

**US-10 文字输入**：聊天界面底部提供文本输入框，支持回车发送。Auto 模式和文字输入可同时使用。

---

## 三、成本控制策略

### 3.1 考虑过的策略

| 编号 | 策略 | 是否采用 | 说明 |
|------|------|---------|------|
| CS-01 | 客户端语音识别（Web Speech API） | ❌ 放弃 | 准确率过低，中文支持差，改用服务端 Whisper |
| CS-02 | 客户端语音合成（SpeechSynthesis API） | ❌ 放弃 | 音色不自然、不可控，改用服务端 edge-tts 晓晓 |
| CS-03 | 云端 API 调用（GPT-4V / Claude） | ❌ 放弃 | 成本不可控，隐私风险，改为本地 Ollama |
| CS-04 | 视频流连续传输（每帧都发） | ❌ 放弃 | 带宽和 token 浪费严重 |
| CS-05 | 大模型 Whisper（large-v3） | ❌ 放弃 | 显存/内存占用大，base 模型在中文场景已足够 |
| CS-06 | GPU 推理 Whisper | ❌ 放弃 | 开发机无 GPU，CPU int8 量化已满足实时性 |
| CS-07 | 对话历史全量保留 | ❌ 放弃 | token 消耗线性增长，改为滑动窗口 |
| CS-08 | 云端 GPU 推理 | ❌ 放弃 | 增加运维成本和网络依赖 |

### 3.2 实际采用的策略

| 编号 | 策略 | 实现位置 | 效果 |
|------|------|---------|------|
| CS-A | **本地推理全链路** | Ollama + Whisper | 零云端 API 费用，仅消耗本地电费和算力 |
| CS-B | **截图按需触发 + 限频** | `cost_control.py:SessionBudget` | 每会话 ≤1 帧/1.5 秒，避免连续视频流浪费 token |
| CS-C | **JPEG 压缩** | `cost_control.py:compress_frame()` | 截图缩放到 640px，JPEG 质量 70%，单帧约 30-80KB |
| CS-D | **VAD 语音活动检测** | `frontend/index.html:hasSpeech()` | 仅上传有效语音段，静音期不消耗 Whisper 算力 |
| CS-E | **Whisper base + int8 量化** | `main.py:asr_endpoint` | 最小可用模型（~140MB），CPU 推理延迟 <1s |
| CS-F | **流式输出** | `ollama_client.py:chat_stream()` | token 逐条推送，用户感知延迟大幅降低，无需等待完整回复 |
| CS-G | **滑动窗口上下文** | `config.py:MAX_HISTORY_TURNS=8` | 最多保留 16 条消息，每次请求 token 消耗可控 |
| CS-H | **会话上限 + 闲置超时** | `cost_control.py:SessionBudget` | 每连接最多 200 次 VLM 调用，闲置 5 分钟自动断开 |
| CS-I | **TTS 预缓冲** | `frontend/index.html:_preTTS()` | 并行获取下一句音频，避免串行等待浪费用户时间 |
| CS-J | **HTTPS 自签名证书** | `main.py` 自动加载 `cert.pem` | 零费用满足浏览器摄像头 HTTPS 要求，无需购买证书或 ngrok |

### 3.3 成本分析

以单次典型交互（用户说一句话 → AI 回复 3 句）为例：

| 环节 | 消耗 | 说明 |
|------|------|------|
| Whisper ASR | ~0.3s CPU | base 模型 int8 量化，单次转写 |
| Ollama VLM | ~2-5s GPU/CPU | minicpm-v4.5:8b，取决于硬件 |
| edge-tts TTS | 3 次 HTTP 请求 | 调用微软免费 TTS 接口 |
| 网络带宽 | ~200KB | 截图 + 音频 + WebSocket 信令 |
| **总云端费用** | **¥0** | 全部本地 + 免费服务 |

---

## 四、技术架构

### 4.1 系统架构图

```
手机浏览器 (HTTPS)
 ├─ Camera  → JPEG capture (on-demand, ≥1.5s throttle)
 ├─ Mic     → PCM 16kHz → VAD → POST /asr (faster-whisper)
 └─ Speaker ← MP3 ← POST /tts (edge-tts XiaoyiNeural)
      │
      │  WebSocket (wss://)
      │  {type:"query", text, image?}
      │  {type:"stream_token", content}  ← streaming tokens
      │  {type:"stream_end"}
      ▼
FastAPI Server (Python 3.11+)
 ├─ /ws         WebSocket handler + session history
 ├─ /asr        faster-whisper base (CPU int8)
 ├─ /tts        edge-tts Communicate API
 ├─ /health     Health check
 └─ /           Serve index.html SPA
      │
      ▼
Ollama (local)
 └─ minicpm-v4.5:8b  (stream: true, multimodal)
```

### 4.2 关键技术决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 前端架构 | 单文件 SPA（index.html 内联） | 零构建工具、零依赖、手机直接加载 |
| 通信协议 | WebSocket（wss://） | 双向流式、低延迟、单连接复用 |
| 语音识别 | faster-whisper base | 中文准确率高、CPU 可运行、离线 |
| 语音合成 | edge-tts 晓晓 | 音色自然、免费、中文优化 |
| 视觉模型 | Ollama minicpm-v4.5:8b | 本地运行、多模态、8B 参数可消费级硬件运行 |
| 流式输出 | Ollama `stream: true` | 逐 token 推送，感知延迟大幅降低 |
| 上下文管理 | 服务端滑动窗口 8 轮 | 平衡记忆能力与 token 消耗 |
| HTTPS | 自签名证书 | 零费用满足浏览器摄像头 API 要求 |

### 4.3 流式 TTS 设计（核心创新点）

```
Ollama stream → WebSocket stream_token → _sbuf (显示缓冲，完整消息)
                                       → _ttsBuf (TTS 缓冲，当前句子)
                                          │
                                          ▼ 句末标点检测
                                       _tqueue → POST /tts → edge-tts → <audio>.play()
                                                     │
                                                     ▼ 预缓冲
                                       _preTTS() 后台并行获取下一句
                                       当前句播放时下一句已就绪
```

**分句检测**：检查累积文本最后字符是否为 `.` `!` `?` `。` `！` `？` `；` `;`。

**代际打断**：每次新查询递增 `_ttsGen` 计数器，`playTTS()` 循环在 5 个检查点比对 gen 值：
1. while 循环条件
2. fetch 前
3. pre-fetch 前
4. play 前
5. 函数退出时（gen 守卫 `_tplaying` 和 `_curA` 重置）

---

## 五、项目结构

```
SilverMoon/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket, /asr, /tts endpoints
│   ├── ollama_client.py     # Async Ollama client (chat + chat_stream)
│   ├── config.py            # All tunable constants
│   ├── cost_control.py      # Rate limiting, frame resize/compress
│   └── requirements.txt     # fastapi, uvicorn, faster-whisper, edge-tts, etc.
├── frontend/
│   └── index.html           # SPA — all HTML/CSS/JS inline
├── cert.pem / key.pem       # Self-signed TLS certs
└── DESIGN.md                # 本文档
```

---

## 六、迭代历程

| 阶段 | 关键 commit | 内容 |
|------|------------|------|
| 基础搭建 | `28a9a18` | 引入 faster-whisper 替换 Windows ASR |
| 语音合成 | `dd23845`→`1c3fc7c`→`933d725` | 从 Windows TTS 演进到 edge-tts 晓晓 +20% 语速 |
| Auto 模式 | `6e37ac5`→`de6fbbe` | VAD 分句 + 自动附带摄像头截图 |
| UI 简化 | `eb214e1` | 精简为 Auto + Mute + 文本输入 |
| 流式输出 | `c798c58` | Ollama stream:true + stream_token/stream_end |
| TTS 预缓冲 | `4e532dc` | _preTTS() 后台预取，消除句间停顿 |
| 打断机制 | `e189060` | _ttsGen 代际计数器 + gen 守卫修复 |
| 文档 | `4337cb4`→`9d0a1ce` | README 重写 + 全文中文翻译 |

---

## 七、已知限制与未来方向

| 限制 | 影响 | 可能的改进方向 |
|------|------|--------------|
| 对话历史仅内存存储 | 刷新即丢失 | SQLite 持久化 |
| Whisper base 模型中文为主 | 英文/混合识别准确率下降 | 升级 small/medium 模型或语言自动检测 |
| 仅单人使用 | 多人场景无法区分说话人 | 声纹识别 |
| 无流式 TTS（需等待整句生成） | 长句时首字延迟较高 | edge-tts 流式 API 或浏览器内置 TTS 兜底 |
| 自签名证书需手动信任 | 首次访问体验不佳 | ngrok/LocalCDN 或信任的本地 CA |
| VAD 基于简单振幅阈值 | 噪音环境下误触发 | Silero VAD 或 WebRTC VAD |

---

## 八、总结

银月实现了题目一规定的全部核心需求：摄像头视觉输入、麦克风语音输入、AI 多模态理解与自然语言回复。在**语音交互自然度**方面，通过流式 token 推送、句末分句 TTS、预缓冲并行获取和代际打断机制，实现了流畅的"边说边播"体验。在**成本控制**方面，全链路本地推理（Ollama + Whisper）、截图按需限频压缩、VAD 过滤静音、8 轮滑动窗口上下文和会话上限管理等策略，将云端 API 费用降至零，同时控制了本地算力消耗。

当前版本已完成所有 P0/P1/P2 用户故事，P3/P4 优先级的功能（历史持久化、多语言、手势交互、Docker 部署）列入未来迭代计划。