import { app } from "electron";
import { join } from "node:path";
import { logger } from "./logger.js";

export function resolveZCodeBuiltinProviderConfigFilePath(options?: {
  readonly appPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isPackaged?: boolean;
  readonly resourcesPath?: string;
}): string {
  const resolved = resolveZCodeBuiltinProviderConfigFilePathInner(options);
  // Built-in Provider 目录决定模型设置里出现哪些供应商；解析错路径时只能从
  // 数据目录的物化副本反推，排查成本很高，这里保留一条可追溯的诊断记录。
  logger.info(`[provider-config] builtin catalog path: ${resolved}`);
  return resolved;
}

function resolveZCodeBuiltinProviderConfigFilePathInner(options?: {
  readonly appPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isPackaged?: boolean;
  readonly resourcesPath?: string;
}): string {
  const explicitPath = (options?.env ?? process.env)["ZCODE_BUILTIN_PROVIDER_CONFIG_FILE"]?.trim();
  if (explicitPath) return explicitPath;
  if (options?.isPackaged ?? app.isPackaged) {
    return join(
      options?.resourcesPath ?? process.resourcesPath,
      "config/provider/zcode-builtin.json",
    );
  }
  const filename = "zcode-builtin.json";
  return join(options?.appPath ?? app.getAppPath(), "../../config/provider", filename);
}
