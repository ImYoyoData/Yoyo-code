import assert from "node:assert/strict";
import test from "node:test";
import { clampTerminalSize } from "../src/terminal/terminalService.js";

test("正常尺寸原样透传", () => {
  assert.deepEqual(clampTerminalSize({ cols: 120, rows: 30 }), { cols: 120, rows: 30 });
});

test("过小的尺寸被抬到可用下限（回归）", () => {
  // PowerShell 7.6 在控制台过窄时启动即崩（UpdatesNotification 的 PadRight 收到负数）；
  // 0/个位数这类病态几何绝不能交给 shell。
  assert.deepEqual(clampTerminalSize({ cols: 0, rows: 0 }), { cols: 20, rows: 3 });
  assert.deepEqual(clampTerminalSize({ cols: 1, rows: 1 }), { cols: 20, rows: 3 });
  assert.deepEqual(clampTerminalSize({ cols: 2, rows: 12 }), { cols: 20, rows: 12 });
});

test("小数向下取整", () => {
  assert.deepEqual(clampTerminalSize({ cols: 80.9, rows: 24.7 }), { cols: 80, rows: 24 });
});

test("非法数值回落到下限", () => {
  assert.deepEqual(clampTerminalSize({ cols: Number.NaN, rows: Number.POSITIVE_INFINITY }), {
    cols: 20,
    rows: 3,
  });
});
