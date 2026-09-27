import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCatalogPersonalConfig,
  mergeCatalogConfig,
  unverifiedCapabilityFields,
  withFallbackCapabilities,
} from "../src/settings/model-provider-section/ProviderModelCatalogDraft.js";
import type { ProviderModelDraftValues } from "../src/settings/model-provider-section/ProviderModelMetadata.js";

/** 规则目录对未收录模型给出的兜底基线：ctx 200000 / maxOut 32000 / 全 false。 */
const BUILTIN_BASELINE = {
  properties: {
    contextWindow: 200000,
    inputFormat: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: false,
  },
  optionSpecs: {
    maxOutputTokens: { max: 32000, map: "{\"max_tokens\": maxOutputTokens}" },
    reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
  },
};

const CATALOG_ENTRY = {
  properties: {
    contextWindow: 128000,
    inputFormat: { supportsImage: true, supportsVideo: false, supportsAudio: false, supportsPdf: true },
    supportsJsonSchemaOutput: true,
  },
  optionSpecs: { maxOutputTokens: { max: 16384 } },
};

function createDraft(patch: Partial<ProviderModelDraftValues> = {}): ProviderModelDraftValues {
  return {
    idValue: "gpt-4o",
    contextWindowValue: "",
    maxOutputTokensValue: "",
    inputFormatValue: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    enabledValue: true,
    useRecommendedConfigValue: true,
    clearPersonalConfigValue: false,
    overriddenFieldsValue: [],
    supportsJsonSchemaOutputValue: false,
    supportsNativeWebSearchValue: false,
    supportsMidConversationSystemValue: false,
    reasoningLevelValuesValue: ["disabled", "enabled"],
    reasoningLevelMapValue: "",
    ...patch,
  };
}

test("端点声明覆盖规则目录的兜底值，未声明的字段保持目录值", () => {
  const merged = mergeCatalogConfig(BUILTIN_BASELINE, CATALOG_ENTRY);
  assert.equal(merged.properties?.contextWindow, 128000);
  assert.equal(merged.properties?.inputFormat?.supportsImage, true);
  assert.equal(merged.properties?.inputFormat?.supportsPdf, true);
  assert.equal(merged.optionSpecs?.maxOutputTokens?.max, 16384);
  // 目录没声明音频与联网搜索，必须继续沿用基线，不能因为合成而被清掉。
  assert.equal(merged.properties?.inputFormat?.supportsAudio, false);
  assert.equal(merged.properties?.supportsNativeWebSearch, false);
});

test("合成保留目录的 map，只覆盖端点给出的数值", () => {
  // map 是系统叶子，个人配置不能也不该改写它。
  const merged = mergeCatalogConfig(BUILTIN_BASELINE, CATALOG_ENTRY);
  assert.equal(
    merged.optionSpecs?.maxOutputTokens?.map,
    BUILTIN_BASELINE.optionSpecs.maxOutputTokens.map,
  );
});

test("没有目录声明时合成结果就是基线本身", () => {
  assert.equal(mergeCatalogConfig(BUILTIN_BASELINE, undefined), BUILTIN_BASELINE);
  assert.equal(mergeCatalogConfig(BUILTIN_BASELINE, null), BUILTIN_BASELINE);
});

test("端点声明写入个人配置，运行时与界面因此一致", () => {
  const personal = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog: CATALOG_ENTRY,
    draft: createDraft(),
  });
  assert.equal(personal.properties?.contextWindow, 128000);
  assert.equal(personal.properties?.supportsJsonSchemaOutput, true);
  assert.equal(personal.properties?.inputFormat?.supportsImage, true);
  assert.equal(personal.properties?.inputFormat?.supportsPdf, true);
  assert.equal(personal.optionSpecs?.maxOutputTokens?.max, 16384);
});

test("用户手动改过的项不被端点声明覆盖", () => {
  const personal = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog: CATALOG_ENTRY,
    draft: createDraft({
      // 用户在输入框里手填了数值：空输入才代表"跟随推荐"。
      contextWindowValue: "1000000",
      maxOutputTokensValue: "8000",
      overriddenFieldsValue: ["inputFormatValue.supportsImage", "supportsJsonSchemaOutputValue"],
    }),
  });
  assert.equal(personal.properties?.contextWindow, undefined);
  assert.equal(personal.optionSpecs?.maxOutputTokens, undefined);
  assert.equal(personal.properties?.inputFormat?.supportsImage, undefined);
  assert.equal(personal.properties?.supportsJsonSchemaOutput, undefined);
  // 没被改过的项照常写入。
  assert.equal(personal.properties?.inputFormat?.supportsPdf, true);
});

