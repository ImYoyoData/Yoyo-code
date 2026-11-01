# 执行输出尾部与 SQLite 事务隔离规范

本文件规定通用执行输出的请求级尾部契约，以及 `node:sqlite`（DatabaseSync）会话存储的事务边界。
修改这些行为前，先更新本文件。

## 请求级输出尾部

`world.run(..., { output: { tail: n } })` 需要「不限总输出，只留最后 n 字节」。契约：

| 项                 | 规则                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| 请求入口           | `ExecutionOutputLimit.tailBytes`                                     |
| 结果字段           | `ExecutionStreamResult.tail`                                         |
| 未请求             | 结果里不出现 `tail` 字段，老调用方结果形状不变                       |
| inline 上限        | 与尾部互不影响；inline 照常截断、计数，进程照常读到退出              |
| 字节边界           | 按字节切，解码后首字符可能是半个多字节字符（U+FFFD）                 |
| 生效范围           | 仅通用 collector 执行；Bash 合并文件输出不使用该字段                 |
| 空流 / 总输出不足 | 请求了尾部时返回空字符串或全部内容                                   |

实现约束：尾部按块保存、整块出队，只在结算时拼接一次；不能每个 chunk 复制整个尾部，也不能
每个进度 tick 解码整块尾部。

## SQLite 事务隔离

`DatabaseSync` 的事务属于整条连接，不是单个会话。从 `begin immediate` 到 `commit` / `rollback`
之间不能出现 `await`：

- 事务内 `await` 会让其他会话的写入落进同一事务；fork 或导入回滚时，这些已成功的写入被一起撤销，
  重启后会话与历史直接消失。
- 会话存储的内部仓库（messages / session-inputs 等）保持同步函数；不要在事务内 await 它们，
  也不要把它们改回 async。
- 故障注入（`forkCommitFaultAt`）与并发写入的回归测试：
  `adapters/test/session-store-transaction-isolation.test.ts`。

## 非目标

- 不改变 Bash 合并输出的持久化与保留规则。
- 不改变非事务路径上的其他异步 IO 行为。
