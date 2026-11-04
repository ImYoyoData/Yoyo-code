# 清空会话记录规范

本文件规定任务菜单「清空会话记录」的行为。修改前先更新本文件。

## 目标

长会话切换卡顿、界面太长时，用户需要一种**只清界面显示、保留模型上下文**的操作：

- 界面不再显示之前的聊天记录（用户输入、模型输出、工具调用、后台任务卡片）；
- **数据一条不删**：模型上下文、`messageHistory`、provider 输入完整保留；
- 清空后继续对话，模型仍然记得之前做过什么，可以接着往下做；
- 任务本身、标题、置顶/归档/未读、分组归属、会话 ID 与日志路径都保留。

这一语义刻意不同于「删除任务」和「回滚/rewind」：

- 删除任务：移除侧栏行，数据也随会话删除；
- rewind：是 runtime 也消费的分支裁剪，模型会真的失去那段上下文；
- 清空会话记录：只影响 UI 投影。

## 行为

| 场景 | 结果 |
| --- | --- |
| 会话 idle、无待应答交互、无排队输入 | 写入显示边界；界面变为空，消息数据与模型上下文不变 |
| 会话运行中 / 有排队输入 / 有 pending interaction | 拒绝，ACK `failed` + `guard.clearHistorySessionBusy`；不写边界 |
| 会话是尚未冷恢复的历史任务 | 直接写边界并降级 sessions-index 摘要；不需要先打开会话 |
| 会话非任务列表类型（subagent / workflow child / 选择侧聊） | 允许协议调用，但摘要不进 sessions-index |
| 清空后继续发消息 | 模型携带完整历史继续，界面只显示新产生的记录 |
| 清空后重启应用 | 界面仍然只显示边界之后的记录（边界持久化在 session_entry） |
| 一条消息都没有的会话 | 不写边界，命令幂等成功 |

## 协议与所有权

- 新 v4 命令 `clearSessionHistory: {}`，session 级、非 CAS（与 `renameSession` / `deleteSession` 同类）。
- UI 只发命令，不在本地改投影；空快照由 CLI 的 conversation publisher 通过既有订阅下发。
- CLI 是唯一裁决者：`host.clearSessionHistory` 负责 busy 预检、写边界与投影重置。
- 边界是一个 session_entry：`{ type: "runtime/transcript_visibility_boundary", data: { hiddenBeforeMessageID } }`。
  多次清空覆盖同一个 entry id，以最后一次为准。
- **只有 v4 投影读取它**（`cold-event-merge.ts` 的 `hideMessagesBeforeVisibilityBoundary`）。
  runtime 的 resume / hydration / 上下文构建完全不读，这是「模型仍记得」的保证。

执行顺序：

1. busy 预检：`activeAbortController` / `runtime.hasActiveOrQueuedTurnWork()` /
   `v4Interactions.hasPendingForSession()` / `CommandInbox` pinned 任一成立即拒绝。
   pin 检查必须排除当前这条命令自身（`exceptCommandId`），否则 in-flight 的自己会永远被判为忙。
2. 取当前最后一条消息作为边界（无消息则跳过），写入 session_entry，`touchSession: false`。
3. `gateway.clearSessionProjection`：把投影重物化为空、`seq` 抬到旧水位之上、`revision + 1`，
   让既有订阅 resync 到空快照；sessions-index 摘要降级为空态（保留 title / createdAt / parentSessionId）。
4. 不关闭 runtime、不删除 message/part、不写 `session.revert`。

## 不做

- 不删除 `message` / `part`（删了模型就失忆，与语义相反）。
- 不使用 `session.revert`（runtime 也消费它，同样会让模型丢上下文）。
- 不提供「恢复已隐藏记录」入口（用户已确认不需要）。
- 不做批量操作：一次只处理一个会话。

## UI

- 入口：任务菜单（侧栏右键菜单与工作区标题栏「更多」菜单），位置在「标记为未读」之后。
- 文案：`taskList.clearSessionHistory*`（中英），明确写出「保留模型上下文」。
- 确认框确认按钮使用 destructive；失败 toast 区分「会话忙」与其他失败。
- test id：`task-clear-session-history`。

## 验收场景

1. idle 会话点击清空并确认：侧栏行仍在、标题不变，时间线变为空。
2. 清空后发一条消息：模型能引用清空前的信息（上下文未丢），界面只显示新记录。
3. 重启应用后打开该会话：界面仍是空（或只有新记录），模型上下文仍完整。
4. 会话运行中点击：提示会话忙，边界不变。
5. 清空侧栏里从未打开过的历史任务：成功，且不需要先打开会话。
