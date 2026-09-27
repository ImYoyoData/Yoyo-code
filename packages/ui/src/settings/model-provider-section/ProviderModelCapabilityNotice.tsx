import { AlertTriangleIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CapabilityField } from "@/settings/model-provider-section/ProviderModelCatalogDraft.js";

/**
 * 端点没声明能力、规则目录也没有该模型专用规则时的提示。
 *
 * 这类模型填进来的数字是通配兜底，不是它的事实；必须让用户知道要自己核对，
 * 否则错误的能力会直接决定请求截断和附件能否发送。
 */
export function ProviderModelCapabilityNotice({
  modelId,
  unverifiedFields,
}: {
  modelId: string;
  unverifiedFields: readonly CapabilityField[];
}) {
  const { intl } = useZCodeIntl();
  if (unverifiedFields.length === 0) return null;
  const labels = unverifiedFields
    .map((field) => intl.formatMessage({ id: CAPABILITY_FIELD_MESSAGE_IDS[field] }))
    .join(intl.formatMessage({ id: "settings.modelProvider.capabilityNotice.separator" }));
  return (
    <div
      role="status"
      data-model-capability-notice="unverified"
      className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-ui-base text-foreground">
          {intl.formatMessage(
            { id: "settings.modelProvider.capabilityNotice.unverifiedTitle" },
            { modelId: modelId || "-" },
          )}
        </p>
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.modelProvider.capabilityNotice.unverifiedBody" },
            { fields: labels },
          )}
        </p>
      </div>
    </div>
  );
}

const CAPABILITY_FIELD_MESSAGE_IDS = {
  contextWindow: "settings.modelProvider.contextWindow",
  maxOutputTokens: "settings.modelProvider.maxOutputTokens",
  inputFormat: "settings.modelProvider.inputModalities",
} as const satisfies Record<CapabilityField, string>;
