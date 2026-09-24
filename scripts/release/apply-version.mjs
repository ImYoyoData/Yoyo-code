#!/usr/bin/env node
/**
 * 把根 package.json 的 version 对齐到指定版本。
 *
 * 各平台构建任务各自 check out 发布 tag 后调用它做一次幂等校验：
 * 打包产物里的 appVersion 来自根 package.json，这里保证「Release 标题 / 安装包版本 / 更新清单」
 * 三者不会因为构建机上残留的版本号而分叉。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");

const requested = (process.argv[2] ?? "").trim().replace(/^v/, "");
if (!requested) {
  console.error("用法: node scripts/release/apply-version.mjs <x.y.z>");
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(requested)) {
  console.error(`版本号不合法: ${requested}`);
  process.exit(1);
}

const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
const match = /"version"\s*:\s*"([^"]+)"/.exec(raw);
if (!match) {
  console.error("package.json 里找不到 version 字段");
  process.exit(1);
}
if (match[1] === requested) {
  console.log(`版本已是 ${requested}，无需修改。`);
  process.exit(0);
}

writeFileSync(PACKAGE_JSON_PATH, raw.replace(match[0], `"version": "${requested}"`), "utf8");
console.log(`版本 ${match[1]} -> ${requested}`);
