import { useCallback, useState } from "react";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { sendClearSessionHistory } from "@/v4/clearSessionHistoryCommand.js";

interface ClearSessionHistoryTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  taskId: string;
  taskTitle: string;
}

/**
 * 任务菜单「清空会话记录」的交互层：确认 → 发 v4 命令 → toast。
 *
 * 不清本地任务缓存：命令成功后 CLI 会通过既有 conversation 订阅下发空快照，
 * 由投影统一刷新；这里只负责错误呈现。
 * target 为 null 表示当前没有可清理的会话（草稿/未落库任务），入口不应渲染。
 */
export function useClearSessionHistoryAction(target: ClearSessionHistoryTarget | null) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const resolution = useWorkspaceServicesResolution(
    target?.workspacePath ?? null,
    target?.remoteSessionId ?? null,
    target?.workspaceIdentity ?? null,
  );
  const [pending, setPending] = useState(false);

  return {
    pending,
    clearSessionHistory: useCallback(async () => {
      if (!target || pending) return;
      const services = resolution.services;
      if (!resolution.rpcReady || !services) {
        toast(intl.formatMessage({ id: "taskList.clearSessionHistoryUnavailable" }));
        return;
      }
      const confirmed = await confirmDialog({
        title: intl.formatMessage({ id: "taskList.clearSessionHistoryTitle" }),
        description: intl.formatMessage(
          { id: "taskList.clearSessionHistoryDescription" },
          { taskTitle: target.taskTitle },
        ),
        confirmLabel: intl.formatMessage({ id: "taskList.clearSessionHistory" }),
        confirmVariant: "destructive",
      });
      if (!confirmed) return;
      setPending(true);
      try {
        await sendClearSessionHistory({
          workspacePath: target.workspacePath,
          ...(target.workspaceIdentity?.trim()
            ? { workspaceIdentity: target.workspaceIdentity }
            : {}),
          sessionId: target.taskId,
          services,
        });
        toast(intl.formatMessage({ id: "taskList.clearSessionHistoryDone" }));
      } catch (error) {
        const reasonCode = (error as { reasonCode?: string } | null)?.reasonCode;
        logger.warn("[clear-session-history] 清空会话记录失败", {
          error: error instanceof Error ? error.message : String(error),
          reasonCode: reasonCode ?? null,
          sessionId: target.taskId,
        });
        toast(
          reasonCode === "guard.clearHistorySessionBusy"
            ? intl.formatMessage({ id: "taskList.clearSessionHistoryBusy" })
            : intl.formatMessage({ id: "taskList.clearSessionHistoryFailed" }),
        );
      } finally {
        setPending(false);
      }
    }, [
      confirmDialog,
      intl,
      pending,
      resolution.rpcReady,
      resolution.services,
      target,
    ]),
  };
}
