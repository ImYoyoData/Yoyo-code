import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderModelsLister,
  parseProviderModelIds,
  resolveProviderModelsHeaders,
  resolveProviderModelsUrl,
} from "../src/model-provider/providerModelsLister.js";
import type { ProviderSettingsModelListTarget } from "../src/model-provider/providerFacadeServices.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("模型目录地址按 API 形态回退到可拼接 /models 的前缀", () => {
  assert.equal(
    resolveProviderModelsUrl("https://api.commandcode.ai/provider/v1", "openai-chat-completions"),
    "https://api.commandcode.ai/provider/v1/models",
  );
  assert.equal(
    resolveProviderModelsUrl("https://host/v1/chat/completions/", "openai-chat-completions"),
    "https://host/v1/models",
  );
  // Anthropic 的 SDK 只在 Base URL 之后追加 /messages，缺少 /v1 时必须由这里补齐。
  assert.equal(
    resolveProviderModelsUrl("https://api.z.ai/api/anthropic", "anthropic-messages"),
    "https://api.z.ai/api/anthropic/v1/models",
  );
  assert.equal(
    resolveProviderModelsUrl("https://api.anthropic.com/v1", "anthropic-messages"),
    "https://api.anthropic.com/v1/models",
  );
  assert.equal(
    resolveProviderModelsUrl("https://api.anthropic.com/v1/messages", "anthropic-messages"),
    "https://api.anthropic.com/v1/models",
  );
  assert.equal(
    resolveProviderModelsUrl("https://api.openai.com/v1/", "openai-responses"),
    "https://api.openai.com/v1/models",
  );
  assert.equal(
    resolveProviderModelsUrl("https://api.openai.com/v1/responses", "openai-responses"),
    "https://api.openai.com/v1/models",
  );
});

test("鉴权头按 API 形态选择，用户自定义 header 优先", () => {
  const openAi: ProviderSettingsModelListTarget = {
    baseUrl: "https://host/v1",
    apiType: "openai-chat-completions",
    apiKey: "Bearer sk-test-key",
  };
  assert.deepEqual(resolveProviderModelsHeaders(openAi), {
    accept: "application/json",
    authorization: "Bearer sk-test-key",
  });

  const anthropic: ProviderSettingsModelListTarget = {
    baseUrl: "https://host/v1",
    apiType: "anthropic-messages",
    apiKey: "sk-ant-test",
  };
  assert.deepEqual(resolveProviderModelsHeaders(anthropic), {
    accept: "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": "sk-ant-test",
  });

  const custom: ProviderSettingsModelListTarget = {
    baseUrl: "https://host/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test-key",
    headers: { Authorization: "Token custom-key", "X-Org": "team" },
  };
  const headers = resolveProviderModelsHeaders(custom);
  assert.equal(headers.Authorization, "Token custom-key");
  assert.equal(headers["X-Org"], "team");
});

test("模型目录解析兼容 data / models / 裸数组并去重", () => {
  assert.deepEqual(parseProviderModelIds({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] }), [
    "b",
    "a",
  ]);
  assert.deepEqual(parseProviderModelIds({ models: [{ name: "glm-4" }, "glm-air"] }), [
    "glm-4",
    "glm-air",
  ]);
  assert.deepEqual(parseProviderModelIds(["x", { model: " y " }, { id: "" }, 42, null]), [
    "x",
    "y",
  ]);
  assert.deepEqual(parseProviderModelIds({ unexpected: true }), []);
});

test("拉取成功时返回供应商顺序的模型列表", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const lister = createProviderModelsLister({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return jsonResponse({ data: [{ id: "deepseek/deepseek-v4-flash" }, { id: "typesafe/jev" }] });
    }) as typeof fetch,
  });

  const result = await lister({
    baseUrl: "https://api.commandcode.ai/provider/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test-key",
  });

  assert.deepEqual(result, {
    success: true,
    modelIds: ["deepseek/deepseek-v4-flash", "typesafe/jev"],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.commandcode.ai/provider/v1/models");
  assert.equal(calls[0]!.headers.authorization, "Bearer sk-test-key");
});

test("HTTP 失败时带上网关错误信息，非法 JSON 单独报错", async () => {
  const failing = createProviderModelsLister({
    fetch: (async () =>
      jsonResponse({ error: { message: "invalid api key" } }, 401)) as unknown as typeof fetch,
  });
  assert.deepEqual(
    await failing({
      baseUrl: "https://host/v1",
      apiType: "openai-chat-completions",
      apiKey: "sk-test-key",
    }),
    {
      success: false,
      error: { code: "provider-models-request-failed", message: "invalid api key" },
    },
  );

  const notJson = createProviderModelsLister({
    fetch: (async () =>
      new Response("<html>gateway</html>", { status: 200 })) as unknown as typeof fetch,
  });
  const notJsonResult = await notJson({
    baseUrl: "https://host/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test-key",
  });
  assert.equal(notJsonResult.success, false);
  assert.equal(
    notJsonResult.success === false ? notJsonResult.error.code : "",
    "provider-models-invalid-response",
  );

  // 反向代理返回整页 HTML 时只暴露状态码与地址，不能把页面正文当成错误原因。
  const htmlFailure = createProviderModelsLister({
    fetch: (async () =>
      new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch,
  });
  const htmlResult = await htmlFailure({
    baseUrl: "https://host/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test-key",
  });
  assert.deepEqual(htmlResult, {
    success: false,
    error: {
      code: "provider-models-request-failed",
      message: "HTTP 502 (https://host/v1/models)",
    },
  });
});

test("网络异常与超时分别落到稳定错误码", async () => {
  const throwing = createProviderModelsLister({
    fetch: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
  });
  const thrown = await throwing({
    baseUrl: "https://host/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test-key",
  });
  assert.equal(thrown.success, false);
  assert.deepEqual(thrown.success === false ? thrown.error : null, {
    code: "provider-models-request-failed",
    message: "ECONNREFUSED",
  });

  const hanging = createProviderModelsLister({
    timeoutMs: 20,
    // 未处理的 abort 会让真实 fetch 以取消错误结束；用等价的挂起实现验证超时分支。
    fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch,
  });
  const timedOut = await hanging({
    baseUrl: "https://host/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test-key",
  });
  assert.equal(timedOut.success, false);
  assert.equal(timedOut.success === false ? timedOut.error.code : "", "provider-models-timeout");
});
