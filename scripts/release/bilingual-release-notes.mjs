/**
 * 双语发布日志生成。
 *
 * 提交信息约定（可选，缺省时按原文语言显示，不伪造翻译）：
 *
 *   feat(desktop): support legacy project config dirs
 *
 *   正文说明……
 *
 *   EN: Keep reading legacy `.zcode` project config directories.
 *   ZH: 继续识别迁移前的 `.zcode` 项目配置目录。
 *
 * 同一语言可写多行，每行渲染成一条列表项。类型后的 `!` 或正文里的 `BREAKING CHANGE:`
 * 决定版本号是否走 major。
 */
import { execFileSync } from "node:child_process";

const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u0000";

/** Release 与 CHANGELOG 共用的分组；数组顺序即渲染顺序。 */
const RELEASE_SECTIONS = [
  { id: "feat", zh: "新功能", en: "Features" },
  { id: "fix", zh: "问题修复", en: "Fixes" },
  { id: "perf", zh: "性能", en: "Performance" },
  { id: "refactor", zh: "重构", en: "Refactors" },
  { id: "docs", zh: "文档", en: "Documentation" },
  { id: "chore", zh: "维护", en: "Maintenance" },
  { id: "other", zh: "其它变更", en: "Other Changes" },
];

const KNOWN_TYPES = new Set(RELEASE_SECTIONS.map((section) => section.id));
const CJK_PATTERN = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const I18N_LINE_PATTERN = /^\s*(EN|ZH|英文|中文)\s*[:：]\s*(.*)$/i;
const SUBJECT_PATTERN =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<subject>.+)$/;

/** 读取提交区间；NUL/RS 分隔，避免正文换行破坏解析。 */
export function readCommits({ from, to = "HEAD", cwd = process.cwd() } = {}) {
  const range = from ? `${from}..${to}` : to;
  const format = ["%H", "%h", "%s", "%b", "%an", "%aI"].join("%x00") + "%x1e";
  const raw = runGit(["log", range, `--format=${format}`, "--no-merges"], cwd);
  return raw
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, "").trimEnd())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, subject, body, author, authoredAt] = record.split(FIELD_SEPARATOR);
      return {
        hash,
        shortHash,
        subject: (subject ?? "").trim(),
        body: (body ?? "").trim(),
        author: (author ?? "").trim(),
        authoredAt: (authoredAt ?? "").trim(),
      };
    });
}

/** 最新版本 tag；没有则返回 null（首个版本按全量历史生成）。 */
export function readLatestTag(cwd = process.cwd()) {
  const tags = runGit(["tag", "--list", "v*", "--sort=-v:refname"], cwd)
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags[0] ?? null;
}

/** 按 Conventional Commits 推断版本增量；没有提交时返回 null。 */
export function decideBump(commits) {
  let bump = null;
  for (const commit of commits) {
    const parsed = parseCommit(commit);
    if (parsed.breaking) {
      return "major";
    }
    bump = parsed.section === "feat" ? "minor" : (bump ?? "patch");
  }
  return bump;
}

