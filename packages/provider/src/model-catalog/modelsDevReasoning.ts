/**
 * models.dev 的推理等级取值。
 *
 * 只消费 `reasoning_options` 里的离散档位：
 * - `effort` 给出允许的档位集合
 * - `toggle` 只说明支持开关，固定映射为 disabled/enabled
 * - `budget_tokens` 是数值区间，现有 `values: string[]` 无法表达，直接跳过
 *
 * 数据按网关记录：同一 canonical model 在不同网关允许的集合可以不同。因此匹配只用
 * 精确身份（端点 Base URL 或模板 id），不做 host / 模型名模糊匹配。
 */

export type ModelsDevReasoningKind = "effort" | "toggle";

export interface ModelsDevReasoningEntry {
  readonly kind: ModelsDevReasoningKind;
  readonly values: readonly string[];
}

export interface ModelsDevProviderEntry {
  /** models.dev 记录该网关的 API 基址；用于和本地 Provider 的 Base URL 精确比对。 */
  readonly api: string | null;
  /** `modelId -> 档位`，同时用模型 id 与 canonical id 建键。 */
  readonly models: Readonly<Record<string, ModelsDevReasoningEntry>>;
}

/** `providerId -> 网关记录`。 */
export type ModelsDevReasoningIndex = Readonly<Record<string, ModelsDevProviderEntry>>;

const TOGGLE_VALUES = ["disabled", "enabled"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * 从一条模型的 `reasoning_options` 里取出可用的离散档位。
 * `effort` 优先于 `toggle`：同一模型两者并存时，前者信息更具体。
 */
export function readModelsDevReasoningEntry(value: unknown): ModelsDevReasoningEntry | undefined {
  if (!Array.isArray(value)) return undefined;
  let toggle = false;
  for (const option of value) {
    if (!isRecord(option)) continue;
    if (option.type === "effort") {
      const values = normalizeValues(option.values);
      if (values.length > 0) return { kind: "effort", values };
      continue;
    }
    if (option.type === "toggle") {
      toggle = true;
    }
    // budget_tokens：数值区间，本次不消费。
  }
  return toggle ? { kind: "toggle", values: [...TOGGLE_VALUES] } : undefined;
}

/** 归一 Base URL 用于精确比对：去掉尾部斜杠、统一大小写。 */
export function normalizeModelsDevBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const suffix = `${url.search}${url.hash}`;
    const serialized = url.toString();
    const endpoint = suffix.length === 0 ? serialized : serialized.slice(0, -suffix.length);
    return `${endpoint.replace(/\/+$/u, "")}${suffix}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/u, "").toLowerCase();
  }
}

/** 把 models.dev 的原始 `api.json` 压成精简索引（只保留网关身份与推理档位）。 */
export function parseModelsDevReasoningIndex(payload: unknown): ModelsDevReasoningIndex {
  const index: Record<string, ModelsDevProviderEntry> = {};
  if (!isRecord(payload)) return index;

  for (const [providerId, provider] of Object.entries(payload)) {
    if (!isRecord(provider)) continue;
    const models = provider.models;
    if (!isRecord(models)) continue;

    const bucket: Record<string, ModelsDevReasoningEntry> = {};
    for (const [modelKey, model] of Object.entries(models)) {
      if (!isRecord(model)) continue;
      // 没有 reasoning 标记、或标记为 false 的模型不产出任何档位。
      if (model.reasoning !== true) continue;
      const entry = readModelsDevReasoningEntry(model.reasoning_options);
      if (!entry) continue;

      bucket[modelKey] = entry;
      const canonical =
        typeof model.canonical_model_id === "string" ? model.canonical_model_id.trim() : "";
      if (canonical && canonical !== modelKey) {
        bucket[canonical] = entry;
      }
    }

    if (Object.keys(bucket).length === 0) continue;
    const api = typeof provider.api === "string" ? provider.api.trim() : "";
    index[providerId] = Object.freeze({
      api: api ? api : null,
      models: Object.freeze(bucket),
    });
  }
  return index;
}

/**
 * 解析某个模型的档位。
 *
 * 匹配顺序：Base URL 精确相等 → providerId 相等 → templateId 相等。
 * 三者都匹配不到就返回 undefined——不按 host 模糊匹配，也不按模型名猜。
 */
export function resolveModelsDevReasoningValues(
  index: ModelsDevReasoningIndex | null | undefined,
  params: {
    providerId?: string | null;
    templateId?: string | null;
    baseUrl?: string | null;
    modelId: string;
  },
): readonly string[] | undefined {
  if (!index) return undefined;
  const modelId = params.modelId.trim();
  if (!modelId) return undefined;

  const normalizedBaseUrl = normalizeModelsDevBaseUrl(params.baseUrl);
  const candidates: ModelsDevProviderEntry[] = [];

  if (normalizedBaseUrl) {
    for (const provider of Object.values(index)) {
      if (provider.api && normalizeModelsDevBaseUrl(provider.api) === normalizedBaseUrl) {
        candidates.push(provider);
      }
    }
  }
  for (const key of [params.providerId, params.templateId]) {
    const trimmed = key?.trim();
    if (!trimmed) continue;
    const provider = index[trimmed];
    if (provider) candidates.push(provider);
  }

  for (const provider of candidates) {
    const entry = provider.models[modelId];
    if (entry) return entry.values;
  }
  return undefined;
}
