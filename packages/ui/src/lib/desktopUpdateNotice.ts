import type { UpdateCheckResultPayload } from "@zcode/shared";

export type DesktopUpdateNotice = {
  id: string;
  values?: Record<string, string>;
};

/**
 * 把主进程的手动检查结果映射成短提示。
 *
 * 失败分支刻意只给通用文案：payload.message 是 electron-updater 抛出的原始文本
 * （HTTP 状态、重定向、CSP 报错等），直接展示既没有可操作信息，也可能带出内部地址。
 */
export function resolveDesktopUpdateNotice(
  payload: UpdateCheckResultPayload,
): DesktopUpdateNotice | null {
  switch (payload.kind) {
    case "up-to-date":
      return { id: "update.toast.upToDate", values: { version: payload.currentVersion } };
    case "available":
      return { id: "update.toast.available", values: { version: payload.version } };
    case "downloading":
      return { id: "update.toast.downloading", values: { version: payload.version } };
    case "already-downloading":
      return { id: "update.toast.alreadyDownloading", values: { progress: payload.progress } };
    case "ready":
      return { id: "update.toast.ready", values: { version: payload.version } };
    case "dev-skipped":
      return { id: "update.toast.devSkipped" };
    case "error":
      return { id: "update.toast.failed" };
    default:
      return null;
  }
}
