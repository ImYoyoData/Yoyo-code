# 本地语音听写规范

本文件规定桌面端会话输入框的本地语音听写行为。修改前先更新本文件。

## 目标

在 composer 底部「思考」右侧、「发送」左侧提供语音输入按钮：

- 点击开始录音，识别文本**边说边写入输入框**；
- 再次点击停止，等待 final 文本后结束；
- 音频与识别全部在本机完成，不上传云端。

Web / 手机端不显示该按钮（没有本地 Node 运行时）。

## 运行时与模型

| 项 | 规则 |
| --- | --- |
| 运行时 | RapidSpeech.cpp v1.4.3 官方预编译：Windows x64 CPU、macOS arm64 Metal、Linux x64/arm64 CPU |
| 运行时下载 | 首次使用下载到 `{dataRoot}/speech/runtime/<version>-<platform>-<arch>/`，校验 SHA256 后解压；Windows 用 System32 `tar.exe` 解 zip |
| 模型 | X-ASR zh-en `xasr-q4_k_m.gguf`（104,300,800 字节，约 99.5MB），中英混合、带标点、真流式 |
| 模型下载 | ModelScope `RapidAI/RapidSpeech`，SHA256 `f18450bc…`，缓存到 `{dataRoot}/speech/models/` |
| 下载回退 | Node fetch 失败时用系统 `curl` 重试（复用用户代理设置） |
| 进程 | 主进程 spawn `rs-server`，127.0.0.1 随机端口，`--cpu` 仅 Windows/Linux；退出时回收 |

## 流式协议

- WebSocket：`ws://127.0.0.1:<wsPort>/asr/stream?chunk_len=96`。
- 客户端发送 16kHz mono s16le PCM（每 100ms 一块），结束发送 `{"type":"eos"}`。
- 服务端返回 `ready` / `partial` / `final`；partial 是当前稳定假设，final 在 eos 后给出。
- 渲染进程直接连接 localhost；音频不进入 IPC 或远端。

## UI 行为

| 状态 | 行为 |
| --- | --- |
| idle | 麦克风按钮；点击准备运行时/模型并开始录音 |
| preparing | 按钮 spinner；输入框上方显示下载/启动进度，不允许重复点击 |
| recording | 按钮变停止；输入框只读；partial 实时替换「原始草稿 + 识别文本」 |
| finalizing | 等待 final（最多 8 秒）；结束后恢复可编辑并聚焦 |
| 失败 | 恢复原始草稿，输入框上方显示错误；下次点击重试 |
| 平台不支持 | 不渲染按钮 |

- 识别文本追加在录音开始时的草稿之后；中英混排时按 CJK 边界决定是否补空格。
- 录音期间禁止发送按钮与编辑器输入，避免 partial 覆盖用户编辑。

## 验收场景

1. 运行中点击麦克风：看到 partial 逐步写入输入框；停止后 final 完整保留。
2. 首次使用：下载进度可见；完成后同一会话再次点击不再下载。
3. 拒绝麦克风权限：显示错误并恢复草稿，不残留录音状态。
4. 非桌面平台：composer 不出现语音按钮。
5. 运行时/模型下载失败：显示真实失败原因，不影响文本输入。
