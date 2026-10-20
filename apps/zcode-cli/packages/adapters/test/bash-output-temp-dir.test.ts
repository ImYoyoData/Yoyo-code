import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeExecutionAdapter } from "../src/exec/node-execution-adapter.js";

/** 只构造 Bash 合并输出的请求：outputPath 由 adapter 自己决定。 */
function bashRequest(command: string) {
  return {
    // isBashMergedOutputRequest 要求 mode=shell 且 shellProfile=posix-bash；
    // 只有这种请求才走 Bash 合并输出，也才有可观察的持久化输出路径。
    command: { mode: "shell" as const, command, shellProfile: "posix-bash" as const },
    cwd: process.cwd(),
    outputLimit: { persistOutput: "always" as const },
  };
}

/** 输出路径不暴露在 ExecutionResult 上，通过后台任务快照观察。 */
async function runAndReadOutputPath(
  adapter: NodeExecutionAdapter,
  command: string,
): Promise<string> {
  const background = await adapter.runBashWithBackgroundLifecycle(
    bashRequest(command),
    { mode: "explicit" },
    {},
  );
  if (background.kind !== "backgrounded") {
    throw new Error(`预期进入后台任务，实际: ${background.kind}`);
  }
  return background.task.outputPath ?? "";
}

/** 后台任务异步写文件，读到内容前轮询；与上游用例一样给 10s 上限。 */
async function waitForOutput(path: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const text = await readFile(path, "utf8");
      if (text.trim()) return text;
    } catch {
      /* 文件可能还没创建完成。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待输出超时: ${path}`);
}

test("Bash 输出写到系统临时目录的私有子目录（回归）", async () => {
  // 输出写在数据根里时，递归搜索数据目录会读到正在写入的文件，
  // 搜索结果又写回同一文件形成自引用。这里验证它已隔离到 tmp。
  const tempParent = await mkdtemp(join(tmpdir(), "bash-tmp-parent-"));
  const storageRoot = await mkdtemp(join(tmpdir(), "bash-storage-"));
  const adapter = new NodeExecutionAdapter({
    outputRootDir: storageRoot,
    bashOutputTempDir: tempParent,
    platform: process.platform,
  });
  try {
    const outputPath = await runAndReadOutputPath(
      adapter,
      process.platform === "win32" ? "echo hi" : "printf hi",
    );
    assert.ok(outputPath, "应当产出输出文件路径");
    assert.match(outputPath, /zcode-bash-/u, "输出必须落在私有临时目录");
    assert.ok(
      outputPath.startsWith(tempParent),
      `输出应位于注入的临时父目录下，实际: ${outputPath}`,
    );
    assert.equal((await waitForOutput(outputPath)).trim(), "hi");
  } finally {
    await adapter.close();
    await rm(tempParent, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("临时目录不可用时降级回 outputRootDir，不丢结果", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "bash-storage-"));
  const missingParent = join(storageRoot, "does-not-exist", "nested");
  const adapter = new NodeExecutionAdapter({
    outputRootDir: storageRoot,
    bashOutputTempDir: missingParent,
    platform: process.platform,
  });
  try {
    const outputPath = await runAndReadOutputPath(
      adapter,
      process.platform === "win32" ? "echo fallback" : "printf fallback",
    );
    assert.ok(outputPath, "降级后仍应产出输出文件路径");
    assert.ok(
      outputPath.startsWith(storageRoot),
      `降级后应回到 outputRootDir，实际: ${outputPath}`,
    );
    assert.equal((await waitForOutput(outputPath)).trim(), "fallback");
  } finally {
    await adapter.close();
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("未注入 bashOutputTempDir 时保持原行为", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "bash-storage-"));
  const adapter = new NodeExecutionAdapter({
    outputRootDir: storageRoot,
    platform: process.platform,
  });
  try {
    const outputPath = await runAndReadOutputPath(
      adapter,
      process.platform === "win32" ? "echo legacy" : "printf legacy",
    );
    assert.ok(outputPath.startsWith(storageRoot), `应沿用 outputRootDir，实际: ${outputPath}`);
    assert.doesNotMatch(outputPath, /zcode-bash-/u);
  } finally {
    await adapter.close();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
