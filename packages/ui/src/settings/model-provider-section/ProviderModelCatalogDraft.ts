import type { ModelConfigObject } from "@zcode/provider";
import type { ProviderModelDraftValues } from "./ProviderModelMetadata.js";

type SparseRecord = Record<string, unknown>;

/**
 * 端点 `/models` 声明的能力压在规则目录结果之上。
 *
 * 优先级依据见 docs/model-provider/model-catalog-capabilities.md：目录是正则推断，
 * 端点声明是该 Provider 对这个模型的实际承诺，因此目录输错时以端点为准。
 * 目录没声明的字段保持 undefined，继续沿用规则目录的值。
 */
export function mergeCatalogConfig(
  baseline: ModelConfigObject,
  catalog?: ModelConfigObject | null,
): ModelConfigObject {
  if (!catalog) return baseline;
  const properties = mergeLeaves(baseline.properties, catalog.properties);
  const optionSpecs = mergeLeaves(baseline.optionSpecs, catalog.optionSpecs);
  return {
    ...baseline,
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(Object.keys(optionSpecs).length > 0 ? { optionSpecs } : {}),
  } as ModelConfigObject;
}

/** 逐叶子合并，inputFormat / optionSpec 这类嵌套对象按字段覆盖而不是整块替换。 */
function mergeLeaves(
  base: ModelConfigObject["properties"] | ModelConfigObject["optionSpecs"],
  next: ModelConfigObject["properties"] | ModelConfigObject["optionSpecs"],
): SparseRecord {
  const result: SparseRecord = { ...base };
  for (const [key, value] of Object.entries(next ?? {})) {
    if (value === undefined || value === null) continue;
    const current = result[key];
    result[key] =
      isPlainObject(value) && isPlainObject(current) ? { ...current, ...value } : value;
  }
  return result;
}

function isPlainObject(value: unknown): value is SparseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 音频没有设置页入口，但端点声明后仍要落盘：否则提交完运行时又会退回目录基线。
const CATALOG_INPUT_FORMAT_KEYS = [
  "supportsImage",
  "supportsVideo",
  "supportsPdf",
  "supportsAudio",
] as const;
const CATALOG_BOOLEAN_KEYS = [
  "supportsJsonSchemaOutput",
  "supportsNativeWebSearch",
] as const;

/** 需要单独判断来源的能力项：上下文、最大输出、输入类型（视觉/视频/PDF）。 */
export type CapabilityField = "contextWindow" | "maxOutputTokens" | "inputFormat";

/**
 * 端点没声明、规则目录也没有该模型专用规则时写入的默认兜底参数。
 * 取值与内置目录的 `.*` 兜底一致，保证界面显示与运行时行为不会分裂。
 */
const FALLBACK_CAPABILITIES: Record<CapabilityField, ModelConfigObject> = {
  contextWindow: { properties: { contextWindow: 200_000 } },
  maxOutputTokens: { optionSpecs: { maxOutputTokens: { max: 32_000 } } },
  inputFormat: {
    properties: {
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
    },
  },
};

/**
 * 列出没有可靠来源的能力项。
 *
 * 可靠来源只有两种：该模型命中了规则目录里的专用规则，或端点 `/models` 声明了这一项。
 * 两者都没有时，界面显示的值只是通配兜底，必须提示用户确认，而不是当成已知能力。
 */
export function unverifiedCapabilityFields({
  catalogConfig,
  hasModelSpecificRule,
}: {
  catalogConfig?: ModelConfigObject | null;
  hasModelSpecificRule: boolean;
}): CapabilityField[] {
  if (hasModelSpecificRule) return [];
  const unverified: CapabilityField[] = [];
  if (catalogConfig?.properties?.contextWindow == null) unverified.push("contextWindow");
  if (catalogConfig?.optionSpecs?.maxOutputTokens?.max == null) unverified.push("maxOutputTokens");
  if (catalogConfig?.properties?.inputFormat == null) unverified.push("inputFormat");
  return unverified;
}

/** 为没有可靠来源的能力项补上默认兜底参数；端点已声明的项以端点为准。 */
export function withFallbackCapabilities(
  catalogConfig: ModelConfigObject | null | undefined,
  unverified: readonly CapabilityField[],
): ModelConfigObject | null {
  if (unverified.length === 0) return catalogConfig ?? null;
  let result: ModelConfigObject = catalogConfig ?? {};
  for (const field of unverified) {
    result = mergeCatalogConfig(FALLBACK_CAPABILITIES[field], result);
  }
  return result;
}

/**
 * 把端点声明的能力写进个人配置。
 *
 * 只写用户没有手动改过的项：手写 ID、手动调过的开关和数值必须以用户输入为准。
 * 走现有的 smart providerModelRules 通道，schema 与迁移都不需要变化；
 * 运行时 resolver 与设置页共用同一套 resolve 结果，因此界面显示与实际行为一致。
 */
export function applyCatalogPersonalConfig({
  personalConfig,
  catalog,
  draft,
}: {
  personalConfig: ModelConfigObject;
  catalog: ModelConfigObject;
  draft: ProviderModelDraftValues;
}): ModelConfigObject {
  if (!catalog.properties && !catalog.optionSpecs) return personalConfig;
  const overridden = new Set(draft.overriddenFieldsValue ?? []);
  const properties: SparseRecord = { ...personalConfig.properties };

  // 数值输入框空值即"跟随推荐"，因此空输入才代表用户没有覆盖。
  if (!draft.contextWindowValue.trim() && catalog.properties?.contextWindow != null) {
    properties.contextWindow = catalog.properties.contextWindow;
  }

  for (const key of CATALOG_BOOLEAN_KEYS) {
    if (overridden.has(`${key}Value`)) continue;
    const value = catalog.properties?.[key];
    if (value != null) properties[key] = value;
  }

  const inputFormat: SparseRecord = { ...(properties.inputFormat ?? {}) };
  let inputFormatChanged = false;
  for (const key of CATALOG_INPUT_FORMAT_KEYS) {
    if (overridden.has(`inputFormatValue.${key}`)) continue;
    const value = catalog.properties?.inputFormat?.[key];
    if (value == null) continue;
    inputFormat[key] = value;
    inputFormatChanged = true;
  }
  if (inputFormatChanged) properties.inputFormat = inputFormat;
  else if (Object.keys(inputFormat).length === 0) delete properties.inputFormat;

  const optionSpecs: SparseRecord = { ...(personalConfig.optionSpecs ?? {}) };
  // 与上下文同理：只有用户没手填，最大输出才落进个人配置。
  if (!draft.maxOutputTokensValue.trim() && catalog.optionSpecs?.maxOutputTokens?.max != null) {
    optionSpecs.maxOutputTokens = {
      ...(isPlainObject(optionSpecs.maxOutputTokens) ? optionSpecs.maxOutputTokens : {}),
      max: catalog.optionSpecs.maxOutputTokens.max,
    };
  }
  if (!overridden.has("reasoningLevelValuesValue") && catalog.optionSpecs?.reasoningLevel) {
    optionSpecs.reasoningLevel = { ...catalog.optionSpecs.reasoningLevel };
  }

  const result: SparseRecord = { ...personalConfig };
  if (Object.keys(properties).length > 0) result.properties = properties;
  else delete result.properties;
  if (Object.keys(optionSpecs).length > 0) result.optionSpecs = optionSpecs;
  else delete result.optionSpecs;
  return result as ModelConfigObject;
}
