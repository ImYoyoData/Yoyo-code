# Yoyo Code Fork Spec

本仓库是 [ZCode](https://github.com/zai-org/zcode) 的开源分支，产品化为 **Yoyo Code**。本文件是该分支的产品契约：记录与上游的差异决策、状态所有者、接口边界与验收场景。

修改本文件覆盖的行为前，先更新本文件。

## 产品定位

Yoyo Code 是本地优先的 AI 编程工作台，只依赖用户自备的模型服务（自定义 Provider / API Key），不需要也不提供账号体系。

## 决策一览

| 项 | 取值 |
| --- | --- |
| 显示名 | `Yoyo Code` |
| 内部标识 | `yoyo-code` |
| 全局数据目录 | `{dataBaseDir}/.yoyo-code` |
| 项目级约定目录 | `{workspace}/.yoyo-code/` |
| 深链协议 | `yoyo-code://` |
| 模型来源 | 仅自定义 / API-Key Provider |
| 账号体系 | 无 |

## 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 全局数据根目录名 | `packages/services/src/paths.ts` 的 `YOYO_CODE_DATA_DIR_NAME` | 唯一常量。`getZCodeDataRootDir()` 与 `copyDataDirectory()` 都必须引用它，不得再写字面量 |
| 数据根目录位置 | `getDataBaseDir()` | 优先级：`setDataBaseDir()` > `ZCODE_DATA_BASE_DIR` > `HOME` |
| 项目级约定目录名 | `packages/services/src/paths.ts` 的 `YOYO_CODE_PROJECT_DIR_NAME` | 与全局目录名同源，项目级 skills/commands/agents/workflows 均引用 |
| 产品身份 | `packages/desktop/scripts/desktop-product-identity.mjs` | appId、productName、Linux executable/package name 的唯一来源 |
| Electron userData 目录名 | `packages/desktop/src/main/desktopRuntimeEnv.ts` 的 `runtimeApplicationName` | 由打包态与 `ZCODE_DESKTOP_APPLICATION_NAME` 决定 |
| 渲染层启动门禁 | `packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts` | 只看 `hasUsableProvider` |
| Provider 注册表 | `packages/provider/src/registry-service.ts` | 内置配置 + 个人自定义 Provider 两层 |

## 与上游的行为差异

### 1. 无账号体系

上游要求登录 ZCode 账号（OAuth）后才能获得内置的订阅制 Provider。本分支删除整条 OAuth 链路及所有账号耦合产品面：

- 删除 OAuth 服务、深链回调、登录 UI、渲染层账号状态。
- 删除只有账号可用才成立的产品面：coding-plan 订阅与升级、用量配额面板、团队版、官方 MCP 账号身份、off-peak 账号凭证。
- 遥测不再携带用户身份。
- 启动门禁只判断是否存在可用 Provider：没有 Provider 时引导用户配置自定义模型，而不是引导登录。

**保留**：`WelcomeScreen` 骨架与 `LoginApiKeyForm` 走的 `providerSettingsService.createPersonalProvider` 路径。该路径本来就不需要 OAuth，是首次配置自定义模型的入口。

### 2. 数据目录与约定改名

`~/.zcode` → `~/.yoyo-code`，项目级 `.zcode/` → `.yoyo-code/`，深链 `zcode://` → `yoyo-code://`。

**不做数据迁移**：fork 首次启动是空白状态。上游数据目录保持原样不受影响，避免把账号数据带进无账号的产品。

### 3. 明确的改名边界

以下保留上游命名，不是遗漏：

- npm workspace scope `@zcode/*`。
- 渲染层全局 API `window.zcode.*`（见 `packages/client/src/globals.d.ts`）。注意 `.zcode.on` / `.zcode.get` / `.zcode.set` 这类是对象属性访问而非目录名，批量改名时必须排除。
- 内部 TypeScript 标识符中的 `ZCode`（如 `getZCodeDataRootDir`、`ZcodeAgentService`）。
- `ZCODE_*` 环境变量名。
- 插件清单目录 `.zcode-plugin/`：改名会让所有既有插件包失配，因此保留。
- 上游法律文件 `LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`：Apache-2.0 要求保留声明。

### 4. 保留的历史识别标记

这些字符串是「识别既有产物」的凭据，改了会失去识别能力，因此刻意保留上游拼写：

| 位置 | 值 | 作用 |
| --- | --- | --- |
| `packages/shared/src/official-mcp-auth.ts` | `com.zcode/` | 跨语言 MCP 协议命名空间，Plugin 侧按同一字符串读取，改名等于对已发布插件做 breaking change |
| `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` | `Comment=ZCode Desktop App` | 识别历史版本写过的用户级 `.desktop` 条目；它只用于归属判定，不展示 |
| `packages/desktop/src/main/mcpUserDirectory/legacy.ts` | `AppData\ZCode`、`AppData\ZCode Dev` | 识别旧版本遗留的 Electron 用户数据目录 |
| `packages/desktop/build/installer.nsh` | `.yoyo-code-install-manifest` | 安装器记录自己写过哪些文件；与 `electron-builder.config.js` 的常量必须同名 |

`.zcodeignore`、`.zcode-share*` 也保持上游拼写：它们是写进用户工作区、且被既有仓库内容依赖的文件/目录约定，与 `.zcode-plugin/` 同属一类兼容性面。

### 5. 图标

占位图标由 `scripts/generate-placeholder-icons.mjs` 生成（圆角方形 + 对角渐变 + 圆头笔画 Y），每个尺寸独立按解析式抗锯齿光栅化，不做缩放重采样。

拿到正式设计稿后，把等尺寸 PNG 覆盖到相同路径并重跑该脚本即可，不需要改代码。

**产品 logo 与 Z.ai provider 图标已解耦**：上游把 `packages/ui/src/assets/provider-icons/logo-zai.svg` 同时当作产品 logo 和 Z.ai provider 图标。现在产品 logo 是独立的 `packages/ui/src/assets/product-logo.svg`，`logo-zai.svg` 只归 Z.ai provider 使用。`model-provider-zai-app.png` 也从「应用图标副本」改成独立归档的 provider 素材，不要再从 `packages/desktop/build/icons/` 派生。

## 验收场景

1. **首次启动创建新目录**：干净环境下启动桌面应用，`{HOME}/.yoyo-code` 被创建，`%APPDATA%/Yoyo Code Dev`（开发态）被创建；不读取 `~/.zcode`。
2. **品牌一致**：窗口标题、托盘菜单、关于对话框、安装包名称都显示 `Yoyo Code`；窗口与托盘图标为新图标。
3. **无登录入口**：应用启动后直接进入工作区，任何界面都不出现登录、注册、账号头像或退出登录入口。未配置 Provider 时展示的是「配置自定义模型」引导。
4. **自定义模型可用**：只配置一个自定义 Provider（自定义 Base URL + API Key）即可发起对话并完成一次工具调用。
5. **项目级约定生效**：在工作区放置 `.yoyo-code/commands/*.md`，该命令出现在斜杠命令列表中。`.zcode/` 目录不再被读取。

## 非目标

- 不保持与上游 ZCode 的数据、插件清单、深链协议的互操作性。
- 不重命名 npm 包 scope 与内部标识符。
