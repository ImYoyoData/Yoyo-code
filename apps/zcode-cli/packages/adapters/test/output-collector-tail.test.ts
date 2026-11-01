/**
 * 请求级尾部（`ExecutionOutputLimit.tailBytes` → `ExecutionStreamResult.tail`）回归。
 *
 * 钉住三件事：尾部与 inline 截断互不影响；进程照常读到退出、不因 inline 截断失败；
 * 没请求就不出现 `tail` 字段（老调用方的结果形状不变）。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NodeExecutionAdapter } from "../src/exec/node-execution-adapter.js";
import { OutputCollector } from "../src/exec/output-collector.js";

function collector(options: { maxInlineBytes: number; requestedTailBytes?: number }) {
  return new OutputCollector({
    maxInlineBytes: options.maxInlineBytes,
    maxPersistedBytes: 0,
    legacyOutputEncoding: null,
    maxTailBytes: 0,
    persistOutput: "none",
    requestedTailBytes: options.requestedTailBytes,
  });
}

describe("OutputCollector — requested tail", () => {
  it("跨多块保留最后 n 字节，且不受 inline 上限影响", () => {
    const out = collector({ maxInlineBytes: 0, requestedTailBytes: 5 });
    for (const piece of ["abc", "defg", "", "hijklmnop", "q"]) out.append(Buffer.from(piece));
    const result = out.result();
    assert.equal(result.text, "");
    assert.equal(result.bytes, 17);
    assert.equal(result.truncated, true);
    assert.equal(result.tail, "mnopq");
  });

  it("总输出短于 n 时返回全部内容", () => {
    const out = collector({ maxInlineBytes: 0, requestedTailBytes: 64 });
    out.append(Buffer.from("short"));
    assert.equal(out.result().tail, "short");
  });

  it("单块超过 n 时按字节切尾", () => {
    const out = collector({ maxInlineBytes: 0, requestedTailBytes: 3 });
    out.append(Buffer.from("0123456789"));
    assert.equal(out.result().tail, "789");
  });

  it("空流在请求尾部时返回空字符串", () => {
    assert.equal(collector({ maxInlineBytes: 0, requestedTailBytes: 8 }).result().tail, "");
  });

  it("未请求时不出现 tail 字段，结果形状不变", () => {
    const out = collector({ maxInlineBytes: 16 });
    out.append(Buffer.from("hello"));
    assert.equal(Object.hasOwn(out.result(), "tail"), false);
  });
});

describe("NodeExecutionAdapter — requested tail", () => {
  it("大输出进程跑完退出，inline 为空但每路都拿到尾部", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-exec-tail-"));
    const adapter = new NodeExecutionAdapter({ outputRootDir: root });
    try {
      const script = [
        "process.stdout.write('x'.repeat(1024 * 1024) + 'OUT-END');",
        "process.stderr.write('y'.repeat(1024 * 1024) + 'ERR-END');",
        "process.exitCode = 3;",
      ].join("");
      const result = await adapter.run({
        command: { mode: "argv", file: process.execPath, args: ["-e", script] },
        outputLimit: { maxInlineBytes: 0, tailBytes: 7 },
      });
      assert.equal(result.status, "failed");
      assert.equal(result.error, undefined);
      assert.equal(result.exitCode, 3);
      assert.equal(result.stdout.text, "");
      assert.equal(result.stdout.truncated, true);
      assert.equal(result.stdout.tail, "OUT-END");
      assert.equal(result.stdout.bytes, 1024 * 1024 + 7);
      assert.equal(result.stderr.tail, "ERR-END");
    } finally {
      await adapter.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
