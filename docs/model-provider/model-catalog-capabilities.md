# 模型目录能力回填 Spec

本文件规定"添加模型"时，上下文窗口、最大输出、输入模态、结构化输出、原生联网搜索、推理等级这几项**自动回填的数据来源、优先级与推导边界**。

修改本文件覆盖的行为前，先更新本文件。

## 产品定位

用户在设置页添加模型时，期望系统按**该 Provider 端点自己声明的事实**填好能力项，而不是按内置规则目录的兜底值猜测。填错的能力项会直接导致运行时行为错误：上下文窗口决定请求截断，`supportsImage` 决定图片附件能否发送，`supportsNativeWebSearch` 决定联网搜索工具是否挂载。因此"界面显示"与"运行时生效"必须是同一份数据。

## 决策一览

| 项 | 取值 |
| --- | --- |
| 首选数据源 | Provider 端点 `GET <baseUrl>/models` 响应中声明的能力字段 |
| 次选数据源 | 内置规则目录 `config/provider/zcode-builtin.json` |
| 目录能力值的落盘方式 | 写入该模型的个人配置（smart 规则），不动 schema、不需迁移 |
| 无依据时的行为 | 该字段不产出，沿用目录值；不允许凭模型名猜测 |
| 仍然没有依据时 | 提示用户确认，并把默认兜底参数写进个人配置 |
| 推理等级 map | 仅在端点声明 `reasoning_effort` 时推导 |

## 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 目录响应解析 | `packages/services/src/model-provider/providerModelCapabilities.ts` 的 `parseProviderModelCatalog` / `readProviderModelCapabilities` | 唯一把网关原始字段翻译成 `ModelConfigObject` 的地方；UI 不得自行解释网关字段 |
| 目录结果类型 | `packages/services/src/model-provider/providerFacadeServices.ts` 的 `ProviderModelCatalogEntry` | 经通用 RPC ProxyChannel 结构化透传，无 zod schema |
| 能力来源判定 | `packages/provider/src/config/model-config.ts` 的 `resolveWithProvenance` | 只命中通配 `.*` 时 `hasModelSpecificRule` 为 false，UI 据此判断是推断还是事实 |
| 回填、兜底与提交 | `packages/ui/src/settings/model-provider-section/ProviderModelCatalogDraft.ts` | 目录项与解析结果的合成、未验证项判定、默认兜底，以及写入个人配置的唯一入口 |
| 缺依据提示 | `packages/ui/src/settings/model-provider-section/ProviderModelCapabilityNotice.tsx` | 只列出未验证的能力项，不笼统提示 |
| 数值控件显示 | `packages/ui/src/settings/model-provider-section/ProviderModelMetadataDialog.tsx` | 推荐值以真值预填，空值表示跟随推荐 |
| 内置规则目录 | `config/provider/zcode-builtin.json` | 手工维护，`scripts/builtin-provider-config.mjs` 只校验和分发，不生成 |

## 优先级

模型某项能力的最终取值，按下列顺序由后者覆盖前者：

1. 内置规则目录的 `modelRules`（含兜底 `.*`）
2. 内置规则目录的 `modelApiRules`
3. 内置规则目录的 `providerSiteRules`
4. **端点 `/models` 声明的能力值**
5. 内置规则目录的 `templateModelRules` / `builtinProviderModelRules`（精确身份）
6. 个人配置（smart 规则）
7. 个人配置（manual 规则）

第 4 层压过全部正则规则：正则规则是人工维护的通配推断，端点声明是该 Provider 对这个模型的实际承诺。个人配置仍在最上层，用户的手工编辑永远优先。

## 推导边界

端点声明的字段名各家不统一，按下表归一。**任一项拿不到明确依据，就不产出该字段**，让目录值继续生效。

