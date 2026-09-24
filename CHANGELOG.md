# 更新日志 / Changelog

本文件由 `scripts/release/prepare-release.mjs` 自动维护：每次发布在标题下方插入一条双语条目。
This file is maintained by the release workflow; each release prepends a bilingual entry.

## v3.15.0 — 2026-09-24

## 中文

版本 **v3.15.0**（2026-09-24）

### 新功能

- 更新检查与下载改为读取 GitHub Release（保留 blockmap 差分下载）；「关于」补充作者 Yoyo 与「基于 ZCode 二次开发」说明。
  - _EN:_
    - Update checks and downloads now read the project's GitHub Releases (blockmap-based differential download kept); the About window credits author Yoyo and states this is a secondary development based on ZCode.

### 问题修复

- 依赖 node 内置模块的共享模块不再进 barrel（否则 preload 加载失败、界面卡在启动遮罩）；模型设置页默认选中第一个已配置的供应商。
  - _EN:_
    - Keep node-dependent shared modules out of the barrel export (it broke the sandboxed preload and the renderer) and always default the model settings page to the first configured provider.

### 维护

- 在 package.json 里标注作者 Yoyo。
  - _EN:_
    - Record the fork author in package metadata.
- 分支上已推进的版本号直接作为发布版本（不再多跳一版），同版本的 CHANGELOG 旧条目会被覆盖。
  - _EN:_
    - Release the version already bumped on the branch instead of jumping another one, and replace the existing CHANGELOG entry for the same version.

### 其它变更

- 更新 流水线自动发布的功能


## English

Release **v3.15.0** (2026-09-24)

### Features

- Update checks and downloads now read the project's GitHub Releases (blockmap-based differential download kept); the About window credits author Yoyo and states this is a secondary development based on ZCode.
  - _中文：_
    - 更新检查与下载改为读取 GitHub Release（保留 blockmap 差分下载）；「关于」补充作者 Yoyo 与「基于 ZCode 二次开发」说明。

### Fixes

- Keep node-dependent shared modules out of the barrel export (it broke the sandboxed preload and the renderer) and always default the model settings page to the first configured provider.
  - _中文：_
    - 依赖 node 内置模块的共享模块不再进 barrel（否则 preload 加载失败、界面卡在启动遮罩）；模型设置页默认选中第一个已配置的供应商。

### Maintenance

- Record the fork author in package metadata.
  - _中文：_
    - 在 package.json 里标注作者 Yoyo。
- Release the version already bumped on the branch instead of jumping another one, and replace the existing CHANGELOG entry for the same version.
  - _中文：_
    - 分支上已推进的版本号直接作为发布版本（不再多跳一版），同版本的 CHANGELOG 旧条目会被覆盖。

### Other Changes

- 更新 流水线自动发布的功能


---

1 条提交只写了单一语言，因此只显示原文。在提交信息正文里加 `EN:` / `ZH:` 行即可同时生成两种语言。

1 commit(s) were single-language and are shown as-written. Add `EN:` / `ZH:` lines to the commit body to render both languages.

