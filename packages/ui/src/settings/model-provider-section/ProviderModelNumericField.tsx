import type { FocusEvent, KeyboardEvent } from "react";
import { Loader2Icon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";
import { ModelConfigInputLabel } from "@/settings/model-provider-section/ModelConfigHelp.js";

/**
 * 上下文窗口与最大输出共用的数值控件。
 *
 * 推荐值以真值预填（`value` 已含推荐值），空输入才表示"跟随推荐"，
 * 因此出现覆盖时提供恢复按钮，而不是把推荐值退回灰色 placeholder。
 */
export function ProviderModelNumericField({
  inputId,
  field,
  value,
  overridden,
  onChangeValue,
  onReset,
  autoFocus = false,
  disabled = false,
  pending = false,
  testId,
  onFocus,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
}: {
  inputId: string;
  field: "contextWindow" | "maxOutputTokens";
  /** 已合成推荐值的显示文本。 */
  value: string;
  /** 是否存在个人覆盖；只影响控件配色与恢复按钮。 */
  overridden: boolean;
  onChangeValue: (value: string) => void;
  /** 清空个人覆盖，回到推荐值。 */
  onReset: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** 解析推荐值进行中，在标签行显示加载态。 */
  pending?: boolean;
  testId?: string;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { intl } = useZCodeIntl();
  const resetLabel = intl.formatMessage({ id: "settings.modelProvider.resetToRecommended" });
  return (
    <div {...(testId ? { "data-model-max-output": "true" } : {})}>
      <div className="mb-1 flex items-center gap-2">
        <div className="text-ui-base text-foreground-subtle">
          <ModelConfigInputLabel field={field} htmlFor={inputId} />
        </div>
        {pending ? (
          <span className="inline-flex shrink-0 items-center text-foreground-subtlest" role="status">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            <span className="sr-only">{intl.formatMessage({ id: "common.loading" })}</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          {...TECHNICAL_INPUT_ATTRIBUTES}
          id={inputId}
          type="text"
          autoFocus={autoFocus}
          inputMode="numeric"
          pattern="[0-9]*"
          size="lg"
          value={value}
          disabled={disabled}
          data-personal-override={overridden}
          className={modelEditorControlStyle(overridden)}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.maxOutputTokens" })}
          aria-busy={pending}
          onChange={(event) => onChangeValue(event.target.value)}
          onFocus={onFocus}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onKeyDown={onKeyDown}
        />
        {overridden ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={resetLabel} title={resetLabel} onClick={onReset}>
            <RotateCcwIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
