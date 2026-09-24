# 把 ZCode 源码改造为独立的 Yoyo Code 分支

## 已确认的产品决策

| 项 | 决定 |
| --- | --- |
| 显示名 | `Yoyo Code` |
| 内部标识 | `yoyo-code`（目录名、Linux 包名、appId） |
| 全局数据目录 | `~/.zcode` → `~/.yoyo-code` |
| 项目级约定 | `.zcode/*` → `.yoyo-code/*` |
| 深链协议 | `zcode://` → `yoyo-code://` |
| 登录 | 彻底删除 OAuth 及所有账号耦合产品面 |
| 模型来源 | 仅自定义 / API-Key Provider |
| 图标 | 生成占位图标（后续可整体替换） |

## 明确不改的边界

调研发现仓库里 1266 个文件命中 `ZCode`，但绝大多数不是用户可见文案。以下保留不动，理由是没有产品收益且改动风险高：

- **npm workspace scope `@zcode/*`**（3559 处引用）——内部包名，不是产品名。
- **渲染层全局 API `window.zcode.*`**——`packages/client/src/globals.d.ts:57` 声明的 platform 接口。特别注意：`.zcode.on` / `.zcode.get` / `.zcode.set` 这类**是对象属性访问而非目录名**，任何粗暴的全局替换都会改坏运行时 API。
- **内部 TS 标识符**（`getZCodeDataRootDir`、`ZcodeAgentService`、`legacyZCodeConfigProviderReader` 等）。
- **`ZCODE_*` 环境变量名**（README / `.env.example` 已有文档，改名纯属churn）。
- **`.zcode-plugin/` 插件清单目录**（按你的选择保留，现有插件包继续可用）。
- **上游法律文件** `LICENSE` / `NOTICE.md` / `THIRD-PARTY-NOTICES.md`——Apache-2.0 要求保留声明，只在 README 增加 fork 说明。

## 阶段 0：规格先行

AGENTS.md 要求先明确产品规则再改代码。新建 `docs/yoyo-code-fork-spec.md`，记录上表决策、状态所有者、验收场景，以及本方案的边界清单。

## 阶段 1：路径与身份改名

**1.1 全局数据目录**（核心，必须同源改否则启动即失败）
- `packages/services/src/paths.ts:44` 的 `.zcode` → 新常量；`:232-233` `copyDataDirectory`
- `packages/services/src/storage/adapters/rootsResolver.ts:9` 的 `ZCODE_DATA_DIR_NAME`
- `packages/zcode-server-cli/src/runtime/paths.ts:25,82`
- 九个 service 各自硬编码的 `resolveUserHomeDir()`：`settingService`、`skillsService`、`commandsService`、`hooksService`、`mcpSyncService`、`pluginSyncService`、`settingsSyncService`、`skillSyncService`、`subagentStorage`
- desktop：`main/index.ts:532`、`desktopDataBaseDirBootstrap.ts:7`、`desktopChromiumHardwareAccelerationBootstrap.ts:10`、`desktopRuntimeEnv.ts:498`、`exportLogs.ts`
- services：`node.ts:1072,1800`、`deviceMid.ts`、`telemetryCore.ts`、`providerRuntimeResolver.ts`、`modelTrajectoryFileTail.ts`、`zcodeAgentService.ts:465`
- 远程/POSIX 硬编码：`server/src/remote/connect.ts:365`、`zcodeAgentBundleWrapper.ts:15`、`scripts/zcode-distribution/installer.mjs:8`
- Windows 安装目录校验名：`paths.ts:116-119`

**1.2 项目级约定**：`.zcode/config.json`、`.zcode/skills`、`.zcode/commands`、`.zcode/agents`、`.zcode/workflows`、`.zcode/hooks`、`.zcodeignore` 等，覆盖 services 侧与 `apps/zcode-cli` 侧（合计约 40 处），以及 `.zcode-share*`、`.zcode-runtime`。

**1.3 应用身份**
- `desktopRuntimeEnv.ts:61-63`：`ZCode` / `ZCode Dev` / `ZCode Preview` → `Yoyo Code` / `Yoyo Code Dev` / `Yoyo Code Preview`（这同时决定 `%APPDATA%` 下的 userData 目录名）
- `desktop-product-identity.mjs`：`appId`、`productName`、Linux executable/package name；`:87` 开发态 AUMID
- `packages/desktop/package.json` 的 `productName`/`description`/`author`；`electron-builder.config.js` 的 `extraMetadata`、maintainer、artifact 名、`:653` 协议注册
- `desktopWindowsOpenFolderContextMenu.ts` 注册表键、`desktopLinuxDeepLinkRegistration.ts` 的 `zcode.desktop`、`process-names.ts`

**1.4 深链**：`desktopDeepLinkUrl.ts:1`、`platform.ts:678`、web 分享回链、`devElectronAppBundle.mjs`

**1.5 品牌文案**：`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`（88 / 91 行）、`desktopMenu.ts` 托盘与菜单、`about.ts` / `aboutWindow.ts`、`forceUpdate*`、CUA 面板与通知、`web/index.html` 与 `main.tsx` 标题、web 登录/分享页、UI 组件（`WorkspaceSidebarFooter`、`DesktopTopOverlay`、`WindowsTopLeftLogo`、`ZCodeAboutLogo`、`RootStartupLoading`、`WorkspaceShellLayout`）、shared 侧（`zcode-source-headers` 的 User-Agent、`openrouter-attribution`、`plugin-display-name`、`feedback` 标签）

