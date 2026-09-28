import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelConfigObject } from "@zcode/provider";
import type { ProviderModelCatalogEntry, ProviderSettingsModelListResult } from "@zcode/services";
import type {
  ProviderModelDraftValues,
  ProviderModelDraftCommitResult,
} from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { ProviderModelInputModalityOptions } from "@/settings/model-provider-section/ProviderModelModalityOptions.js";
import { BooleanModelOption } from "@/settings/model-provider-section/ProviderModelMetadataFields.js";
import {
  ModelSettingsGroup,
  ProviderModelReasoningSettings,
} from "@/settings/model-provider-section/ProviderModelSettingsGroups.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import {
  ProviderModelMetadataDialogActions,
  ModelSmartConfigSwitch,
  ModelConfigDraftFeedback,
  ModelConfigRestoreButton,
} from "@/settings/model-provider-section/ProviderModelMetadataDialogActions.js";
import { ProviderModelIdField } from "@/settings/model-provider-section/ProviderModelIdField.js";
import { ProviderModelNumericField } from "@/settings/model-provider-section/ProviderModelNumericField.js";
import { ProviderModelCapabilityNotice } from "@/settings/model-provider-section/ProviderModelCapabilityNotice.js";
import type { CapabilityField } from "@/settings/model-provider-section/ProviderModelCatalogDraft.js";
import { ModelConfigHelp } from "@/settings/model-provider-section/ModelConfigHelp.js";

import { ModelEditorAdvanced } from "@/settings/model-provider-section/ModelEditorAdvanced.js";

function selectFocusedInputText(event: Pick<FocusEvent<HTMLInputElement>, "currentTarget">) {
  event.currentTarget.select();
}

