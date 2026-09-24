# 更新日志 / Changelog

本文件由 `scripts/release/prepare-release.mjs` 自动维护：每次发布在标题下方插入一条双语条目。
This file is maintained by the release workflow; each release prepends a bilingual entry.

## v3.15.3 — 2026-09-24

## 中文

版本 **v3.15.3**（2026-09-24）

### 其它变更

- finalize 作业没有 checkout，gh 无法推断仓库而秒失败。现在显式传仓库，并把「转正式」与「标记 latest」拆成两步（草稿状态下设 latest 会被拒绝），同时把发布后的 Release 状态写进作业摘要。
  - _EN:_
    - The finalize job has no checkout, so gh could not infer the repository and failed immediately. Pass the repository explicitly, split "un-draft" and "mark latest" into two calls (setting latest while still a draft is rejected), and print the resulting release state into the job summary.


## English

Release **v3.15.3** (2026-09-24)

### Other Changes

- The finalize job has no checkout, so gh could not infer the repository and failed immediately. Pass the repository explicitly, split "un-draft" and "mark latest" into two calls (setting latest while still a draft is rejected), and print the resulting release state into the job summary.
  - _中文：_
    - finalize 作业没有 checkout，gh 无法推断仓库而秒失败。现在显式传仓库，并把「转正式」与「标记 latest」拆成两步（草稿状态下设 latest 会被拒绝），同时把发布后的 Release 状态写进作业摘要。


---

提交对照 / Full diff: https://github.com/ImYoyoData/Yoyo-code/compare/v3.15.2...v3.15.3

## v3.15.2 — 2026-09-24

## 中文

版本 **v3.15.2**（2026-09-24）

### 问题修复

- 给 electron-builder 传 --publish never。其默认策略是 onTagOrDraft，CI 里已存在同名草稿 Release 时它会在打包阶段自行上传并要求 GH_TOKEN，缺 token 直接导致两个平台构建失败。发布资产由工作流用 gh 上传；签名改为「证书与身份都配置齐全才启用」，并在各构建作业摘要里记录签名配置状态。
  - _EN:_
    - Pass --publish never to electron-builder. Its default policy is onTagOrDraft, so in CI an existing draft release for the same version made it try to upload during packaging and fail on a missing GH_TOKEN — which broke both platform builds. Release assets are uploaded by the workflow via gh; signing is now enabled only when a certificate is also configured, and each build job records the signing configuration state in its summary.


## English

Release **v3.15.2** (2026-09-24)

### Fixes

- Pass --publish never to electron-builder. Its default policy is onTagOrDraft, so in CI an existing draft release for the same version made it try to upload during packaging and fail on a missing GH_TOKEN — which broke both platform builds. Release assets are uploaded by the workflow via gh; signing is now enabled only when a certificate is also configured, and each build job records the signing configuration state in its summary.
  - _中文：_
    - 给 electron-builder 传 --publish never。其默认策略是 onTagOrDraft，CI 里已存在同名草稿 Release 时它会在打包阶段自行上传并要求 GH_TOKEN，缺 token 直接导致两个平台构建失败。发布资产由工作流用 gh 上传；签名改为「证书与身份都配置齐全才启用」，并在各构建作业摘要里记录签名配置状态。


---

提交对照 / Full diff: https://github.com/ImYoyoData/Yoyo-code/compare/v3.15.1...v3.15.2

## v3.15.1 — 2026-09-24

## 中文

版本 **v3.15.1**（2026-09-24）

### 问题修复

- 恢复被发布提交写坏的 version 行（原内容为 $13.15.1$3，导致所有平台构建在装依赖阶段失败）。
  - _EN:_
    - Restore the version field that the release commit mangled into "$13.15.1$3".
- 版本号写回改为按下标拼接。String.replace 的首参是字符串时不会展开 $1/$3，之前把 package.json 写成了 "$13.15.1$3"，导致所有平台在装依赖时直接失败；写回前现在会先校验 JSON 合法性。
  - _EN:_
    - Rewrite the version field by slicing on match indices instead of String.replace with a string pattern — that form does not expand $1/$3, which wrote "$13.15.1$3" into package.json and broke every platform build at dependency install. The rewritten file is now JSON-validated before being written.
