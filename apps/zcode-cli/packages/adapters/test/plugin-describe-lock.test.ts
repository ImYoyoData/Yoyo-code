import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { describeMarketplacePlugin } from "../src/plugins/marketplace.js";

async function makeStorageRoot(marketplace: string, withManifest: boolean) {
  const storageRoot = await mkdtemp(join(tmpdir(), "plugin-describe-"));
  if (withManifest) {
    const directory = join(storageRoot, "marketplaces", marketplace);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "marketplace.json"),
      JSON.stringify({
        name: "test-marketplace",
        owner: { name: "tester" },
        plugins: [
          {
            name: "demo",
            source: "./demo",
            description: "demo plugin",
          },
        ],
      }),
      "utf8",
    );
  }
  return storageRoot;
}

test("manifest 已缓存时 describe 不取写锁（回归）", async () => {
  // 之前 describe 整体持 storage lock，安装下载期间打开详情会一直转圈；
  // 只读路径不该进锁。
  const storageRoot = await makeStorageRoot("test-market", true);
  let lockCalls = 0;
  try {
    const result = await describeMarketplacePlugin({
      marketplace: "test-market",
      name: "demo",
      storageRoot,
      withWriteLock: async (write) => {
        lockCalls += 1;
        return write();
      },
    });
    assert.equal(lockCalls, 0, "已缓存 manifest 不应触发写锁");
    // 这里只关心锁的范围；source 解析结果由其它用例覆盖。
    assert.ok(Array.isArray(result.diagnostics));
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("manifest 缺失时才取写锁", async () => {
  const storageRoot = await makeStorageRoot("test-market", false);
  let lockCalls = 0;
  try {
    await describeMarketplacePlugin({
      marketplace: "test-market",
      name: "demo",
      storageRoot,
      withWriteLock: async (write) => {
        lockCalls += 1;
        return write();
      },
    });
    assert.equal(lockCalls, 1, "懒加载 manifest 必须进锁一次");
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("未注入 withWriteLock 时保持原行为", async () => {
  const storageRoot = await makeStorageRoot("test-market", false);
  try {
    // 默认实现是直通；只要求不抛错且能走完懒加载分支。
    const result = await describeMarketplacePlugin({
      marketplace: "test-market",
      name: "demo",
      storageRoot,
    });
    assert.ok(Array.isArray(result.diagnostics));
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
