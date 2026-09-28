import { useCallback } from "react";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import {
  buildWorkspaceDisplayNamesPatch,
  resolveWorkspaceDisplayNameKey,
  type WorkspaceDisplayNames,
} from "@/lib/workspaceDisplayName.js";
import { logger } from "@/logger.js";

/**
 * workspace 备注名的读写入口。
 *
 * 唯一所有者是设置服务（settings.json），这里只做投影：读用共享 settings 快照，
 * 写用 settings.update。快照带 listener 且跨窗口共享，所以 A 窗口改名后 B 窗口自动更新，
 * 不需要额外的广播。
 */
export function useWorkspaceDisplayNames() {
  const { settingService } = useServices();
  const { settings, update } = useSettings();
  const displayNames = settings?.workspaceDisplayNames;
  // 远程窗口的 host 不提供 settingService；此时只读，重命名入口应当隐藏而不是报错。
  const canRename = Boolean(settingService);

  const displayNameFor = useCallback(
    ({ workspacePath, workspaceIdentity }: { workspacePath: string; workspaceIdentity?: string | null }) =>
      displayNames?.[
        resolveWorkspaceDisplayNameKey({ workspacePath, workspaceIdentity })
      ],
    [displayNames],
  );

  const rename = useCallback(
    async ({
      workspacePath,
      workspaceIdentity,
      displayName,
    }: {
      workspacePath: string;
      workspaceIdentity?: string | null;
      displayName: string;
    }) => {
      if (!settingService) {
        logger.warn("[useWorkspaceDisplayNames] 当前窗口不支持重命名，跳过写入", { workspacePath });
        return;
      }
      const next = buildWorkspaceDisplayNamesPatch({
        current: displayNames,
        workspaceKey: resolveWorkspaceDisplayNameKey({ workspacePath, workspaceIdentity }),
        nextDisplayName: displayName,
        workspacePath,
      });
      // 与当前一致时不写入，避免每次点确认都产生一次无意义的设置写盘。
      if (!next) return;
      await update({ workspaceDisplayNames: next as WorkspaceDisplayNames });
    },
    [displayNames, settingService, update],
  );

  return { displayNames, canRename, displayNameFor, rename } as const;
}
