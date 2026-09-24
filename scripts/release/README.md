# 发布流程 / Release Flow

推送到 `main` 会自动发布一个新版本：`prepare` 计算版本号并生成双语更新日志，随后 macOS 与 Windows
分别打包，最后把安装包挂到 GitHub Release 上。开发在 `dev` 分支进行，`main` 只接收已完成的改动。

Pushing to `main` publishes a new version: `prepare` computes the version and generates bilingual
release notes, then macOS and Windows build installers in parallel and attach them to a GitHub Release.
Development happens on `dev`; `main` only receives finished work.

```
push main ──▶ prepare（版本号 + CHANGELOG + 草稿 Release + tag）
                 ├──▶ build-macos   (macos-14,   arm64)  ──▶ 上传 .dmg/.zip
                 └──▶ build-windows (windows-latest, x64) ──▶ 上传 .exe
                                   └──▶ finalize（草稿转正式 Release）
```

任一平台失败时 Release 会停在草稿状态，方便先看产物和日志，不会对外发布半成品。
If either platform fails, the release stays a draft so the partial result can be inspected.

## 提交信息约定 / Commit Convention

版本号与更新日志都由提交信息推导，推荐 Conventional Commits：

```text
feat(desktop): support legacy project config dirs

正文可选，说明影响面与取舍。

EN: Keep reading legacy `.zcode` project config directories.
ZH: 继续识别迁移前的 `.zcode` 项目配置目录。
```

- 类型决定分组：`feat` 新功能、`fix` 问题修复、`perf` 性能、`refactor` 重构、`docs` 文档、`chore` 维护，
  其他类型归入「其它变更 / Other Changes」。
- `EN:` / `ZH:` 行是**可选**的。写了就两种语言都渲染；只写一种时原文照登，并在日志末尾说明有几条是单语，
  不会自动生成翻译。
- 版本增量：类型后带 `!` 或正文含 `BREAKING CHANGE:` → major；出现 `feat` → minor；其余 → patch。

The `EN:` / `ZH:` lines are optional. When present, both languages render; when absent the original
wording is shown verbatim and the notes state how many entries were single-language. Nothing is
machine-translated.

## 本地预演 / Local Dry Run

```bash
pnpm release:prepare:dry                 # 只打印将要发布的版本号与更新日志，不写文件
pnpm release:prepare:dry -- --version 4.0.0
pnpm release:prepare                     # 实际改写 package.json 与 CHANGELOG.md（供 CI 使用）
pnpm release:apply-version -- 4.0.0      # 仅把 package.json 版本对齐到指定值，幂等
```

手动发布（跳过自动判断）：在 GitHub Actions 里对 `Release` workflow 执行 `workflow_dispatch`，
可以指定 `bump`（patch/minor/major）或直接给 `version`。

## 需要配置的 Secrets / Variables

| 名称 | 作用 | 不配置的后果 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 内置，创建 Release、推送版本提交与 tag | 已自动提供，无需配置 |
| `APPLE_SIGNING_IDENTITY` | macOS 签名身份（配了就自动打开签名） | 产出未签名 `.dmg`/`.zip`，用户首次打开会有 Gatekeeper 提示 |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | macOS 证书（base64 .p12）与密码 | 同上 |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows Authenticode 证书与密码 | 产出未签名 `.exe`，SmartScreen 提示未知发布者 |
| `vars.ZCODE_CUA_HELPER_BUILD_ID` | Computer Use Helper 的固定构建号 | 安装包仍可用，但 Computer Use 在运行时 fail-closed |

## 产物 / Artifacts

版本号、Release 标题、安装包文件名与更新清单共用同一个版本（根 `package.json` 的 `version`）：

```
Yoyo Code-<version>-mac-arm64.dmg     Yoyo Code-<version>-win-x64.exe
Yoyo Code-<version>-mac-arm64.zip     latest.yml / latest-mac.yml / *.blockmap
```

当前 CI 只构建 **macOS arm64** 与 **Windows x64**。需要 Intel Mac 时，在 Intel runner（`macos-13`）上
加一个 `--arch x64` 的 job；跨架构在 arm64 runner 上编译会因为 `node-pty` 原生模块而不可靠，不建议。
macOS 公证（notarization）目前没有实现，`electron-builder` 配置里是 `notarize: false`。

CI currently builds macOS arm64 and Windows x64 only. Add an Intel job on `macos-13` if you need
x64 macOS; cross-compiling on an arm64 runner is unreliable because of native modules. Notarization
is not implemented yet.

## 一个容易踩的预期 / One Caveat

应用内自动更新读的是 ZCode endpoint 的更新清单（`/api/v1/releases/electron/manifest`），
**不是** GitHub Release。把安装包挂到 GitHub 只是提供一个下载渠道；要让已安装的客户端自动升级，
还需要把同一批产物发布到那份清单所指向的通道。
