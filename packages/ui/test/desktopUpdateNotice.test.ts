import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDesktopUpdateNotice } from "../src/lib/desktopUpdateNotice.js";

test("检查更新失败只映射到通用失败文案，不回显底层错误原文", () => {
  const notice = resolveDesktopUpdateNotice({
    kind: "error",
    message: "HttpError: 406 \"\" - https://api.github.com/repos/ImYoyoData/Yoyo-code/releases/latest",
  });

  assert.deepEqual(notice, { id: "update.toast.failed" });
  assert.equal(JSON.stringify(notice).includes("406"), false);
});

test("正常结果映射到对应的更新提示文案", () => {
  assert.deepEqual(resolveDesktopUpdateNotice({ kind: "up-to-date", currentVersion: "3.15.3" }), {
    id: "update.toast.upToDate",
    values: { version: "3.15.3" },
  });
  assert.deepEqual(resolveDesktopUpdateNotice({ kind: "available", version: "3.16.0" }), {
    id: "update.toast.available",
    values: { version: "3.16.0" },
  });
  assert.deepEqual(
    resolveDesktopUpdateNotice({ kind: "already-downloading", version: "3.16.0", progress: "42" }),
    { id: "update.toast.alreadyDownloading", values: { progress: "42" } },
  );
  assert.deepEqual(resolveDesktopUpdateNotice({ kind: "dev-skipped" }), {
    id: "update.toast.devSkipped",
  });
});