**1.6 数据迁移**：不做自动迁移，新目录全新开始。这样避免把上游账号数据搬进 fork。

## 阶段 2：占位图标

用已安装的 `jimp` 生成 1024×1024 主图（圆角方底 + 字母 Y），降采样出全套；ICO 写一个最小的 PNG 内嵌编码器；ICNS 用 `@fiahfy/icns` 的 `Icns.append()` + `data` 生成。

输出：`packages/desktop/build/{icon.png, icon_windows.png, icon.ico, icon.icns, icon_installer.*, icons/*.png}`、`packages/web/public/favicon.ico`、web/desktop `index.html` 内联 favicon。

内联 SVG logo 需重绘：desktop renderer `index.html`、web `index.html`、`aboutWindow.ts`、`ZCodeAboutLogo.tsx`、`RootStartupLoading.tsx`。

**必须解耦的一处**：`packages/ui/src/assets/provider-icons/logo-zai.svg` 和 `model-provider-zai-app.png` 同时被当作产品 logo 和 Z.ai provider 图标（`App.tsx:50` 的 `appLogoUrl`）。产品 logo 换新图，Z.ai provider 图标保持原样，否则会把第三方 provider 品牌一起改掉。

## 阶段 3：彻底删除 OAuth（分 5 步，每步保持 typecheck 通过）

- **3a 服务层**：删 `packages/services/src/oauth/*`、`IOAuthService`、`ServiceChannels.OAuth`、`accessor.ts` / `index.ts` 导出、`node.ts` 注册与 `onZcodeJwtInvalid`、`remoteWorkspaceServiceCollection.ts`、`client/remoteServiceAccess.ts`、`feedbackService` 的 JWT。
- **3b 桌面主进程**：删 OAuth 深链路由、`PlatformChannels.OAuthCallback*`、preload `oauthCallbackBridge.ts`、`appLaunchCoordinator` 的 OAuth 计数、`zcode://oauth/callback` 注册、JWT 失效广播。
- **3c 渲染层**：删 store 的 `user` / `authSessionSeq` / `isRestoringOAuthSession` / `oauth*` / `loginEntry*` 字段；删 `useRootOAuthEffects.ts`、`useOAuth.ts`、`oauthCachedSessionRestore.ts`、`oauthLoginAttemptGuard.ts`、`oauthProviderFamilySelectionRefresh.ts`、`oauthTeamPricing.ts`、`zcodeJwtInvalidRestartMarker.ts`、`accountConnection*`、`useAccountConnectionLossNotification.ts`、`useTokenRefresh.ts`、`useCredentials.ts`、`oauthProviderIcon.tsx`。
- **3d 账号耦合产品面**（你选择一并删除）：coding-plan 订阅/升级/团队版/start-plan、用量与配额面板（`usage-stats`、`CodingPlanUsageRemainingPanel`、`CodingPlanEmbeddedWebviewDialog` 等）、official-MCP 账号凭证、`accountProvider*` overlay 与 `providerProvisioning*`、off-peak 账号凭证解析、`providerFamilyDomain` 及其迁移、conversation-share token、onboarding 的 userId、telemetry 的 user-id / authorization loader。
- **3e CLI 与 Web**：CLI 的 `adapters/src/auth/*`、`tui-auth.ts`、`login-command.ts`、`tui-login-state.ts`；web 的 `src/auth/*` 与登录页。

**启动门禁改造**：`useProviderAvailabilityLoginEntryGuard.ts:57` 现在同时判 `user` / `providerFamilyDomain` / `hasUsableProvider`，改为只看 `hasUsableProvider`。首次运行时用去掉 OAuth 按钮的欢迎页引导配置自定义模型——现有 `WelcomeScreen.tsx` 的 `LoginApiKeyForm` 走 `providerSettingsService.createPersonalProvider`，本来就不需要 OAuth，保留这条路径即可。

## 验证方式

- 每个子阶段结束跑 `pnpm typecheck`；阶段 1、2 与 3d/3e 后跑 `pnpm lint` 和 `pnpm architecture:check --changed`。
- 代码改动按 AGENTS.md 用 `architecture-governance` 技能，先跑架构检查再读目标模块上下文。
- 最终验收：`pnpm dev:desktop` 启动，确认（1）生成 `~/.yoyo-code` 与新的 userData 目录（2）新图标与新名称出现在窗口/托盘/关于（3）不再出现任何登录入口，首页直接进入工作区（4）仅配置自定义模型即可发起对话。
- 按 AGENTS.md 如实报告 `typecheck` / `lint` 的真实结果，不把既有失败写成通过。

## 风险

- **改动量最大的阶段是 3d**：账号耦合面与计费/配额/遥测深度缠绕，需要按上面的分层顺序推进，任何一步都要 typecheck 兜底。
- **1.1 的 `.zcode` 改名必须与 `setting.json` 的启动读取路径同源**，否则应用启动即读到空配置。
- 不做数据迁移意味着 fork 首次启动是空白状态，需重新配置模型；上游 `~/.zcode` 数据不受影响。
- 1.5 与 3d/3e 存在交叉（登录文案、账号入口同时属于品牌与删除范围），我会在阶段 3 一并处理，避免重复改动同一批文件。