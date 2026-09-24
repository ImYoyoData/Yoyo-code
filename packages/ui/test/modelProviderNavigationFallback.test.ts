import assert from "node:assert/strict";
import test from "node:test";
import { pickRenderableFallbackNodeKey } from "../src/settings/model-provider-section/modelProviderNavigationFallback.js";

const COMMANDCODE_KEY = "custom:commandcode";
const ZAI_START_PLAN_KEY = "preset:account:zai-start-plan";

test("初始化落点在侧栏里可渲染时优先使用（账号分支行为不变）", () => {
  assert.equal(
    pickRenderableFallbackNodeKey({
      preferredNodeKey: ZAI_START_PLAN_KEY,
      sideNavigationNodeKeys: [ZAI_START_PLAN_KEY, COMMANDCODE_KEY],
    }),
    ZAI_START_PLAN_KEY,
  );
});

test("初始化落点不可渲染时，默认选中第一个已配置的供应商（回归）", () => {
  // 本分支侧栏只有自定义供应商，套餐项推导出的 start-plan 预设键不在侧栏里。
  // 之前会把它当成回退目标，右侧因此永久停在「暂未添加模型」空态。
  assert.equal(
    pickRenderableFallbackNodeKey({
      preferredNodeKey: ZAI_START_PLAN_KEY,
      sideNavigationNodeKeys: [COMMANDCODE_KEY],
    }),
    COMMANDCODE_KEY,
  );
});

test("没有初始化落点时，默认选中侧栏第一项", () => {
  assert.equal(
    pickRenderableFallbackNodeKey({
      preferredNodeKey: null,
      sideNavigationNodeKeys: [COMMANDCODE_KEY, "custom:other"],
    }),
    COMMANDCODE_KEY,
  );
});

test("侧栏为空时返回 null", () => {
  assert.equal(
    pickRenderableFallbackNodeKey({ preferredNodeKey: null, sideNavigationNodeKeys: [] }),
    null,
  );
  assert.equal(
    pickRenderableFallbackNodeKey({
      preferredNodeKey: ZAI_START_PLAN_KEY,
      sideNavigationNodeKeys: [],
    }),
    null,
  );
});
