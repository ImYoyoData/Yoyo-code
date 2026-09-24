import type { IPlatformService, UpdateStatePayload } from "@zcode/shared";
import { ArrowDownToLine, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { resolveUpdateButtonResponsiveClasses } from "@/updateStatusButtonLayout.js";
import { UpdateStatusDialog } from "@/UpdateStatusDialog.js";
import { deriveUpdateStatusViewModel } from "@/updateStatusModel.js";

/**
 * 顶部浮层的更新入口。只在存在待处理更新时出现，点击打开更新弹窗（下载 / 取消 / 重启安装）。
 * 未发现更新时不渲染：没有更新可做的时候顶部不该长期占一个按钮。
 */
export function UpdateStatusButton({
  platform,
  version,
  updateState,
  isMacDesktop = false,
  isWindowsDesktop = false,
  className,
}: {
  platform: IPlatformService;
  version: string | null;
  updateState: UpdateStatePayload | null;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { dialogPhase, displayVersion, progressLabel } = deriveUpdateStatusViewModel({
    legacyReadyVersion: version,
    updateState,
  });

  // 发现新版本时自动弹出更新弹窗，让"检查更新 → 有更新"这一步不需要用户再点一次入口。
  // 同一版本只自动弹一次：用户点「稍后」关掉之后，红点和顶部入口继续留在原地提示。
  const autoOpenedVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!displayVersion || dialogPhase === "downloading") {
      return;
    }
    if (autoOpenedVersionRef.current === displayVersion) {
      return;
    }
    autoOpenedVersionRef.current = displayVersion;
    setDialogOpen(true);
  }, [dialogPhase, displayVersion]);

  if (!displayVersion) {
    return null;
  }

  const { expandWidthClass, hideIconClass, revealTextClass } = resolveUpdateButtonResponsiveClasses({
    isMacDesktop,
    isWindowsDesktop,
  });
  const tooltipTitle =
    dialogPhase === "downloading"
      ? progressLabel
        ? intl.formatMessage(
            { id: "desktopMenu.help.downloadingUpdateProgress" },
            { progress: progressLabel },
          )
        : intl.formatMessage(
            { id: "desktopMenu.help.downloadingUpdateVersion" },
            { version: displayVersion },
          )
      : dialogPhase === "downloaded"
        ? intl.formatMessage({ id: "updateReady.tooltip" }, { version: displayVersion })
        : intl.formatMessage({ id: "updateAvailable.tooltip" }, { version: displayVersion });

  return (
    <>
      <ControlHintTooltip title={tooltipTitle} side="bottom">
        <Button
          type="button"
          size="xs"
          variant="secondary"
          aria-label={tooltipTitle}
          onClick={() => setDialogOpen(true)}
          className={cn(
            // 主页面更新入口保留 success 色块，避免顶部状态提示变弱；下载态保持可点，用户才能进去取消。
            // xs button 的固定 h-5 和固定展开宽度只适配默认字号，UI 字号调大后会被裁切，
            // 所以改用最小高度配合内容宽度，默认紧凑、大字号由文字自然撑开。
            // 红点靠绝对定位挂在按钮角上，按钮本身不能 overflow-hidden。
            "relative h-auto min-h-5 w-6 gap-1 rounded-full border-transparent bg-success py-0.5 font-medium leading-none text-success-foreground text-ui-xs transition-all hover:bg-success/80 [app-region:no-drag]",
            dialogPhase !== "downloading" && expandWidthClass,
            className,
          )}
        >
          {dialogPhase === "downloading" ? (
            // 下载态用 spinner 表达 loading，不能复用普通更新图标的展开隐藏规则。
            <LoaderCircle className="size-3 shrink-0 animate-spin" />
          ) : (
            <ArrowDownToLine className={cn("inline size-3 shrink-0", hideIconClass)} />
          )}
          {dialogPhase !== "downloading" ? (
            <span
              className={cn(
                "absolute w-0 overflow-hidden opacity-0 transition-all",
                ...revealTextClass,
              )}
            >
              {intl.formatMessage({ id: "updateReady.shortTitle" })}
            </span>
          ) : null}
          {/*
            发现新版本 / 有更新待处理时的红点。背景是 success 色块，用 destructive 红点保持"可操作"信号，
            与帮助图标上的红点同一语义。
          */}
          <span
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-destructive ring-1 ring-background"
            aria-hidden="true"
          />
        </Button>
      </ControlHintTooltip>
      <UpdateStatusDialog
        platform={platform}
        version={version}
        updateState={updateState}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