export function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!match) {
    throw new Error(`无法解析当前版本号: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`未知的版本增量: ${kind}`);
}

/** 拆出分组、破坏性标记与中英两条文案。 */
function parseCommit(commit) {
  const match = SUBJECT_PATTERN.exec(commit.subject);
  const rawType = match?.groups?.type?.toLowerCase();
  const section = rawType && KNOWN_TYPES.has(rawType) ? rawType : "other";
  const breaking =
    Boolean(match?.groups?.breaking) || /BREAKING[ -]CHANGE:/i.test(commit.body ?? "");
  const scope = match?.groups?.scope?.trim() || "";
  const subject = (match?.groups?.subject ?? commit.subject).trim();
  const fromBody = extractI18nLines(commit.body ?? "");

  // 正文显式标注优先；否则把主题归到它本身的语种，另一种语言交给渲染层回退。
  const subjectIsChinese = CJK_PATTERN.test(subject);
  const zh = fromBody.zh.length > 0 ? fromBody.zh : subjectIsChinese ? [subject] : [];
  const en = fromBody.en.length > 0 ? fromBody.en : subjectIsChinese ? [] : [subject];

  return { section, breaking, scope, shortHash: commit.shortHash, zh, en };
}

function extractI18nLines(body) {
  const zh = [];
  const en = [];
  for (const line of body.split("\n")) {
    const match = I18N_LINE_PATTERN.exec(line);
    if (!match) continue;
    const text = match[2].trim().replace(/^[-*]\s*/, "");
    if (!text) continue;
    (match[1].toLowerCase() === "en" || match[1] === "英文" ? en : zh).push(text);
  }
  return { zh, en };
}

/**
 * 渲染 Release 正文：先中文段、再 English 段。
 * `compareUrl` 由调用方给出，没有可比对区间时省略。
 */
export function renderBilingualNotes({ version, date, commits, compareUrl }) {
  const parsed = commits.map(parseCommit);
  const lines = [
    `## 中文`,
    "",
    `版本 **v${version}**（${date}）`,
    "",
    ...renderLanguageSections(parsed, "zh"),
    "",
    "## English",
    "",
    `Release **v${version}** (${date})`,
    "",
    ...renderLanguageSections(parsed, "en"),
  ];

  const singleLanguage = parsed.filter(
    (commit) => commit.en.length === 0 || commit.zh.length === 0,
  ).length;
  if (singleLanguage > 0) {
    lines.push(
      "",
      "---",
      "",
      `${singleLanguage} 条提交只写了单一语言，因此只显示原文。在提交信息正文里加 \`EN:\` / \`ZH:\` 行即可同时生成两种语言。`,
      "",
      `${singleLanguage} commit(s) were single-language and are shown as-written. Add \`EN:\` / \`ZH:\` lines to the commit body to render both languages.`,
    );
  }
  if (compareUrl) {
    lines.push("", "---", "", `提交对照 / Full diff: ${compareUrl}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderLanguageSections(commits, language) {
  const lines = [];
  for (const section of RELEASE_SECTIONS) {
    const entries = commits.filter((commit) => commit.section === section.id);
    if (entries.length === 0) continue;
    lines.push(`### ${language === "zh" ? section.zh : section.en}`, "");
    for (const entry of entries) {
      const primary = language === "zh" ? entry.zh : entry.en;
      const secondary = language === "zh" ? entry.en : entry.zh;
      const shown = primary.length > 0 ? primary : secondary;
      const [first, ...rest] = shown;
      lines.push(`- ${entry.breaking ? "**BREAKING** " : ""}${first}`);
      for (const line of rest) lines.push(`  - ${line}`);
      if (primary.length > 0 && secondary.length > 0) {
        lines.push(`  - ${language === "zh" ? "_EN:_" : "_中文：_"}`);
        for (const line of secondary) lines.push(`    - ${line}`);
      }
    }
    lines.push("");
  }
  if (lines.length === 0) {
    lines.push("本次没有可列出的变更。/ No user-visible changes listed.", "");
  }
  return lines;
}

const CHANGELOG_HEADER = `# 更新日志 / Changelog

本文件由 \`scripts/release/prepare-release.mjs\` 自动维护：每次发布在标题下方插入一条双语条目。
This file is maintained by the release workflow; each release prepends a bilingual entry.

`;

/** CHANGELOG 条目与 Release 正文同源，避免两处各说一套。 */
export function renderChangelogEntry({ version, date, commits, compareUrl }) {
  const notes = renderBilingualNotes({ version, date, commits, compareUrl });
  return `## v${version} — ${date}\n\n${notes}\n`;
}

export function prependChangelog(existing, entry) {
  const trimmed = String(existing ?? "").trim();
  if (!trimmed) {
    return `${CHANGELOG_HEADER}${entry}`;
  }
  const lines = trimmed.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("# "));
  if (headingIndex === -1) {
    return `${CHANGELOG_HEADER}${entry}${trimmed}\n`;
  }
  // 保留原有标题与说明段，把新条目插在第一个版本标题之前。
  const firstEntryIndex = lines.findIndex(
    (line, index) => index > headingIndex && line.startsWith("## "),
  );
  if (firstEntryIndex === -1) {
    return `${trimmed}\n\n${entry}`;
  }
  const head = lines.slice(0, firstEntryIndex).join("\n").trimEnd();
  const rest = lines.slice(firstEntryIndex).join("\n").trimEnd();
  return `${head}\n\n${entry}${rest}\n`;
}

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
