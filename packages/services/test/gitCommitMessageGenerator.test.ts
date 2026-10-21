import assert from "node:assert/strict";
import test from "node:test";
import { GitCommitMessageGenerator } from "../src/git/gitCommitMessageGenerator.js";

const FILE = {
  kind: "modified" as const,
  path: "a.ts",
  repoRelativePath: "a.ts",
  added: 1,
  removed: 0,
};

function createGenerator(options: {
  currentModel?: { providerId: string; modelId: string } | null;
  text?: string;
}) {
  const calls = { readCurrentModel: 0, selections: [] as unknown[] };
  const generator = new GitCommitMessageGenerator({
    currentModelProvider: {
      async readCurrentModel() {
        calls.readCurrentModel += 1;
        return options.currentModel ?? null;
      },
    },
    textGenerator: {
      async generateText(params) {
        calls.selections.push(params.selection);
        return { text: options.text ?? "fix: keep chat in sync", selection: params.selection };
      },
    },
  });
  return { generator, calls };
}

function baseParams(extra: Record<string, unknown> = {}) {
  return {
    workspacePath: "/w",
    branchName: "dev",
    files: [FILE],
    diffs: [],
    ...extra,
  };
}

test("传入会话选中模型时优先使用它，不再读全局默认（回归）", async () => {
  // 之前只读 Host 的 preferredSelection（全局默认），
  // 用户在会话里选的模型完全没被使用，模型缺失时还会直接报「未读取到当前模型」。
  const { generator, calls } = createGenerator({
    currentModel: { providerId: "p-global", modelId: "global-model" },
  });
  const result = await generator.generate(
    baseParams({ selection: { providerId: "p-session", modelId: "session-model" } }),
  );
  assert.equal(result.providerId, "p-session");
  assert.equal(result.model, "session-model");
  assert.equal(calls.readCurrentModel, 0, "有显式选择时不应再读全局默认");
  assert.deepEqual(calls.selections[0], { providerId: "p-session", modelId: "session-model" });
});

test("保留会话模型上的选项（推理等级等）", async () => {
  const { generator, calls } = createGenerator({});
  await generator.generate(
    baseParams({
      selection: {
        providerId: "p",
        modelId: "m",
        options: { reasoningLevel: "high" },
      },
    }),
  );
  assert.deepEqual(calls.selections[0], {
    providerId: "p",
    modelId: "m",
    options: { reasoningLevel: "high" },
  });
});

test("没有显式选择时回退到全局默认模型", async () => {
  const { generator, calls } = createGenerator({
    currentModel: { providerId: "p-global", modelId: "global-model" },
  });
  const result = await generator.generate(baseParams());
  assert.equal(result.model, "global-model");
  assert.equal(calls.readCurrentModel, 1);
});

test("两边都没有模型时给出 model-unavailable", async () => {
  const { generator } = createGenerator({ currentModel: null });
  await assert.rejects(
    () => generator.generate(baseParams()),
    (error: Error & { reason?: string }) => {
      assert.equal(error.reason, "model-unavailable");
      return true;
    },
  );
});

test("模型输出不是 Conventional Commit 时拒绝", async () => {
  const { generator } = createGenerator({ text: "随便写的提交说明" });
  await assert.rejects(
    () => generator.generate(baseParams({ selection: { providerId: "p", modelId: "m" } })),
    (error: Error & { reason?: string }) => {
      assert.equal(error.reason, "invalid-output");
      return true;
    },
  );
});
