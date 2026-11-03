// 「清空会话记录」命令派发。
//
// 语义（与 CLI clearSessionHistory 对齐）：只删聊天记录，保留任务行、标题与置顶/归档。
// UI 只负责发命令，绝不本地改投影——空快照由 CLI 的 publisher 通过既有订阅下发。
import type { IServiceAccessor } from "@zcode/services";
import { ensureAgentV4ConnectionHandshake } from "@/v4/agentV4ConnectionHandshake.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { logger } from "@/logger.js";

interface ClearSessionHistoryTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  services: Pick<IServiceAccessor, "zcodeAgentService">;
}

/**
 * 发送 clearSessionHistory。
 *
 * staleRevision 在这里不会发生（该命令非 CAS），但会话可能刚刚被冷关闭而短暂不存在；
 * 这类失败原样抛给调用方，由 UI 用 toast 呈现，不静默吞掉。
 */
export async function sendClearSessionHistory(
  target: ClearSessionHistoryTarget,
): Promise<void> {
  const agentService = target.services.zcodeAgentService;
  await ensureAgentV4ConnectionHandshake(agentService);
  const ack = await agentService.sendConversationCommandV4({
    workspacePath: target.workspacePath,
    ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
    envelope: createCommandEnvelope({
      type: "clearSessionHistory",
      payload: {},
      sessionId: target.sessionId,
    }),
  });
  if (ack.status !== "accepted" && ack.status !== "duplicate" && ack.status !== "noop") {
    logger.warn("[clear-session-history] 命令被拒绝", {
      reasonCode: ack.reasonCode ?? null,
      sessionId: target.sessionId,
      status: ack.status,
    });
    const error = new Error(ack.reasonCode ?? ack.message ?? "clearSessionHistory rejected") as Error & {
      reasonCode?: string;
    };
    if (ack.reasonCode) error.reasonCode = ack.reasonCode;
    throw error;
  }
}
