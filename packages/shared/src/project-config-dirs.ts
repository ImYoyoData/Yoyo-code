import { join } from "node:path";

/**
 * 项目级配置目录名。三个名字都必须在所有项目级解析处保持一致，避免出现"某个入口认、另一个入口不认"的分叉。
 *
 * - `NATIVE`：当前原生目录。所有写入都固定落在它下面。
 * - `LEGACY_NATIVE`：迁移前的原生目录。老项目里的 MCP、skills、commands 等配置仍保存在这里，
 *   只能继续识别（只读兼容），绝不能作为写入目标，否则同一个项目会出现两份权威配置。
 * - `AGENTS`：跨工具通用约定目录，与原生目录一起读取。
 */
export const NATIVE_PROJECT_CONFIG_DIR_NAME = ".yoyo-code";
export const LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME = ".zcode";
export const AGENTS_PROJECT_CONFIG_DIR_NAME = ".agents";

/** 项目级配置目录，按优先级从高到低；同名资源按此顺序先到先得。 */
export const PROJECT_CONFIG_DIR_NAMES = [
  NATIVE_PROJECT_CONFIG_DIR_NAME,
  LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME,
  AGENTS_PROJECT_CONFIG_DIR_NAME,
] as const;

/** 只读兼容的历史目录：只参与读取，任何保存、删除、迁移都必须落在原生目录。 */
export const READONLY_PROJECT_CONFIG_DIR_NAMES = [
  LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME,
  AGENTS_PROJECT_CONFIG_DIR_NAME,
] as const;

/** 从配置文件路径回推项目根目录时，用它判断哪一层才是配置目录。 */
export function isProjectConfigDirName(name: string): boolean {
  return (PROJECT_CONFIG_DIR_NAMES as readonly string[]).includes(name);
}

/**
 * 项目级"内容目录"的候选路径，原生优先、迁移前的 `.zcode` 次之。
 *
 * 适用于一个目录承载整份内容（subagent、agent-memory 等）的场景：
 * 调用方按 `candidates.find(exists) ?? candidates[0]` 解析——项目已经有迁移前目录就继续沿用，
 * 否则一律使用原生目录，避免新旧两份内容各写一半。
 */
export function projectConfigDirCandidates(
  workspacePath: string,
  ...segments: readonly string[]
): readonly string[] {
  return [
    join(workspacePath, NATIVE_PROJECT_CONFIG_DIR_NAME, ...segments),
    join(workspacePath, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME, ...segments),
  ];
}
