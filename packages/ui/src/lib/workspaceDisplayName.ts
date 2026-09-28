import { getPathLeaf } from "@/lib/path.js";
import { formatRemoteWorkspaceDisplayLabel } from "@/lib/remoteWorkspaceHistory.js";
import { resolveWorkspaceKey } from "@zcode/shared";
import type { RemoteTarget, RemoteTargetSnapshot } from "@zcode/shared";

/** workspaceKey 与设置表 `workspaceDisplayNames` 的 key 一致：身份优先，回退路径。 */
export type WorkspaceDisplayNames = Readonly<Record<string, string>>;

export function resolveWorkspaceDisplayNameKey({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath: string;
  workspaceIdentity?: string | null;
}): string {
  return resolveWorkspaceKey({ workspacePath, workspaceIdentity: workspaceIdentity ?? undefined });
}

/** 真实文件夹名，也就是没有自定义备注时界面显示的名字。 */
export function resolveWorkspaceFolderName(workspacePath: string): string {
  return getPathLeaf(workspacePath).trim() || workspacePath;
}

/**
 * 主显示名：用户备注优先，否则回落文件夹名。
 * SSH 远程 workspace 沿用既有的 `[SSH: alias]` 后缀，避免两类信息互相覆盖。
 */
export function resolveWorkspaceDisplayName({
  displayName,
  workspacePath,
  remoteTarget,
}: {
  displayName?: string | null;
  workspacePath: string;
  remoteTarget?: RemoteTarget | RemoteTargetSnapshot;
}): string {
  const folderName = resolveWorkspaceFolderName(workspacePath);
  const custom = displayName?.trim();
  return formatRemoteWorkspaceDisplayLabel(custom || folderName, remoteTarget);
}

/**
 * 是否需要在主名下方补一行淡色文件夹名。
 *
 * 只有"存在备注且与文件夹名不同"才需要——否则两行显示同样的文字，
 * 用户会以为重复渲染。远程 SSH 后缀也参与比较，避免和 `名 [SSH: x]` 并排显示。
 */
export function shouldShowFolderNameUnder({
  displayName,
  folderName,
  remoteTarget,
}: {
  displayName?: string | null;
  folderName: string;
  remoteTarget?: RemoteTarget | RemoteTargetSnapshot;
}): boolean {
  const custom = displayName?.trim();
  if (!custom) return false;
  const decorated = formatRemoteWorkspaceDisplayLabel(folderName, remoteTarget);
  return decorated !== formatRemoteWorkspaceDisplayLabel(custom, remoteTarget);
}

/**
 * 计算写入设置的新映射。
 *
 * 空备注或与文件夹名相同的备注都**删除 key** 而不是存冗余值：
 * 否则用户清空备注后会留下一个与默认值等价的条目，重启后看不出到底改没改过。
 * map 未变化时返回 null，调用方据此跳过无意义的写入。
 */
export function buildWorkspaceDisplayNamesPatch({
  current,
  workspaceKey,
  nextDisplayName,
  workspacePath,
}: {
  current: WorkspaceDisplayNames | undefined;
  workspaceKey: string;
  nextDisplayName: string;
  workspacePath: string;
}): Record<string, string> | null {
  const trimmed = nextDisplayName.trim();
  const folderName = resolveWorkspaceFolderName(workspacePath);
  const next = { ...current };
  if (!trimmed || trimmed === folderName) {
    if (!(workspaceKey in next)) return null;
    delete next[workspaceKey];
  } else {
    if (next[workspaceKey] === trimmed) return null;
    next[workspaceKey] = trimmed;
  }
  return next;
}
