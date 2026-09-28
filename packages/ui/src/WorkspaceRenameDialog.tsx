import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";

/**
 * workspace 重命名弹窗。
 *
 * 这只是软件内部的备注名：不改 workspacePath，也不触碰磁盘上的文件夹或文件。
 * 弹窗因此显式展示真实路径，避免用户以为操作会重命名目录。
 */
export function WorkspaceRenameDialog({
  open,
  folderName,
  workspacePath,
  initialValue,
  saving = false,
  inputRef,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  /** 真实文件夹名，也就是清空备注后回落显示的名字。 */
  folderName: string;
  workspacePath: string;
  initialValue: string;
  saving?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpenChange: (open: boolean) => void;
  /** 传入空串表示清除备注，界面回落到真实文件夹名。 */
  onConfirm: (displayName: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const [value, setValue] = useState(initialValue);
  const compositionActiveRef = useRef(false);

  // 每次打开都以当前生效名重置草稿，否则上次取消时留下的半截文字会带进来。
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden rounded-2xl p-0">
        <div className="flex min-w-0 flex-col gap-6 p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle>{intl.formatMessage({ id: "workspaceSidebar.rename.title" })}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "workspaceSidebar.rename.description" })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col space-y-4">
            <Input
              ref={inputRef}
              value={value}
              size="lg"
              autoFocus
              placeholder={folderName}
              aria-label={intl.formatMessage({ id: "workspaceSidebar.rename.input" })}
              onChange={(event) => setValue(event.target.value)}
              onCompositionStart={() => {
                compositionActiveRef.current = true;
              }}
              onCompositionEnd={() => {
                compositionActiveRef.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (
                  isImeComposingKeyEvent({
                    compositionActive: compositionActiveRef.current,
                    nativeEvent: event.nativeEvent,
                  })
                ) {
                  // 中文输入法的 Enter 是候选确认，不能当成确认按钮。
                  // 同时读本地 composition 状态：部分平台 isComposing 会提前变 false。
                  return;
                }
                event.preventDefault();
                onConfirm(value);
              }}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "workspaceSidebar.rename.folderName" })}
              </span>
              <span className="break-all text-ui-sm text-foreground-subtle">{folderName}</span>
              <span className="mt-1 break-all text-ui-sm text-foreground-subtlest">
                {workspacePath}
              </span>
            </div>
          </div>
          <DialogFooter className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="h-10 min-w-0 px-5"
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-10 min-w-0 px-5"
              disabled={saving}
              onClick={() => onConfirm(value)}
            >
              {intl.formatMessage({ id: "common.confirm" })}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