| 目标字段 | 接受的来源字段 | 拒绝的情况 |
| --- | --- | --- |
| `contextWindow` | `context_length`、`context_window` | 非正整数 |
| `optionSpecs.maxOutputTokens.max` | `top_provider.max_completion_tokens`、`max_output_tokens` | 非正整数 |
| `inputFormat.supportsImage` | `architecture.input_modalities` 含 `image` | 模态列表缺失或为空 |
| `inputFormat.supportsVideo` | `architecture.input_modalities` 含 `video` | 同上 |
| `inputFormat.supportsAudio` | `architecture.input_modalities` 含 `audio` | 同上 |
| `inputFormat.supportsPdf` | `architecture.input_modalities` 含 `pdf` | **含 `file` 不算**：多数网关把 PDF 归到 `file`，等同认定就是猜测 |
| `supportsJsonSchemaOutput` | `supported_parameters` 同时含 `response_format` 与 `json_schema` | 只有 `response_format` 不算 |
| `supportsNativeWebSearch` | `supported_parameters` 含 `web_search_options` 或 `web_search` | 其他形式的搜索能力不算 |
| `optionSpecs.reasoningLevel` | `supported_parameters` 含 `reasoning_effort` | 含 `reasoning` 但不含 `reasoning_effort` 不算 |

### 推理等级的档位取值

`supported_parameters` 声明 `reasoning_effort` 时，回填 `values: ["low", "medium", "high"]` 与 `map: {"reasoning_effort": reasoningLevel}`。

- **依据**：端点明确声明支持 `reasoning_effort` 参数，这是可观测的事实；档位名取该参数的标准取值集合。
- **map 形式**沿用内置目录中 `glm-5.3-flash` 站点规则已在使用的写法，可通过 `compileModelOptionMap`。
- 这是本文件唯一允许的推导。若后续发现某端点的档位集合不同，应在解析层按端点收窄，而不是放宽成"一律填充"。

## 缺依据时的兜底与提示

端点声明和规则目录专用规则都拿不到时，界面不能把通配兜底当成已知能力展示。此时：

1. 按字段判定，列出未验证的项（`contextWindow` / `maxOutputTokens` / `inputFormat`），在弹窗内提示用户确认。
2. 把默认兜底参数写进该模型的个人配置，让运行时行为确定且与界面一致。

默认兜底参数与内置目录的 `.*` 兜底保持同源，避免界面与运行时分裂：

| 能力 | 默认值 |
| --- | --- |
| `contextWindow` | 200000 |
| `optionSpecs.maxOutputTokens.max` | 32000 |
| `inputFormat` | 仅文本（图片 / 视频 / 音频 / PDF 均为 false） |

以下情况**不**提示、也**不**写兜底：端点已声明该项；或该模型命中了规则目录里的专用规则（例如 `glm-4.6` 的 `maxOutputTokens.max = 131072` 来自专用规则，应随目录更新，不该被固定值钉死）。

端点只声明部分能力时，只对缺失的那几项提示与兜底，已声明的项以端点为准。

## 验收场景

1. **端点声明被采信**：Provider 的 `/models` 对 `gpt-4o` 返回 `context_length: 128000`，添加该模型后上下文窗口显示 128000 而非目录兜底的 200000，且不出现缺依据提示。
2. **界面与运行时一致**：保存后该模型的个人配置中含端点声明的 `contextWindow`；实际请求的截断行为与界面显示的数值相同。
3. **无依据不猜测**：`/models` 只返回 `id` 时，不从模型名推断任何能力。
4. **缺依据时提示并兜底**：`/models` 只返回 `id` 且目录无专用规则时，弹窗提示"上下文窗口、最大输出 Token、输入类型"为默认值，保存后这三项以默认兜底值写入个人配置。
5. **file 不等于 PDF**：`/models` 的 `input_modalities` 为 `["text", "file"]` 时，`supportsPdf` 不被置为 true，该项计入未验证。
6. **清空即跟随推荐**：预填后的数值框被用户清空，保存后该项不写入个人配置，模型继续跟随目录值。
7. **手工编辑优先**：用户修改了某个能力项，只有该项写入个人配置，其余端点声明或兜底的值照常写入。
8. **目录回落**：端点不返回能力字段时，添加 `glm-4.6` 仍得到内置目录中为它专门配置的值（`maxOutputTokens.max = 131072`），不出现提示，也不写入默认兜底。

## 非目标

- 不引入 models.dev / LiteLLM 等外部能力目录，也不恢复已退役的 `models-dev` 来源标记。
- 不为 `supportsAudio` 增加设置页入口；它随目录或端点声明生效，界面不暴露编辑。
- 不改变 `ModelConfigObject` 的 schema 形状，也不引入新的持久化层级。
- 不追求覆盖全部模型：端点没声明就是没有依据，宁可提示用户确认也不编造能力值。
