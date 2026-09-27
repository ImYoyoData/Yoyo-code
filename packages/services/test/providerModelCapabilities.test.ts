import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProviderModelCatalog,
  readProviderModelCapabilities,
} from "../src/model-provider/providerModelCapabilities.js";

test("端点声明的上下文与最大输出按稀疏叶子回填", () => {
  const config = readProviderModelCapabilities({
    id: "gpt-4o",
    context_length: 128000,
    top_provider: { max_completion_tokens: 16384 },
  });
  assert.equal(config.properties?.contextWindow, 128000);
  assert.equal(config.optionSpecs?.maxOutputTokens?.max, 16384);
});

test("非正整数的上下文不产出字段，沿用规则目录的值", () => {
  // 网关偶发返回 null / 0 / 字符串；写成 0 会让运行时把所有请求都当成超长而拒绝。
  for (const bad of [null, 0, -1, "128000", 1.5]) {
    const config = readProviderModelCapabilities({ id: "m", context_length: bad });
    assert.equal(config.properties?.contextWindow, undefined);
  }
});

test("模态按 input_modalities 逐项映射", () => {
  const config = readProviderModelCapabilities({
    id: "m",
    architecture: { input_modalities: ["text", "image", "video", "audio"] },
  });
  assert.deepEqual(config.properties?.inputFormat, {
    supportsImage: true,
    supportsVideo: true,
    supportsAudio: true,
    supportsPdf: false,
  });
});

test("file 不映射为 PDF（回归）", () => {
  // 多数网关把 PDF 归到 file；据此置真就是把猜测当事实，会让运行时按 PDF 已支持处理附件。
  const config = readProviderModelCapabilities({
    id: "m",
    architecture: { input_modalities: ["text", "file"] },
  });
  assert.equal(config.properties?.inputFormat?.supportsPdf, false);
  assert.equal(config.properties?.inputFormat?.supportsImage, false);
});

test("模态列表缺失时不覆盖目录值", () => {
  const config = readProviderModelCapabilities({ id: "m", context_length: 8000 });
  assert.equal(config.properties?.inputFormat, undefined);
});

test("结构化输出要求 response_format 与 json_schema 同时出现", () => {
  const both = readProviderModelCapabilities({
    id: "m",
    supported_parameters: ["response_format", "json_schema"],
  });
  assert.equal(both.properties?.supportsJsonSchemaOutput, true);
  const onlyFormat = readProviderModelCapabilities({
    id: "m",
    supported_parameters: ["response_format"],
  });
  assert.equal(onlyFormat.properties?.supportsJsonSchemaOutput, undefined);
});

test("原生联网搜索只认明确的搜索参数", () => {
  const config = readProviderModelCapabilities({
    id: "m",
    supported_parameters: ["web_search_options", "temperature"],
  });
  assert.equal(config.properties?.supportsNativeWebSearch, true);
});

test("声明 reasoning_effort 时才推导推理等级，map 可编译", () => {
  const config = readProviderModelCapabilities({
    id: "m",
    supported_parameters: ["reasoning_effort"],
  });
  assert.deepEqual(config.optionSpecs?.reasoningLevel?.values, ["low", "medium", "high"]);
  assert.equal(config.optionSpecs?.reasoningLevel?.map, '{"reasoning_effort": reasoningLevel}');

  const withoutEffort = readProviderModelCapabilities({
    id: "m",
    supported_parameters: ["reasoning"],
  });
  assert.equal(withoutEffort.optionSpecs?.reasoningLevel, undefined);
});

test("只声明 id 的条目产出空配置，由规则目录决定全部能力", () => {
  const [entry] = parseProviderModelCatalog({ data: [{ id: "gpt-4o" }] });
  assert.equal(entry?.id, "gpt-4o");
  assert.deepEqual(entry?.config, {});
});

test("目录解析兼容 data / models / 裸数组并去重", () => {
  const data = parseProviderModelCatalog({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] });
  assert.deepEqual(
    data.map((entry) => entry.id),
    ["b", "a"],
  );
  const models = parseProviderModelCatalog({ models: [{ name: "glm-4" }, "glm-air"] });
  assert.deepEqual(
    models.map((entry) => entry.id),
    ["glm-4", "glm-air"],
  );
  const bare = parseProviderModelCatalog(["x", { model: " y " }, { id: "" }, 42, null]);
  assert.deepEqual(
    bare.map((entry) => entry.id),
    ["x", "y"],
  );
  assert.deepEqual(parseProviderModelCatalog({ unexpected: true }), []);
});

test("重复 modelId 保留首条，不让后出现的空壳条目抹掉能力", () => {
  const entries = parseProviderModelCatalog({
    data: [{ id: "a", context_length: 64000 }, { id: "a" }],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.config.properties?.contextWindow, 64000);
});
