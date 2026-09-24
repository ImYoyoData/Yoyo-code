#!/usr/bin/env node
/**
 * 发布准备：由 GitHub Actions 在推送 main 后调用。
 *
 * 只做本地可复现的文件改动，网络与 git 写操作交给工作流，便于本地 `--dry-run` 预演：
 *   1. 依据 Conventional Commits 计算下一个版本号（或使用 --version / --bump 指定）；
 *   2. 改写根 package.json 的 version；
 *   3. 在 CHANGELOG.md 顶部插入双语条目；
 *   4. 输出 Release 正文到 release-notes.md，并打印 GITHUB_OUTPUT 形式的键值。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  bumpVersion,
  decideBump,
  prependChangelog,
  readCommits,
  readLatestTag,
  renderChangelogEntry,
  renderBilingualNotes,
} from "./bilingual-release-notes.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");

function parseArgs(argv) {
  const options = {
    version: null,
    bump: null,
    from: null,
    notesOut: join(REPO_ROOT, "release-notes.md"),
    date: new Date().toISOString().slice(0, 10),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--version") options.version = argv[++index] ?? null;
    else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
    else if (arg === "--bump") options.bump = argv[++index] ?? null;
    else if (arg.startsWith("--bump=")) options.bump = arg.slice("--bump=".length);
    else if (arg === "--from") options.from = argv[++index] ?? null;
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (arg === "--notes-out") options.notesOut = resolve(argv[++index] ?? "");
    else if (arg.startsWith("--notes-out=")) {
      options.notesOut = resolve(arg.slice("--notes-out=".length));
    } else if (arg === "--date") options.date = argv[++index] ?? options.date;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (options.bump && !["major", "minor", "patch"].includes(options.bump)) {
    throw new Error(`--bump 只支持 major/minor/patch，收到: ${options.bump}`);
  }
  if (options.version && !/^\d+\.\d+\.\d+([-+].+)?$/.test(options.version)) {
    throw new Error(`--version 不是合法版本号: ${options.version}`);
  }
  return options;
}

function printUsage() {
  console.log(`用法: node scripts/release/prepare-release.mjs [options]

  --version <x.y.z>   指定版本号（默认按提交类型自动计算）
  --bump <kind>       强制版本增量：major | minor | patch
  --from <tag>        指定比对起点（默认取最新 v* tag）
  --notes-out <file>  Release 正文输出路径（默认 release-notes.md）
  --date <YYYY-MM-DD> 日志日期（默认今天，按 UTC）
  --dry-run           只打印结果，不写任何文件
`);
}

function readPackageVersion() {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const match = /"version"\s*:\s*"([^"]+)"/.exec(raw);
  if (!match) throw new Error("package.json 里找不到 version 字段");
  return match[1];
}

/**
 * 只改 version 这一行，避免把整份 package.json 重新序列化造成无关 diff。
 *
 * 幂等：版本号可能已经由分支上的准备提交推进过（本仓库常规流程），此时不需要改写，
 * 更不能因为"内容没变化"就报错——那会让流水线在发布提交无内容时整体失败。
 *
 * 注意：这里必须按下标拼接，不能用 `raw.replace(match[0], "$1...")` 那种写法——
 * `replace` 的首参是字符串时替换串里的 `$1` 不会被展开，会把文件写成 `$1x.y.z$3` 这类语法错误。
 */