- 产物名不再带空格。electron-builder 会把 latest*.yml 里的下载 url 规范成连字符形式，之前「Yoyo Code-*.exe」与清单对不上，客户端更新会 404。现在文件名、更新清单与 Release 资产三者一致。
  - _EN:_
    - Build artifact names no longer contain spaces. electron-builder writes the download url in latest*.yml with spaces normalized to hyphens, so the previous "Yoyo Code-*.exe" files never matched the manifest and the in-app updater would 404. File name, update manifest and release asset now agree.
- 从 github publish 配置里移除 useMultipleRangeRequest——该字段只对 generic provider 合法，写在 github 下会让 electron-builder 配置校验失败并中断两个平台的打包。差分下载不受影响：electron-updater 的 GitHubProvider 内部已固定 isUseMultipleRangeRequest=false。
  - _EN:_
    - Drop useMultipleRangeRequest from the github publish config — that field is only valid for the generic provider and made electron-builder reject the config, which broke both platform builds. Differential download is unaffected because electron-updater's GitHubProvider already pins isUseMultipleRangeRequest=false.
- 版本改写改为幂等（分支上已准备好的版本号即为发布版本），草稿 Release 创建也改为幂等，失败重跑可继续。
  - _EN:_
    - Make the version rewrite idempotent (a prepared version on the branch is already the release version) and make draft-release creation idempotent so a re-run after a failure can continue.

### 维护

- release v3.15.1


## English

Release **v3.15.1** (2026-09-24)

### Fixes

- Restore the version field that the release commit mangled into "$13.15.1$3".
  - _中文：_
    - 恢复被发布提交写坏的 version 行（原内容为 $13.15.1$3，导致所有平台构建在装依赖阶段失败）。
- Rewrite the version field by slicing on match indices instead of String.replace with a string pattern — that form does not expand $1/$3, which wrote "$13.15.1$3" into package.json and broke every platform build at dependency install. The rewritten file is now JSON-validated before being written.
  - _中文：_
    - 版本号写回改为按下标拼接。String.replace 的首参是字符串时不会展开 $1/$3，之前把 package.json 写成了 "$13.15.1$3"，导致所有平台在装依赖时直接失败；写回前现在会先校验 JSON 合法性。
- Build artifact names no longer contain spaces. electron-builder writes the download url in latest*.yml with spaces normalized to hyphens, so the previous "Yoyo Code-*.exe" files never matched the manifest and the in-app updater would 404. File name, update manifest and release asset now agree.
  - _中文：_
    - 产物名不再带空格。electron-builder 会把 latest*.yml 里的下载 url 规范成连字符形式，之前「Yoyo Code-*.exe」与清单对不上，客户端更新会 404。现在文件名、更新清单与 Release 资产三者一致。
- Drop useMultipleRangeRequest from the github publish config — that field is only valid for the generic provider and made electron-builder reject the config, which broke both platform builds. Differential download is unaffected because electron-updater's GitHubProvider already pins isUseMultipleRangeRequest=false.
  - _中文：_
    - 从 github publish 配置里移除 useMultipleRangeRequest——该字段只对 generic provider 合法，写在 github 下会让 electron-builder 配置校验失败并中断两个平台的打包。差分下载不受影响：electron-updater 的 GitHubProvider 内部已固定 isUseMultipleRangeRequest=false。
- Make the version rewrite idempotent (a prepared version on the branch is already the release version) and make draft-release creation idempotent so a re-run after a failure can continue.
  - _中文：_
    - 版本改写改为幂等（分支上已准备好的版本号即为发布版本），草稿 Release 创建也改为幂等，失败重跑可继续。

### Maintenance

- release v3.15.1


---

1 条提交只写了单一语言，因此只显示原文。在提交信息正文里加 `EN:` / `ZH:` 行即可同时生成两种语言。

1 commit(s) were single-language and are shown as-written. Add `EN:` / `ZH:` lines to the commit body to render both languages.

---

提交对照 / Full diff: https://github.com/ImYoyoData/Yoyo-code/compare/v3.15.0...v3.15.1

## v3.15.0 — 2026-09-24

## 中文

版本 **v3.15.0**（2026-09-24）

### 新功能

- 更新检查与下载改为读取 GitHub Release（保留 blockmap 差分下载）；「关于」补充作者 Yoyo 与「基于 ZCode 二次开发」说明。
  - _EN:_
    - Update checks and downloads now read the project's GitHub Releases (blockmap-based differential download kept); the About window credits author Yoyo and states this is a secondary development based on ZCode.

