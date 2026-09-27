import type { ModelConfigObject } from "@zcode/provider";

/** 端点为单个模型声明的能力；`config` 稀疏，只含该端点明确给出的字段。 */
export interface ProviderModelCatalogEntry {
  readonly id: string;
  readonly config: ModelConfigObject;
}

/**
 * 网关对推理参数只声明"支持 reasoning_effort"，不给档位集合。
 * 档位名取该参数的标准取值；map 沿用内置目录里 glm-5.3-flash 站点规则已在使用的写法。
 * 端点没声明 reasoning_effort 时不产出这一项——凭模型名补档位属于猜测。
 */
const REASONING_EFFORT_PARAMETERS = new Set(["reasoning_effort"]);
const REASONING_LEVEL_VALUES = ["low", "medium", "high"] as const;
const REASONING_LEVEL_MAP = '{"reasoning_effort": reasoningLevel}';

const JSON_SCHEMA_PARAMETERS = ["response_format", "json_schema"];
const NATIVE_WEB_SEARCH_PARAMETERS = new Set(["web_search_options", "web_search"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function firstPositiveInteger(source: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const parsed = positiveInteger(source[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function modalitySet(record: Record<string, unknown>): ReadonlySet<string> | undefined {
  const architecture = isRecord(record.architecture) ? record.architecture : undefined;
  const raw = architecture?.input_modalities ?? record.input_modalities;
  const modalities = stringList(raw).map((value) => value.trim().toLowerCase());
  // 模态列表缺失与"明确声明只有文本"是两种情况，不能都当成 false 去覆盖目录值。
  return modalities.length > 0 ? new Set(modalities) : undefined;
}

function parameterSet(record: Record<string, unknown>): ReadonlySet<string> {
  return new Set(stringList(record.supported_parameters).map((value) => value.trim().toLowerCase()));
}

/**
 * 把网关原始条目翻译成稀疏 ModelConfigObject。
 * 每一项都要求端点给出明确依据；`file` 不映射为 PDF（多数网关把两者混在一起）。
 */
export function readProviderModelCapabilities(record: Record<string, unknown>): ModelConfigObject {
  const properties: NonNullable<ModelConfigObject["properties"]> = {};
  const optionSpecs: NonNullable<ModelConfigObject["optionSpecs"]> = {};

  const contextWindow = firstPositiveInteger(record, ["context_length", "context_window"]);
  if (contextWindow !== undefined) properties.contextWindow = contextWindow;

  const topProvider = isRecord(record.top_provider) ? record.top_provider : undefined;
  const maxOutputTokens = firstPositiveInteger(topProvider ?? {}, ["max_completion_tokens"]) ??
    firstPositiveInteger(record, ["max_output_tokens", "max_completion_tokens"]);
  if (maxOutputTokens !== undefined) optionSpecs.maxOutputTokens = { max: maxOutputTokens };

  const modalities = modalitySet(record);
  if (modalities) {
    properties.inputFormat = {
      supportsImage: modalities.has("image"),
      supportsVideo: modalities.has("video"),
      supportsAudio: modalities.has("audio"),
      supportsPdf: modalities.has("pdf"),
    };
  }

  const parameters = parameterSet(record);
  if (parameters.size > 0) {
    if (JSON_SCHEMA_PARAMETERS.every((name) => parameters.has(name))) {
      properties.supportsJsonSchemaOutput = true;
    }
    if ([...parameters].some((name) => NATIVE_WEB_SEARCH_PARAMETERS.has(name))) {
      properties.supportsNativeWebSearch = true;
    }
    if ([...parameters].some((name) => REASONING_EFFORT_PARAMETERS.has(name))) {
      optionSpecs.reasoningLevel = {
        values: [...REASONING_LEVEL_VALUES],
        map: REASONING_LEVEL_MAP,
      };
    }
  }

  return {
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(Object.keys(optionSpecs).length > 0 ? { optionSpecs } : {}),
  };
}

/** 兼容 OpenAI 风格 `{ data: [{ id }] }`、部分网关的 `{ models: [...] }` 与裸数组。 */
export function readProviderModelCandidates(payload: unknown): readonly unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  if (isRecord(payload) && Array.isArray(payload.models)) return payload.models;
  return [];
}

export function readProviderModelEntryId(candidate: unknown): string {
  if (typeof candidate === "string") return candidate.trim();
  if (!isRecord(candidate)) return "";
  const raw = candidate.id ?? candidate.name ?? candidate.model;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 保留供应商返回顺序：目录顺序本身就是供应商的推荐排序。
 * 同一个 modelId 重复出现时保留首条，避免后出现的空壳条目抹掉已解析出的能力。
 */
export function parseProviderModelCatalog(payload: unknown): readonly ProviderModelCatalogEntry[] {
  const entries: ProviderModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of readProviderModelCandidates(payload)) {
    const id = readProviderModelEntryId(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      config: isRecord(candidate) ? readProviderModelCapabilities(candidate) : {},
    });
  }
  return entries;
}