function writePackageVersion(version) {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const match = /("version"\s*:\s*")([^"]+)(")/.exec(raw);
  if (!match) throw new Error("package.json 里找不到 version 字段");
  if (match[2] === version) {
    return false;
  }
  const next = `${raw.slice(0, match.index)}"version": "${version}"${raw.slice(
    match.index + match[0].length,
  )}`;
  // 写回前先自校验：流水线上的 package.json 一旦损坏，所有平台构建都会在装依赖时直接失败。
  JSON.parse(next);
  writeFileSync(PACKAGE_JSON_PATH, next, "utf8");
  return true;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const currentVersion = readPackageVersion();
  const previousTag = options.from ?? readLatestTag(REPO_ROOT);
  const commits = readCommits({ from: previousTag, cwd: REPO_ROOT });

  if (commits.length === 0 && !options.version) {
    console.log(`自 ${previousTag ?? "仓库起点"} 以来没有新提交，跳过发布。`);
    emitOutput({ should_release: "false" });
    return;
  }

  const bump = options.bump ?? decideBump(commits) ?? "patch";
  const version = resolveNextVersion({
    currentVersion,
    previousTag,
    requestedVersion: options.version,
    requestedBump: options.bump,
    fallbackBump: bump,
  });
  const tag = `v${version}`;
  const compareUrl = buildCompareUrl(previousTag, tag);
  const notesArgs = { version, date: options.date, commits, compareUrl };

  if (options.dryRun) {
    console.log(`[dry-run] ${currentVersion} -> ${version}（${bump}），来自 ${commits.length} 条提交`);
    console.log(renderBilingualNotes(notesArgs));
    return;
  }

  const versionRewritten = writePackageVersion(version);
  const existingChangelog = existsSync(CHANGELOG_PATH)
    ? readFileSync(CHANGELOG_PATH, "utf8")
    : "";
  writeFileSync(
    CHANGELOG_PATH,
    prependChangelog(existingChangelog, renderChangelogEntry(notesArgs), version),
    "utf8",
  );
  writeFileSync(options.notesOut, renderBilingualNotes(notesArgs), "utf8");

  console.log(
    versionRewritten
      ? `版本 ${currentVersion} -> ${version}（依据提交推断: ${bump}）`
      : `版本已是 ${version}（分支上已推进），本次只更新更新日志`,
  );
  console.log(`Release 正文: ${options.notesOut}`);
  console.log(`CHANGELOG.md 已更新，本次包含 ${commits.length} 条提交。`);
  emitOutput({
    should_release: "true",
    version,
    tag,
    previous_tag: previousTag ?? "",
    notes_file: options.notesOut,
  });
}

/**
 * 决定本次发布的版本号。
 *
 * 版本号可能已经在 dev 上手工推进过（例如把发布链路和新功能一起提上去）。这时直接用当前版本发布，
 * 而不是在它之上再跳一版——否则 CHANGELOG 里写的版本和流水线实际发布的版本会对不上。
 */
function resolveNextVersion({
  currentVersion,
  previousTag,
  requestedVersion,
  requestedBump,
  fallbackBump,
}) {
  if (requestedVersion) return requestedVersion;
  if (requestedBump) return bumpVersion(currentVersion, requestedBump);
  const taggedVersion = previousTag ? previousTag.replace(/^v/u, "") : null;
  if (taggedVersion && compareVersions(currentVersion, taggedVersion) > 0) {
    return currentVersion;
  }
  // 流水线不回写 package.json，所以仓库里的版本可能落后于已发布的 tag。
  // 直接在当前版本之上跳一版会算出已经存在的 tag（例如 package.json 3.15.2 + tag v3.15.3 → 又得到 3.15.3），
  // 建 release 时必然失败。这里以两者较高的版本为基数递增。
  const baseVersion =
    taggedVersion && compareVersions(taggedVersion, currentVersion) > 0
      ? taggedVersion
      : currentVersion;
  return bumpVersion(baseVersion, fallbackBump);
}

/** 数字段比较；只用于判断“当前版本是否已经领先于最近 tag”。 */
function compareVersions(left, right) {
  const toParts = (value) => String(value).split(/[.+-]/u).map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = toParts(left);
  const rightParts = toParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function buildCompareUrl(previousTag, tag) {
  const remote = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!remote || !repo) return null;
  return previousTag
    ? `${remote}/${repo}/compare/${previousTag}...${tag}`
    : `${remote}/${repo}/releases/tag/${tag}`;
}

/** 同时写 stdout 与 GITHUB_OUTPUT，方便本地直接看结果。 */
function emitOutput(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
  }
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const body = Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    writeFileSync(outputFile, `${body}\n`, { flag: "a" });
  }
}

main();
