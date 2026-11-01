# 队列「引导发送」规范

本文件规定会话队列中单条待发送消息的「引导发送」行为。修改前先更新本文件。

## 目标

队列面板在「立即发送」之外提供「引导发送」：把一条已排队的普通输入转为 guide 投递，
在当前任务的下一次模型 / 工具调用处注入，而不是等本轮结束或中断本轮。

## 行为

| 场景 | 结果 |
| --- | --- |
| 当前 turn 运行中且可 steer、无附件 | 输入进入当前 turn 的 pending guide，下一轮工具调用前注入；原队列项消失 |
| 当前 turn 运行中但不可 steer 或无 active turn | 按 Core admission 既有规则回退队列（delivery 可能降为 queue），内容不丢失 |
| 会话 idle（如队列暂停后） | 等同立即发送：直接启动新 turn；guide 仅在运行中才有区别 |
| 队列项 kind 为 `compact` / `sendGoalCommand` | 不支持，CLI 拒绝；UI 不展示该按钮 |
| 该项 dispatch 不是 `queued` 或正在编辑 | 按钮禁用 |
| 附件存在 | 允许点击；Core 按 `guide` 规则回退为普通队列项，不丢附件 |

## 协议与所有权

- 新命令 `sendQueuedGuide: { queueItemId }`，与其它队列写命令一样要求 `baseRevision`（CAS）。
- CLI 是唯一裁决者：UI 只发命令，不在本地改队列。
- handler 先 `reserveQueueItem` 防止并发 drain，再复用既有 guide admission：
  `startPromptTurn(... queueDelivery: "guide")`。成功 admitted（started 或 queued）后
  `removeQueueItem(..., reason: "promoted")`；admission 失败或抛错时释放 reservation，原项原位保留。
- 新 admission 使用新 commandId 生成新的 `sourceCommandId` / `queueItemId`，原队列项仅作为
  `provenance` 带入；禁止直接复用原 queueItemId，否则删除原项会同时移除刚注入的 guide。

## UI

- 队列行在「立即」按钮旁新增「引导」按钮，样式沿用 secondary，图标用引导语义图标；
  提供 aria / tooltip 说明「下一轮工具调用后运行」。
- 文案：`chat.queue.sendGuide` / `chat.queue.sendGuide.description`（中英）。
- 埋点 action：`conversation.queue.item` / `send_guide`，失败阶段 `queue_send_guide`。

## 验收场景

1. 运行中点击某队列项「引导」：该项离开队列面板，当前 turn 的下一次工具调用前出现该输入；
   其余队列项顺序不变。
2. 空闲时点击「引导」：正常启动新 turn，行为与「立即」一致。
3. 并发 drain / 多端重复点击：只有一次 admission，另一侧收到 reserved / noop，不重复发送。
4. `compact` 项不出现「引导」按钮，协议层直接拒绝。
5. 有附件的队列项点击「引导」：内容与附件保留，回到（或留在）队列，UI 不崩溃。
