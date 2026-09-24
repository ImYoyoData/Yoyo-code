import { ArrowDownToLine, RotateCcw } from "lucide-react";
import type { IPlatformService, UpdateStatePayload } from "@zcode/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Progress } from "@/components/ui/progress.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { deriveUpdateStatusViewModel } from "@/updateStatusModel.js";

/**
 * 应用内更新弹窗：发现新版本 → 下载增量包（electron-updater 走 *.blockmap 差分）→ 重启安装。
 * 只有这三个阶段之外没有别的界面，检查失败一律交给 toast，不在这里回显底层错误。
 */
export function UpdateStatusDialog({
  platform,
  version,
  updateState,
  open,
  onOpenChange,
}: {
  platform: IPlatformService;
  /** legacy 的 ready version，仅用于兼容旧事件通道。 */
  version: string | null;
  updateState: UpdateStatePayload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const [actionInFlight, setActionInFlight] = useState<"download" | "cancel" | "skip" | "restart">();
  const { dialogPhase, displayVersion, progressLabel, progressValue, skippableVersion } =
    deriveUpdateStatusViewModel({ legacyReadyVersion: version, updateState });

  // 弹窗在下载中被关闭时状态仍在推进，重新打开必须还能看到当前阶段，所以这里不做本地阶段缓存。
  const handleDownload = async () => {
    setActionInFlight("download");
    try {
      await platform.downloadUpdate();
    } catch (error) {
      // 主进程会把失败广播成 updateState，这里只记录，避免弹窗里出现第二种错误表达。
      logger.warn("[UpdateStatusDialog] 下载更新失败", { error });
    } finally {
      setActionInFlight(undefined);
    }
  };

  const handleCancelDownload = async () => {
    setActionInFlight("cancel");
    try {
      await platform.cancelUpdateDownload();
    } catch (error) {
      logger.warn("[UpdateStatusDialog] 取消下载失败", { error });
    } finally {
      setActionInFlight(undefined);
    }
  };

  const handleRestart = async () => {
    setActionInFlight("restart");
    try {
      await platform.quitAndInstallUpdate();
    } catch (error) {
      logger.warn("[UpdateStatusDialog] 重启安装失败", { error });
      setActionInFlight(undefined);
    }
  };

  const handleSkipVersion = async () => {
    if (!skippableVersion) return;
    setActionInFlight("skip");
    try {
      await platform.skipUpdateVersion(skippableVersion);
      onOpenChange(false);
    } catch (error) {
      logger.warn("[UpdateStatusDialog] 跳过版本失败", { error });
    } finally {
      setActionInFlight(undefined);
    }
  };

  if (!displayVersion) {
    return null;
  }

  const titleId =
    dialogPhase === "downloaded"
      ? "updateDialog.readyTitle"
      : dialogPhase === "downloading"
        ? "updateDialog.downloadingTitle"
        : "updateDialog.availableTitle";
  const actionDisabled = actionInFlight !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]" data-testid="update-status-dialog">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: titleId }, { version: displayVersion })}</DialogTitle>
          <DialogDescription>
            {dialogPhase === "downloaded"
              ? intl.formatMessage({ id: "updateReady.confirm.description" })
              : intl.formatMessage({ id: "updateDialog.availableDescription" })}
          </DialogDescription>
        </DialogHeader>

        {dialogPhase === "downloading" ? (
          <div className="space-y-1.5">
            <Progress value={progressValue} />
            <div className="flex items-center justify-between text-ui-xs text-muted-foreground">
              <span>{intl.formatMessage({ id: "updateDialog.downloadProgress" })}</span>
              <span>{progressLabel ?? `${progressValue}%`}</span>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          {dialogPhase === "downloading" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={actionDisabled}
              onClick={() => void handleCancelDownload()}
            >
              {intl.formatMessage({ id: "updateDialog.cancelDownload" })}
            </Button>
          ) : (
            <>
              {skippableVersion ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={actionDisabled}
                  onClick={() => void handleSkipVersion()}
                >
                  {intl.formatMessage({ id: "updateDialog.skipVersion" })}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={actionDisabled}
                onClick={() => onOpenChange(false)}
              >
                {intl.formatMessage({ id: "updateDialog.later" })}
              </Button>
            </>
          )}
          {dialogPhase === "downloaded" ? (
            <Button type="button" disabled={actionDisabled} onClick={() => void handleRestart()}>
              <RotateCcw className="size-3.5" />
              {intl.formatMessage({ id: "updateDialog.restartToUpdate" })}
            </Button>
          ) : dialogPhase === "downloading" ? null : (
            <Button type="button" disabled={actionDisabled} onClick={() => void handleDownload()}>
              <ArrowDownToLine className="size-3.5" />
              {intl.formatMessage({ id: "updateDialog.downloadAndUpdate" })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
