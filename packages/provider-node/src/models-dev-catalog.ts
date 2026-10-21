import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWritePrivateTextFile } from "@zcode/shared/node";
import {
  parseModelsDevReasoningIndex,
  type ModelsDevReasoningIndex,
} from "@zcode/provider";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20_000;
const BODY_LIMIT_BYTES = 14_000_000;

export interface ModelsDevCatalogOptions {
  /** 精简索引的落盘位置，例如 `{v2}/runtime/model-catalog/models-dev.json`。 */
  readonly cacheFilePath: string;
  /** Host 网络传输：Proxy / 企业 CA / no_proxy 都由它统一处理。 */
  readonly request: (url: string, init: RequestInit) => Promise<Response>;
  readonly signal?: AbortSignal;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

interface ModelsDevCacheFile {
  readonly schemaVersion: typeof CACHE_SCHEMA_VERSION;
  readonly fetchedAt: number;
  readonly index: ModelsDevReasoningIndex;
}

/** 同一个缓存文件只允许一个在途下载，避免并发触发时重复拉 6MB。 */
const inflight = new Map<string, Promise<ModelsDevReasoningIndex | null>>();

/**
 * 读取 models.dev 推理索引；缓存过期时刷新。
 *
 * 失败策略：刷新失败但有旧缓存时返回旧值（宁可少补一些档位），完全拿不到才返回 null。
 * 调用方必须把 null 当作"没有依据"，不能退回猜测。
 */
export function loadModelsDevReasoningIndex(
  options: ModelsDevCatalogOptions,
): Promise<ModelsDevReasoningIndex | null> {
  const key = options.cacheFilePath;
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = load(options).finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

async function load(options: ModelsDevCatalogOptions): Promise<ModelsDevReasoningIndex | null> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cached = await readCache(options.cacheFilePath);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return cached.index;
  }

  try {
    const index = await downloadIndex(options);
    await writeCache(options.cacheFilePath, { schemaVersion: CACHE_SCHEMA_VERSION, fetchedAt: now(), index });
    return index;
  } catch {
    // 刷新失败：有旧缓存就用旧的，没有就是没有依据。
    return cached?.index ?? null;
  }
}

async function readCache(filePath: string): Promise<ModelsDevCacheFile | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(parsed)) return null;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    if (typeof parsed.fetchedAt !== "number") return null;
    if (!isRecord(parsed.index)) return null;
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      fetchedAt: parsed.fetchedAt,
      index: parsed.index as ModelsDevReasoningIndex,
    };
  } catch {
    // 缓存损坏等同于没有缓存，下次成功下载会覆盖它。
    return null;
  }
}

async function writeCache(filePath: string, value: ModelsDevCacheFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await atomicWritePrivateTextFile(filePath, JSON.stringify(value));
}

async function downloadIndex(options: ModelsDevCatalogOptions): Promise<ModelsDevReasoningIndex> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  try {
    const response = await options.request(MODELS_DEV_URL, {
      method: "GET",
      signal,
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await readBody(response, signal);
    return parseModelsDevReasoningIndex(JSON.parse(text));
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty body");
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > BODY_LIMIT_BYTES) throw new Error("body limit exceeded");
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