### 问题修复

- 版本改写改为幂等（分支上已准备好的版本号即为发布版本），草稿 Release 创建也改为幂等，失败重跑可继续。
  - _EN:_
    - Make the version rewrite idempotent (a prepared version on the branch is already the release version) and make draft-release creation idempotent so a re-run after a failure can continue.
- 依赖 node 内置模块的共享模块不再进 barrel（否则 preload 加载失败、界面卡在启动遮罩）；模型设置页默认选中第一个已配置的供应商。
  - _EN:_
    - Keep node-dependent shared modules out of the barrel export (it broke the sandboxed preload and the renderer) and always default the model settings page to the first configured provider.

### 维护

- 移除 lint 报出的未使用参数。
  - _EN:_
    - Drop the unused parameter flagged by lint.
- 推进版本号并写入本次发布的双语更新日志。
  - _EN:_
    - Bump the version and record the bilingual changelog for this release.
- 在 package.json 里标注作者 Yoyo。
  - _EN:_
    - Record the fork author in package metadata.
- 分支上已推进的版本号直接作为发布版本（不再多跳一版），同版本的 CHANGELOG 旧条目会被覆盖。
  - _EN:_
    - Release the version already bumped on the branch instead of jumping another one, and replace the existing CHANGELOG entry for the same version.

### 其它变更

- 版本号与日志已在分支上准备好时跳过 release 提交，tag 只在缺失时创建，避免流水线因「无内容可提交」中断。
  - _EN:_
    - Skip the release commit when the version and changelog are already prepared on the branch, and create the tag only when missing, so the pipeline cannot fail on "nothing to commit".
- 更新 流水线自动发布的功能

## English

Release **v3.15.0** (2026-09-24)

### Features

- Update checks and downloads now read the project's GitHub Releases (blockmap-based differential download kept); the About window credits author Yoyo and states this is a secondary development based on ZCode.
  - _中文：_
    - 更新检查与下载改为读取 GitHub Release（保留 blockmap 差分下载）；「关于」补充作者 Yoyo 与「基于 ZCode 二次开发」说明。

### Fixes

- Make the version rewrite idempotent (a prepared version on the branch is already the release version) and make draft-release creation idempotent so a re-run after a failure can continue.
  - _中文：_
    - 版本改写改为幂等（分支上已准备好的版本号即为发布版本），草稿 Release 创建也改为幂等，失败重跑可继续。
- Keep node-dependent shared modules out of the barrel export (it broke the sandboxed preload and the renderer) and always default the model settings page to the first configured provider.
  - _中文：_
    - 依赖 node 内置模块的共享模块不再进 barrel（否则 preload 加载失败、界面卡在启动遮罩）；模型设置页默认选中第一个已配置的供应商。

### Maintenance

- Drop the unused parameter flagged by lint.
  - _中文：_
    - 移除 lint 报出的未使用参数。
- Bump the version and record the bilingual changelog for this release.
  - _中文：_
    - 推进版本号并写入本次发布的双语更新日志。
- Record the fork author in package metadata.
  - _中文：_
    - 在 package.json 里标注作者 Yoyo。
- Release the version already bumped on the branch instead of jumping another one, and replace the existing CHANGELOG entry for the same version.
  - _中文：_
    - 分支上已推进的版本号直接作为发布版本（不再多跳一版），同版本的 CHANGELOG 旧条目会被覆盖。

### Other Changes

- Skip the release commit when the version and changelog are already prepared on the branch, and create the tag only when missing, so the pipeline cannot fail on "nothing to commit".
  - _中文：_
    - 版本号与日志已在分支上准备好时跳过 release 提交，tag 只在缺失时创建，避免流水线因「无内容可提交」中断。
- 更新 流水线自动发布的功能

---

1 条提交只写了单一语言，因此只显示原文。在提交信息正文里加 `EN:` / `ZH:` 行即可同时生成两种语言。

1 commit(s) were single-language and are shown as-written. Add `EN:` / `ZH:` lines to the commit body to render both languages.

---

提交对照 / Full diff: https://github.com/ImYoyoData/Yoyo-code/compare/v3.14.0...v3.15.0
