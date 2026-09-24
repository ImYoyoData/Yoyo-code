import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPendingUpdate } from "../src/updateStatusModel.js";

test("发现新版本、下载中、已下载都算有待处理更新（红点与更新入口的判定依据）", () => {
  assert.equal(
    hasPendingUpdate({
      legacyReadyVersion: null,
      updateState: { kind: "update-available", enabled: true, version: "3.16.0" },
    }),
    true,
  );
  assert.equal(
    hasPendingUpdate({
      legacyReadyVersion: null,
      updateState: { kind: "download-progress", enabled: true, progress: "30" },
    }),
    true,
  );
  assert.equal(
    hasPendingUpdate({
      legacyReadyVersion: null,
      updateState: { kind: "update-downloaded", enabled: true, version: "3.16.0" },
    }),
    true,
  );
});

test("空闲、检查中、被禁用的更新都不显示红点", () => {
  assert.equal(
    hasPendingUpdate({ legacyReadyVersion: null, updateState: { kind: "idle", enabled: true } }),
    false,
  );
  assert.equal(
    hasPendingUpdate({
      legacyReadyVersion: null,
      updateState: { kind: "checking", enabled: true },
    }),
    false,
  );
  assert.equal(hasPendingUpdate({ legacyReadyVersion: null, updateState: null }), false);
});

test("旧事件通道上报的 ready 版本只在没有新状态通道时算待处理", () => {
  // legacy UpdateReady 只是"曾经 ready"的缓存，UpdateState 一旦同步过就以它为准。
  assert.equal(
    hasPendingUpdate({ legacyReadyVersion: "3.15.4", updateState: null }),
    true,
  );
  assert.equal(
    hasPendingUpdate({ legacyReadyVersion: "3.15.4", updateState: { kind: "idle", enabled: true } }),
    false,
  );
});
