import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const DESKTOP_ROOT = fileURLToPath(new URL("..", import.meta.url));
/**
 * main / host / scheduler 以 ESM 产出，tsup 会把外部依赖原样留成 import。
 * Node 的 ESM 解析器不补扩展名，第三方包的深路径子模块省略 `.js` 会在
 * 安装包启动时直接 ERR_MODULE_NOT_FOUND（dev 态被 tsx 兜住，打包后崩）。
 * preload 是 CJS，不受此限，故不在扫描范围。
 */
const ESM_SOURCE_DIRS = ["src/main", "src/host", "src/scheduler"];
// 工作区包都在 tsup 的 noExternal 里被打包，specifier 不会留在产物中，无需扩展名。
const WORKSPACE_SCOPE = "@zcode/";
const SPECIFIER_PATTERN = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
const EXPLICIT_EXTENSION = /\.(?:js|mjs|cjs|json|node)$/;

/** 把 specifier 拆成包名与其后的子路径；子路径非空即为深路径导入。 */
function splitPackageSpecifier(specifier: string): { subpath: string } {
  const segments = specifier.split("/");
  const packageSegments = specifier.startsWith("@") ? 2 : 1;
  return { subpath: segments.slice(packageSegments).join("/") };
}

function isExternalDeepImport(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("@/")) return false;
  if (specifier.startsWith("node:") || specifier.startsWith("#")) return false;
  if (specifier.startsWith(WORKSPACE_SCOPE)) return false;
  return splitPackageSpecifier(specifier).subpath.length > 0;
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("外部依赖的深路径导入必须带显式扩展名（回归）", () => {
  // 3.15.6 就是在这里崩的：import ... from "electron-updater/out/providers/GitHubProvider"
  // 少了 .js，typecheck 与 lint 都通过，打出来的包启动即崩。
  const offenders: string[] = [];
  for (const directory of ESM_SOURCE_DIRS) {
    for (const file of collectSourceFiles(join(DESKTOP_ROOT, directory))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(SPECIFIER_PATTERN)) {
        const specifier = match[1];
        if (isExternalDeepImport(specifier) && !EXPLICIT_EXTENSION.test(specifier)) {
          offenders.push(`${file.slice(DESKTOP_ROOT.length)} -> ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `以下深路径导入缺少扩展名，打包后会 ERR_MODULE_NOT_FOUND：\n${offenders.join("\n")}`);
});

test("规则本身能识别出无扩展名的深路径导入", () => {
  // 防止规则写坏变成永远通过的空断言。
  assert.equal(isExternalDeepImport("electron-updater/out/providers/GitHubProvider"), true);
  assert.equal(isExternalDeepImport("electron-updater/out/providers/GitHubProvider.js"), true);
  // scoped 包名本身不是深路径；工作区包与相对路径都不在范围内。
  assert.equal(isExternalDeepImport("@arms/rum-electron"), false);
  assert.equal(isExternalDeepImport("@zcode/shared/zcode-protocol-v4"), false);
  assert.equal(isExternalDeepImport("electron-updater"), false);
  assert.equal(isExternalDeepImport("./differentialBlockMapUrl.js"), false);
});
