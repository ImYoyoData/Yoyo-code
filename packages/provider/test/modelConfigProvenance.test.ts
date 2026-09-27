import assert from "node:assert/strict";
import test from "node:test";
import { ModelConfig, ModelConfigRules } from "../src/config/model-config.js";

function rule(
  type: "model" | "provider-site",
  extra: { modelMatch: string; baseUrlMatch?: string },
  config: Parameters<typeof ModelConfig.fromData>[0],
) {
  return { type, ...extra, config: ModelConfig.fromData(config) } as const;
}

/** 只有通配兜底时，所有能力都是推断值，必须被标记为"没有专用规则"。 */
const CATCH_ALL_ONLY = new ModelConfigRules([
  rule("model", { modelMatch: ".*" }, {
    properties: { contextWindow: 200000, inputFormat: { supportsImage: false } },
    optionSpecs: { maxOutputTokens: { max: 32000 } },
  }),
]);

const GPT4O_INPUT = {
  providerId: "p1",
  modelId: "gpt-4o",
  apiType: "openai-responses" as const,
  baseUrl: "https://api.openai.com/v1",
};

test("只命中通配兜底时 hasModelSpecificRule 为 false", () => {
  const trace = CATCH_ALL_ONLY.resolveWithProvenance(GPT4O_INPUT);
  assert.equal(trace.hasModelSpecificRule, false);
  // 来源标记不能改变折叠结果：resolve 与 resolveWithProvenance 必须一致。
  assert.deepEqual(trace.config.toJSON(), CATCH_ALL_ONLY.resolve(GPT4O_INPUT).toJSON());
});

test("命中模型族专用规则时 hasModelSpecificRule 为 true", () => {
  const rules = new ModelConfigRules([
    ...CATCH_ALL_ONLY.rules(),
    rule("model", { modelMatch: ".*glm-4\\.6(?:[.\\-:/\\[].*)?" }, {
      optionSpecs: { maxOutputTokens: { max: 131072 } },
    }),
  ]);
  const trace = rules.resolveWithProvenance({
    providerId: "p1",
    modelId: "glm-4.6",
    apiType: "openai-chat-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  });
  assert.equal(trace.hasModelSpecificRule, true);
  assert.equal(trace.config.toJSON().optionSpecs?.maxOutputTokens?.max, 131072);
});

test("站点规则即使模型通配也算有依据", () => {
  // 该端点的能力是人工写死的，不是通配推断。
  const rules = new ModelConfigRules([
    ...CATCH_ALL_ONLY.rules(),
    rule(
      "provider-site",
      { modelMatch: ".*", baseUrlMatch: "https://open\\.bigmodel\\.cn/api/anthropic/?" },
      { properties: { inputFormat: { supportsImage: true, supportsVideo: true } } },
    ),
  ]);
  const matched = rules.resolveWithProvenance({
    providerId: "p1",
    modelId: "glm-4.6v",
    apiType: "anthropic-messages",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
  });
  assert.equal(matched.hasModelSpecificRule, true);

  // 同一条规则作用在别的端点上不算命中。
  const other = rules.resolveWithProvenance({
    providerId: "p1",
    modelId: "glm-4.6v",
    apiType: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
  });
  assert.equal(other.hasModelSpecificRule, false);
});

test("个人配置命中也算专用规则", () => {
  const personal = new ModelConfigRules().setExact(
    "p1",
    "gpt-4o",
    ModelConfig.fromData({ optionSpecs: { maxOutputTokens: { max: 16000 } } }),
    true,
  );
  const trace = personal.resolveWithProvenance({ providerId: "p1", modelId: "gpt-4o" });
  assert.equal(trace.hasModelSpecificRule, true);
  assert.equal(trace.config.toJSON().optionSpecs?.maxOutputTokens?.max, 16000);
});
