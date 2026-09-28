import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNewBlockMapUrl,
  resolveOldBlockMapUrl,
} from "../src/main/differentialBlockMapUrl.js";

const OWNER_REPO = "https://github.com/ImYoyoData/Yoyo-code";

test("旧 blockmap 要指向旧 Release，而不是新 tag 目录下的旧文件名（回归）", () => {
  // 上游只换文件名，实际请求 `v3.15.5/...3.15.4....blockmap`，线上返回 404，差分必然退回整包。
  const baseUrl = new URL(
    `${OWNER_REPO}/releases/download/v3.15.5/Yoyo-Code-3.15.5-win-x64.exe`,
  );
  const old = resolveOldBlockMapUrl(baseUrl, "3.15.4", "3.15.5");
  assert.equal(
    old?.href,
    `${OWNER_REPO}/releases/download/v3.15.4/Yoyo-Code-3.15.4-win-x64.exe.blockmap`,
  );
});

test("macOS 的 zip blockmap 同样指向旧 Release", () => {
  const baseUrl = new URL(
    `${OWNER_REPO}/releases/download/v3.15.5/Yoyo-Code-3.15.5-mac-arm64.zip`,
  );
  assert.equal(
    resolveOldBlockMapUrl(baseUrl, "3.15.4", "3.15.5")?.href,
    `${OWNER_REPO}/releases/download/v3.15.4/Yoyo-Code-3.15.4-mac-arm64.zip.blockmap`,
  );
});

test("跨多个版本时也成立", () => {
  const baseUrl = new URL(`${OWNER_REPO}/releases/download/v4.0.0/Yoyo-Code-4.0.0-win-x64.exe`);
  assert.equal(
    resolveOldBlockMapUrl(baseUrl, "3.9.1", "4.0.0")?.href,
    `${OWNER_REPO}/releases/download/v3.9.1/Yoyo-Code-3.9.1-win-x64.exe.blockmap`,
  );
});

test("新 blockmap 地址保持在新 Release", () => {
  const baseUrl = new URL(
    `${OWNER_REPO}/releases/download/v3.15.5/Yoyo-Code-3.15.5-win-x64.exe`,
  );
  assert.equal(
    resolveNewBlockMapUrl(baseUrl).href,
    `${OWNER_REPO}/releases/download/v3.15.5/Yoyo-Code-3.15.5-win-x64.exe.blockmap`,
  );
});

test("tag 不含版本号时不猜测，返回 null 交给上游", () => {
  // 固定 tag（如 stable）推不出旧版本目录，硬拼会得到一个看似合理但必然 404 的地址。
  const baseUrl = new URL(`${OWNER_REPO}/releases/download/stable/Yoyo-Code-win-x64.exe`);
  assert.equal(resolveOldBlockMapUrl(baseUrl, "3.15.4", "3.15.5"), null);
});

test("不是 Release 下载路径时返回 null", () => {
  assert.equal(
    resolveOldBlockMapUrl(new URL("https://mirror.example.com/models/app.exe"), "3.15.4", "3.15.5"),
    null,
  );
});

test("版本号里的点按字面量替换，不会误伤相似文件名", () => {
  const baseUrl = new URL(
    `${OWNER_REPO}/releases/download/v4.0.0/Yoyo-Code-4.0.0-win-x64.exe`,
  );
  assert.equal(
    resolveOldBlockMapUrl(baseUrl, "3.9.1", "4.0.0")?.href,
    `${OWNER_REPO}/releases/download/v3.9.1/Yoyo-Code-3.9.1-win-x64.exe.blockmap`,
  );
  // 若把 `4.0.0` 直接当正则，`.` 会匹配任意字符，文件名里的 `4x0x0` 会被误改成 `3x9x1`。
  const decoy = new URL(
    `${OWNER_REPO}/releases/download/v4.0.0/Yoyo-Code-x4x0x0-win-x64.exe`,
  );
  assert.equal(
    resolveOldBlockMapUrl(decoy, "3.9.1", "4.0.0")?.href,
    `${OWNER_REPO}/releases/download/v3.9.1/Yoyo-Code-x4x0x0-win-x64.exe.blockmap`,
  );
});
