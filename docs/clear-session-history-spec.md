# 清空会话记录规范

本文件规定任务菜单「清空会话记录」的行为。修改前先更新本文件。

## 目标

长会话切换卡顿、上下文过大时，用户需要一种**只删聊天记录、保留任务**的操作：

- 聊天记录（用户输入、模型输出、工具调用、后台任务卡片）全部删除；
- 任务本身、标题、置顶/归档/未读、任务分组归属、会话 ID 与日志路径全部保留；
- 清空后会话仍可继续对话，且模型上下文从空历史重新开始。

与「删除任务」的区别：删除任务会移除侧栏行；清空记录只清聊天正文。

## 行为

| 场景 | 结果 |
| --- | --- |
| 会话 idle、无待应答交互、无排队输入 | 删除该会话全部 message/part，关闭并重建 runtime，投影下发空快照 |
| 会话运行中 / 有排队输入 / 有 pending interaction | 拒绝，ACK `failed` + `guard.clearHistorySessionBusy`；不做部分删除 |
| 会话是尚未冷恢复的历史任务 | 直接删除持久 message/part，并把 sessions-index 摘要降回空态 |
| 会话非任务列表类型（subagent / workflow child / 选择侧聊） | 允许协议调用，但摘要不进 sessions-index |
| 清空后继续发消息 | 正常启动新 turn，provider 只看到新输入与系统上下文 |
| 清空后重新打开任务 | 显示空会话（标题仍在） |

## 协议与所有权

- 新 v4 命令 `clearSessionHistory: {}`，session 级、非 CAS（与 `renameSession` / `deleteSession` 同类）。
- UI 只发命令，不在本地改投影；空快照由 CLI 的 conversation publisher 通过既有订阅下发。
- CLI 是唯一裁决者：`host.clearSessionHistory` 负责 busy 预检、删库、runtime 重建与投影重置。

执行顺序（不可交换）：

1. busy 预检：`activeAbortController` / `runtime.hasActiveOrQueuedTurnWork()` /
   `v4Interactions.hasPendingForSession()` / `CommandInbox` pinned 任一成立即拒绝。
2. `sessionStore.clearMessages` 在一个事务内删除 `message` 与残留孤儿 `part`。
3. 失效 persistent command facts 缓存（旧 transcript 已不存在）。
4. 关闭 runtime（`unsubscribe` → `app.close` → 从 `context.sessions` 摘除 → 清内存 event store），
   让 `messageHistory` 与 read-file 状态一并丢弃。
5. 用空历史重新冷恢复同一 session（保留模型选型等 `session_entry`），保证后续消息不报会话不存在。
6. `gateway.clearSessionProjection`：重建空 projection 并把 `seq` 抬到旧水位之上、
   `revision + 1`，让既有订阅 resync 到空快照；同时把 sessions-index 摘要降级为空态
   （保留 title / createdAt / parentSessionId）。

## 不做

- 不删除 `session_entry` 中的模型选型、执行状态、标题与 membership（它们不是聊天记录）。
- 不删除任务行、分组结构、unread/pin/archive 标记。
- 不清理工作区文件或 checkpoint 快照本身（文件回滚仍可用）。
- 不做批量操作：一次只清一个会话，避免长事务与多会话并发写。

## UI

- 入口：任务菜单（侧栏右键菜单与工作区标题栏「更多」菜单），位置在「标记为未读」之后。
- 文案：`taskList.clearSessionHistory*`（中英）。
- 确认框标题与描述明确「聊天记录会删除、任务与标题保留、不可撤销」，确认按钮使用 destructive。
- 失败 toast 区分「会话忙」（`guard.clearHistorySessionBusy`）与其他失败。
- test id：`task-clear-session-history`。

## 验收场景

1. idle 会话点击「清空会话记录」并确认：侧栏行仍在、标题不变，时间线变为空，预览摘要清空。
2. 清空后直接发送消息：正常得到回复，且模型不携带旧历史。
3. 会话运行中点击：提示「会话正在运行或等待确认」，聊天记录保持不变。
4. CLI 重启后打开已清空的会话：仍为空，不会复活旧消息。
5. 清空另一个 workspace 的任务：命令路由到该任务的 host，不误改当前 workspace。
