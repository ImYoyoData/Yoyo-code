import type { ProviderConfigObject } from "@zcode/provider";
import { normalizeApiKeyForHeader } from "../providers/api/apiKeyHeaders.js";
import type {
  ProviderSettingsModelListTarget,
  ProviderSettingsModelLister,
} from "./providerFacadeServices.js";

type ProviderApiType = NonNullable<NonNullable<ProviderConfigObject["api"]>["type"]>;

/** 设置页里用户填写的 Base URL 可能是请求级地址，拉取目录前只回退这些 SDK 追加的路由段。 */
const TRAILING_REQUEST_ROUTE_SEGMENTS: Record<ProviderApiType, readonly string[]> = {
  "anthropic-messages": ["/v1/messages", "/messages"],
  // OpenAI Responses 的 SDK Base URL 通常已包含 /v1，运行时只追加 /responses。
  "openai-responses": ["/responses"],
  "openai-chat-completions": ["/chat/completions"],
};

const MODELS_ROUTE = "models";
const DEFAULT_TIMEOUT_MS = 20_000;
const ANTHROPIC_VERSION_HEADER = "anthropic-version";
/** Anthropic 的 /models 与 /messages 一样要求显式版本头，缺省会直接 400。 */
const ANTHROPIC_API_VERSION = "2023-06-01";

export interface ProviderModelsListerDependencies {
  /** Host 网络传输；Proxy、企业 CA 与 no_proxy 规则都由它统一处理。 */
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * 把 Provider 的 Base URL 归一成可拼接 `/models` 的前缀。
 * Anthropic 分支与适配层 normalizeAnthropicBaseURL 保持一致：Base URL 缺少 /v1 时由这里补齐，
 * 因为 Anthropic 的 SDK 只在 Base URL 后追加 /messages。
 */
export function resolveProviderModelsUrl(baseUrl: string, apiType: ProviderApiType): string {
  let prefix = baseUrl.trim().replace(/\/+$/u, "");
  for (const suffix of TRAILING_REQUEST_ROUTE_SEGMENTS[apiType]) {
    if (prefix.toLowerCase().endsWith(suffix)) {
      prefix = prefix.slice(0, -suffix.length).replace(/\/+$/u, "");
      break;
    }
  }
  if (apiType === "anthropic-messages" && !prefix.toLowerCase().endsWith("/v1")) {
    prefix = `${prefix}/v1`;
  }
  return `${prefix}/${MODELS_ROUTE}`;
}

/** Provider 自定义 headers 优先，避免用户已在配置里自行指定鉴权头时被覆盖。 */
export function resolveProviderModelsHeaders(
  target: ProviderSettingsModelListTarget,
): Record<string, string> {
  const apiKey = normalizeApiKeyForHeader(target.apiKey);
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (target.apiType === "anthropic-messages") {
    headers[ANTHROPIC_VERSION_HEADER] = ANTHROPIC_API_VERSION;
    headers["x-api-key"] = apiKey;
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  for (const [name, value] of Object.entries(target.headers ?? {})) {
    if (value.trim()) {
      headers[name] = value;
    }
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 兼容 OpenAI 风格 `{ data: [{ id }] }`、部分网关的 `{ models: [...] }` 与裸数组。
 * 保留供应商返回顺序：目录顺序本身就是供应商的推荐排序。
 */
export function parseProviderModelIds(payload: unknown): readonly string[] {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];

  const modelIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const raw =
      typeof candidate === "string"
        ? candidate
        : isRecord(candidate)
          ? (candidate.id ?? candidate.name ?? candidate.model)
          : undefined;
    const modelId = typeof raw === "string" ? raw.trim() : "";
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    modelIds.push(modelId);
  }
  return modelIds;
}

/** 网关的错误信封不统一，先取常见字段，再退回状态码，避免把整段 HTML 抛给用户。 */
async function readFailureMessage(response: Response, url: string): Promise<string> {
  const fallback = `HTTP ${response.status} (${url})`;
  try {
    const body = (await response.text()).trim();
    if (!body) {
      return fallback;
    }
    // 反向代理或站点首页会返回整页 HTML；这不是供应商给出的原因，对用户没有意义。
    if (body.startsWith("<")) {
      return fallback;
    }
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed)) {
        const error = parsed.error;
        const message = isRecord(error)
          ? (error.message ?? error.msg)
          : (error ?? parsed.message ?? parsed.msg ?? parsed.detail);
        if (typeof message === "string" && message.trim()) {
          return message.trim();
        }
      }
    } catch {
      return body.length > 300 ? `${body.slice(0, 300)}…` : body;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function createProviderModelsLister(
  dependencies: ProviderModelsListerDependencies,
): ProviderSettingsModelLister {
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (request) => {
    const url = resolveProviderModelsUrl(request.baseUrl, request.apiType);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await dependencies.fetch(url, {
        method: "GET",
        headers: resolveProviderModelsHeaders(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          success: false,
          error: {
            code: "provider-models-request-failed",
            message: await readFailureMessage(response, url),
          },
        };
      }
      try {
        return { success: true, modelIds: parseProviderModelIds(await response.json()) };
      } catch {
        return {
          success: false,
          error: {
            code: "provider-models-invalid-response",
            message: `模型列表响应不是合法 JSON（${url}）。`,
          },
        };
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        success: false,
        error: {
          code: aborted ? "provider-models-timeout" : "provider-models-request-failed",
          message: aborted
            ? `拉取模型列表超时（${timeoutMs} ms）。`
            : error instanceof Error
              ? error.message
              : String(error),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}
