import assert from "node:assert/strict";
import test from "node:test";
import {
  parseModelsDevReasoningIndex,
  resolveModelsDevReasoningValues,
} from "../src/model-catalog/modelsDevReasoning.js";

const PAYLOAD = {
  commandcode: {
    id: "commandcode",
    api: "https://api.commandcode.ai/provider/v1",
    models: {
      "deepseek/deepseek-v4.1-flash": {
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
        reasoning: true,
        reasoning_options: [
          { type: "toggle" },
          { type: "effort", values: ["low", "high", "max"] },
        ],
      },
      "claude-haiku-4-5": {
        canonical_model_id: "anthropic/claude-haiku-4-5",
        reasoning: true,
        reasoning_options: [{ type: "budget_tokens", min: 1024 }],
      },
      "plain-model": { reasoning: false },
    },
  },
  openai: {
    id: "openai",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-5.4": {
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
      },
    },
  },
};

test("effort 优先于 toggle，budget_tokens 不产出", () => {
  const index = parseModelsDevReasoningIndex(PAYLOAD);
  assert.deepEqual(
    resolveModelsDevReasoningValues(index, {
      baseUrl: "https://api.commandcode.ai/provider/v1",
      modelId: "deepseek/deepseek-v4.1-flash",
    }),
    ["low", "high", "max"],
  );
  // budget_tokens 是数值区间，现有 values 无法表达 → 没有依据。
  assert.equal(
    resolveModelsDevReasoningValues(index, {
      baseUrl: "https://api.commandcode.ai/provider/v1",
      modelId: "claude-haiku-4-5",
    }),
    undefined,
  );
});

test("reasoning=false 的模型不产出档位", () => {
  const index = parseModelsDevReasoningIndex(PAYLOAD);
  assert.equal(
    resolveModelsDevReasoningValues(index, {
      providerId: "commandcode",
      modelId: "plain-model",
    }),
    undefined,
  );
});

test("canonical_model_id 也可作为键（回归）", () => {
  const index = parseModelsDevReasoningIndex(PAYLOAD);
  assert.deepEqual(
    resolveModelsDevReasoningValues(index, {
      providerId: "commandcode",
      modelId: "deepseek/deepseek-v4.1-flash",
    }),
    ["low", "high", "max"],
  );
});

test("Base URL 精确匹配优先，与 providerId 不同也能命中", () => {
  const index = parseModelsDevReasoningIndex(PAYLOAD);
  // 本地 provider id 随便叫什么都行，端点一致就算同一个网关。
  assert.deepEqual(
    resolveModelsDevReasoningValues(index, {
      providerId: "my-custom-id",
      baseUrl: "https://api.commandcode.ai/provider/v1/",
      modelId: "deepseek/deepseek-v4.1-flash",
    }),
    ["low", "high", "max"],
  );
});

test("匹配不到就返回 undefined，不猜", () => {
  const index = parseModelsDevReasoningIndex(PAYLOAD);
  assert.equal(
    resolveModelsDevReasoningValues(index, {
      providerId: "commandcode",
      modelId: "unknown-model",
    }),
    undefined,
  );
  assert.equal(
    resolveModelsDevReasoningValues(index, {
      baseUrl: "https://api.example.com/v1",
      modelId: "deepseek/deepseek-v4.1-flash",
    }),
    undefined,
  );
  assert.equal(resolveModelsDevReasoningValues(null, { modelId: "x" }), undefined);
});

test("非法结构不会抛错，只产出空索引", () => {
  assert.deepEqual(parseModelsDevReasoningIndex(null), {});
  assert.deepEqual(parseModelsDevReasoningIndex({ a: { models: "nope" } }), {});
  assert.deepEqual(
    parseModelsDevReasoningIndex({ a: { models: { m: { reasoning: true, reasoning_options: [] } } } }),
    {},
  );
});