export function ProviderModelMetadataDialog({
  mode = "edit",
  open,
  draft,
  draftErrorMessage,
  draftErrorField,
  personalConfig,
  overrideFields,
  inheritedConfig,
  onOpenChange,
  onDraftChange,
  onRestore,
  onCommit,
  modelConfigResolutionPending = false,
  modelIdReadOnly = false,
  saving = false,
  modelDefaultsLoaded = false,
  onModelIdBlur,
  onListModelIds,
  onCatalogSelect,
  unverifiedFields = [],
}: {
  mode?: "add" | "edit";
  open: boolean;
  draft: ProviderModelDraftValues;
  draftErrorMessage: string | null;
  draftErrorField?: Extract<ProviderModelDraftCommitResult, { status: "invalid" }>["field"] | null;
  personalConfig?: ModelConfigObject;
  overrideFields?: ReadonlySet<string>;
  inheritedConfig?: ModelConfigObject;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (patch: Partial<ProviderModelDraftValues>) => void;
  onRestore?: () => void;
  onCommit: () => boolean | Promise<boolean>;
  modelConfigResolutionPending?: boolean;
  modelIdReadOnly?: boolean;
  saving?: boolean;
  modelDefaultsLoaded?: boolean;
  onModelIdBlur?: () => void;
  /** 按供应商端点拉取模型目录；仅新增模型且 ID 可编辑时提供，编辑态仍走改名语义。 */
  onListModelIds?: () => Promise<ProviderSettingsModelListResult>;
  /** 目录点选时上抛端点为该模型声明的能力，供回填基线与提交落盘使用。 */
  onCatalogSelect?: (entry: ProviderModelCatalogEntry) => void;
  /** 没有可靠来源、当前显示的是默认兜底值的能力项；非空时展示确认提示。 */
  unverifiedFields?: readonly CapabilityField[];
}) {
  const { intl } = useZCodeIntl();
  const [validationAttempt, setValidationAttempt] = useState(0);
  const commit = async () => {
    const result = await onCommit();
    if (!result) setValidationAttempt((value) => value + 1);
  };
  const contextWindowInputId = useId();
  const maxOutputInputId = useId();
  const smart = draft.useRecommendedConfigValue !== false;
  const activeOverrides = smart ? overrideFields : new Set<string>();
  const overridden = (field: string, legacy = false) =>
    smart && (activeOverrides ? activeOverrides.has(field) : legacy);
  // 推荐值以真值预填：用户要的"自动带出"必须看得见数字，而不是灰色提示。
  // 空输入仍表示跟随推荐，因此清空输入框就等于撤销个人覆盖。
  const recommendedContextWindow =
    smart && inheritedConfig?.properties?.contextWindow != null
      ? String(inheritedConfig.properties.contextWindow)
      : "";
  const recommendedMaxOutputTokens =
    smart && inheritedConfig?.optionSpecs?.maxOutputTokens?.max != null
      ? String(inheritedConfig.optionSpecs.maxOutputTokens.max)
      : "";
  const contextWindowDisplay = draft.contextWindowValue.trim()
    ? draft.contextWindowValue
    : recommendedContextWindow;
  const maxOutputTokensDisplay = draft.maxOutputTokensValue.trim()
    ? draft.maxOutputTokensValue
    : recommendedMaxOutputTokens;
  const editModelLabel = intl.formatMessage({
    id: "settings.modelProvider.editModel",
  });
  // 新增模型时模型 ID 为空，如果沿用编辑态的上下文窗口自动聚焦，会让用户先落到默认数值字段。
  // 编辑态仍保留上下文窗口自动聚焦和选中，方便直接修改已有模型配置。
  const shouldFocusModelIdInput = mode === "add";
  const shouldFocusContextWindowInput = mode === "edit";
  // 目录在新增与编辑都可用于挑选模型 ID；内置模型 ID 不可改，不提供目录。
  const modelIdCatalogAvailable = !modelIdReadOnly && Boolean(onListModelIds);
  const addModelConfigResolutionPending = smart && modelConfigResolutionPending;
  const compositionActiveRef = useRef(false);
  const handleTechnicalInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    // 输入法候选确认也会发出 Enter。某些 Electron/macOS 版本的
    // nativeEvent.isComposing 会过早恢复 false，因此同时保留本地 composition 状态。
    if (
      isImeComposingKeyEvent({
        compositionActive: compositionActiveRef.current,
        nativeEvent: event.nativeEvent,
      })
    ) {
      return;
    }
    event.preventDefault();
    void commit();
  };
  const handleCompositionStart = () => {
    compositionActiveRef.current = true;
  };
  const handleCompositionEnd = () => {
    compositionActiveRef.current = false;
  };
  const maxOutputTokensInputDisabled = mode === "add" && !draft.idValue.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mode === "edit" ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 p-0"
            aria-label={editModelLabel}
            title={editModelLabel}
          >
            <Pencil className="size-3.5 text-foreground-subtle" />
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        // overflow-hidden 仍允许聚焦触发外层滚动；语言换行后曾滚走标题。仅正文滚动，外框只裁切。
        className="max-h-[min(48rem,calc(100vh-4rem))] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {intl.formatMessage({
              id:
                mode === "add"
                  ? "settings.modelProvider.addModel"
                  : "settings.modelProvider.editModel",
            })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({
              id: "settings.modelProvider.editModelDescription",
            })}
          </DialogDescription>
          <ModelSmartConfigSwitch
            disabled={saving}
            checked={smart}
            onChange={(useRecommendedConfigValue) => onDraftChange({ useRecommendedConfigValue })}
          />
        </DialogHeader>
        {/* 保存期间锁定正文交互，不改变原有滚动容器；页脚单独显示提交状态。 */}
        <div
          inert={saving}
          className="min-h-0 min-w-0 -mr-3 space-y-4 overflow-y-auto pr-4"
          data-model-settings-scroll="true"
        >
          <ModelSettingsGroup group="basic">
            <div data-model-identity-row="true" className="flex flex-col gap-4">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-ui-base text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.modelProvider.modelId" })}
                </label>
                <ProviderModelIdField
                  autoFocus={shouldFocusModelIdInput}
                  readOnly={modelIdReadOnly}
                  value={draft.idValue}
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.modelId",
                  })}
                  onListModelIds={modelIdCatalogAvailable ? onListModelIds : undefined}
                  onSelect={modelIdCatalogAvailable ? onCatalogSelect : undefined}
                  onChange={(idValue) => {
                    onDraftChange({ idValue });
                  }}
                  onBlur={onModelIdBlur}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelSettingsGroup group="tokens">
            <div className="space-y-3">
              <ProviderModelCapabilityNotice
                modelId={draft.idValue.trim()}
                unverifiedFields={unverifiedFields}
              />
              <ProviderModelNumericField
                inputId={contextWindowInputId}
                field="contextWindow"
                value={contextWindowDisplay}
                overridden={overridden(
                  "contextWindowValue",
                  personalConfig?.properties?.contextWindow !== undefined,
                )}
                onChangeValue={(contextWindowValue) => onDraftChange({ contextWindowValue })}
                onReset={() => onDraftChange({ contextWindowValue: "" })}
                autoFocus={shouldFocusContextWindowInput}
                onFocus={selectFocusedInputText}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onKeyDown={handleTechnicalInputKeyDown}
              />
            </div>
          </ModelSettingsGroup>
          <ModelSettingsGroup group="tokens">
            <div className="space-y-3">
              <ProviderModelNumericField
                inputId={maxOutputInputId}
                field="maxOutputTokens"
                value={maxOutputTokensDisplay}
                overridden={overridden(
                  "maxOutputTokensValue",
                  personalConfig?.optionSpecs?.maxOutputTokens?.max !== undefined,
                )}
                onChangeValue={(maxOutputTokensValue) => onDraftChange({ maxOutputTokensValue })}
                onReset={() => onDraftChange({ maxOutputTokensValue: "" })}
                disabled={maxOutputTokensInputDisabled}
                pending={addModelConfigResolutionPending}
                testId="max-output"
                onFocus={selectFocusedInputText}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onKeyDown={handleTechnicalInputKeyDown}
              />
            </div>
          </ModelSettingsGroup>
          <ModelEditorAdvanced
            open={open}
            defaultExpanded={mode === "add"}
            errorField={draftErrorField}
            validationAttempt={validationAttempt}
          >
            <ModelSettingsGroup group="modalities">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 block text-ui-base text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.modelProvider.inputModalities" })}
                    <ModelConfigHelp field="inputModalities" />
                  </div>
                  <ProviderModelInputModalityOptions
                    value={draft.inputFormatValue}
                    onChange={(inputFormatValue) => onDraftChange({ inputFormatValue })}
                    personalValue={personalConfig?.properties?.inputFormat}
                    overrideFields={activeOverrides}
                  />
                </div>
              </div>
            </ModelSettingsGroup>
            <ModelSettingsGroup group="capabilities">
              <div>
                <div
                  className="mb-1 block text-ui-base text-foreground-subtle"
                  data-model-capabilities-label="true"
                >
                  {intl.formatMessage({ id: "settings.modelProvider.capabilities" })}
                  <ModelConfigHelp field="capabilities" />
                </div>
                <div className="flex flex-wrap gap-2" data-model-capabilities-options="true">
                  {(
                    [
                      "supportsJsonSchemaOutput",
                      "supportsNativeWebSearch",
                      "supportsMidConversationSystem",
                    ] as const
                  ).map((property) => {
                    const field = `${property}Value` as const;
                    return (
                      <BooleanModelOption
                        key={property}
                        label={intl.formatMessage({ id: `settings.modelProvider.${property}` })}
                        selected={draft[field] ?? false}
                        onToggle={() => onDraftChange({ [field]: !(draft[field] ?? false) })}
                        overridden={overridden(
                          field,
                          personalConfig?.properties?.[property] !== undefined,
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            </ModelSettingsGroup>
            <ProviderModelReasoningSettings
              draft={draft}
              personalConfig={personalConfig}
              overrideFields={activeOverrides}
              inheritedConfig={inheritedConfig}
              onDraftChange={onDraftChange}
            />
          </ModelEditorAdvanced>
        </div>
        <ModelConfigDraftFeedback error={draftErrorMessage} matched={modelDefaultsLoaded} />
        <ProviderModelMetadataDialogActions
          leadingAction={<ModelConfigRestoreButton disabled={saving} onRestore={onRestore} />}
          saveLabel={intl.formatMessage({ id: "common.save" })}
          cancelLabel={intl.formatMessage({ id: "common.cancel" })}
          saving={saving}
          onSave={() => void commit()}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