test("目录声明的音频能力也落盘，提交后不会退回目录基线", () => {
  // 音频没有设置页入口，但端点声明过就必须写进个人配置，
  // 否则提交完运行时又按目录的 supportsAudio:false 处理音频附件。
  const personal = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog: { properties: { inputFormat: { supportsAudio: true } } },
    draft: createDraft(),
  });
  assert.equal(personal.properties?.inputFormat?.supportsAudio, true);
});

test("目录未声明的能力不写进个人配置", () => {
  const personal = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog: { properties: { contextWindow: 64000 } },
    draft: createDraft(),
  });
  assert.equal(personal.properties?.contextWindow, 64000);
  assert.equal(personal.properties?.supportsJsonSchemaOutput, undefined);
  assert.equal(personal.properties?.inputFormat, undefined);
  assert.equal(personal.optionSpecs, undefined);
});

test("推理等级只在用户未改过时写入", () => {
  const catalog = {
    optionSpecs: {
      reasoningLevel: { values: ["low", "medium", "high"], map: '{"reasoning_effort": reasoningLevel}' },
    },
  };
  const untouched = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog,
    draft: createDraft(),
  });
  assert.deepEqual(untouched.optionSpecs?.reasoningLevel?.values, ["low", "medium", "high"]);

  const overridden = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog,
    draft: createDraft({ overriddenFieldsValue: ["reasoningLevelValuesValue"] }),
  });
  assert.equal(overridden.optionSpecs, undefined);
});

test("端点没声明、目录也没有专用规则时，三项能力全部标记为未验证", () => {
  // OpenAI / Anthropic 官方 /models 只返回 id，不含任何能力字段。
  assert.deepEqual(unverifiedCapabilityFields({ catalogConfig: {}, hasModelSpecificRule: false }), [
    "contextWindow",
    "maxOutputTokens",
    "inputFormat",
  ]);
  assert.deepEqual(unverifiedCapabilityFields({ catalogConfig: null, hasModelSpecificRule: false }), [
    "contextWindow",
    "maxOutputTokens",
    "inputFormat",
  ]);
});

test("目录里有该模型的专用规则时不做任何提示", () => {
  assert.deepEqual(unverifiedCapabilityFields({ catalogConfig: null, hasModelSpecificRule: true }), []);
});

test("端点声明齐全时不提示", () => {
  assert.deepEqual(
    unverifiedCapabilityFields({ catalogConfig: CATALOG_ENTRY, hasModelSpecificRule: false }),
    [],
  );
});

test("端点只声明部分能力时，只提示缺的那几项", () => {
  assert.deepEqual(
    unverifiedCapabilityFields({
      catalogConfig: { properties: { contextWindow: 64000 } },
      hasModelSpecificRule: false,
    }),
    ["maxOutputTokens", "inputFormat"],
  );
});

test("未验证项补默认兜底，端点已声明的项不被兜底覆盖", () => {
  const partial = { properties: { contextWindow: 64000 } };
  const seeded = withFallbackCapabilities(partial, ["maxOutputTokens", "inputFormat"]);
  assert.equal(seeded?.properties?.contextWindow, 64000);
  assert.equal(seeded?.optionSpecs?.maxOutputTokens?.max, 32000);
  assert.equal(seeded?.properties?.inputFormat?.supportsImage, false);
  // 兜底不得改写用户手填的输入类型。
  const userPicked = { properties: { contextWindow: 64000, inputFormat: { supportsImage: true } } };
  const stillUser = withFallbackCapabilities(userPicked, ["maxOutputTokens", "inputFormat"]);
  assert.equal(stillUser?.properties?.inputFormat?.supportsImage, true);
});

test("没有未验证项时不合成兜底配置", () => {
  assert.equal(withFallbackCapabilities(CATALOG_ENTRY, []), CATALOG_ENTRY);
  assert.equal(withFallbackCapabilities(null, []), null);
});

test("兜底参数会真正落进个人配置", () => {
  // 用户没手填任何值时，默认兜底必须写进去，界面显示才等于运行时行为。
  const seeded = withFallbackCapabilities({}, ["contextWindow", "maxOutputTokens", "inputFormat"]);
  const personal = applyCatalogPersonalConfig({
    personalConfig: {},
    catalog: seeded!,
    draft: createDraft(),
  });
  assert.equal(personal.properties?.contextWindow, 200000);
  assert.equal(personal.optionSpecs?.maxOutputTokens?.max, 32000);
  assert.equal(personal.properties?.inputFormat?.supportsImage, false);
});
