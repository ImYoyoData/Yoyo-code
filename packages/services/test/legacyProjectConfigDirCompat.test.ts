import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createWorkspaceHookSourceInput,
  discoverWorkspaceHookConfigPaths,
} from "@zcode/shared/workspace-hook-discovery";
import {
  AGENTS_PROJECT_CONFIG_DIR_NAME,
  LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME,
  NATIVE_PROJECT_CONFIG_DIR_NAME,
} from "@zcode/shared/project-config-dirs";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";
import { resolveWorkspaceSubagentRoot } from "../src/subagents/subagentStorage.js";

async function writeMcpConfig(
  directory: string,
  fileName: string,
  serverName: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  // 原生目录用嵌套的 mcp.servers，跨工具目录用扁平的 mcpServers。
  const payload =
    fileName === "mcp.json"
      ? { mcpServers: { [serverName]: { command: "node", args: ["-v"] } } }
      : { mcp: { servers: { [serverName]: { command: "node", args: ["-v"] } } } };
  await writeFile(join(directory, fileName), JSON.stringify(payload, null, 2), "utf8");
}

/** 用户级目录指向临时 HOME，避免测试读到开发机上的真实 MCP 配置。 */
async function withIsolatedHome(run: (home: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const home = await mkdtemp(join(tmpdir(), "yoyo-compat-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await run(home);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    await rm(home, { recursive: true, force: true });
  }
}

test("项目仍有迁移前的 .zcode 配置时，MCP 与 hooks 继续被识别", async () => {
  await withIsolatedHome(async () => {
    const workspace = await mkdtemp(join(tmpdir(), "yoyo-compat-legacy-"));
    try {
      await writeMcpConfig(
        join(workspace, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME),
        "config.json",
        "legacy-mcp",
      );

      const result = await createMcpSyncService().loadMcpFromUserDirectory({
        workspacePath: workspace,
      });
      assert.deepEqual(
        result.servers.map((server) => server.name),
        ["legacy-mcp"],
      );

      const refs = discoverWorkspaceHookConfigPaths({ workingDirectory: workspace });
      assert.deepEqual(
        refs.map((ref) => ref.path),
        [join(workspace, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME, "config.json")],
      );
      const source = createWorkspaceHookSourceInput({
        path: refs[0]!.path,
        workingDirectory: workspace,
        hooks: {},
        discoveryOrder: 0,
      });
      // baseDir 必须回到项目根，否则 hooks 会以配置目录为工作目录执行。
      assert.equal(source.configFileKind, ".zcode/config.json");
      assert.equal(source.baseDir, workspace);
      // 历史目录不是可编辑目标，保存仍落在原生目录。
      assert.equal(source.editable, false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test("新旧目录并存时原生目录优先，旧目录不产生重复项", async () => {
  await withIsolatedHome(async () => {
    const workspace = await mkdtemp(join(tmpdir(), "yoyo-compat-both-"));
    try {
      await writeMcpConfig(
        join(workspace, NATIVE_PROJECT_CONFIG_DIR_NAME),
        "config.json",
        "native-mcp",
      );
      await writeMcpConfig(
        join(workspace, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME),
        "config.json",
        "legacy-mcp",
      );

      const result = await createMcpSyncService().loadMcpFromUserDirectory({
        workspacePath: workspace,
      });
      assert.deepEqual(
        result.servers.map((server) => server.name),
        ["native-mcp"],
      );

      const hookPaths = discoverWorkspaceHookConfigPaths({ workingDirectory: workspace }).map(
        (ref) => ref.path,
      );
      assert.deepEqual(hookPaths, [
        join(workspace, NATIVE_PROJECT_CONFIG_DIR_NAME, "config.json"),
        join(workspace, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME, "config.json"),
      ]);

      // 内容目录（subagent）沿用项目里已经存在的那份，避免新旧两处各写一半。
      assert.equal(
        resolveWorkspaceSubagentRoot(workspace),
        join(workspace, NATIVE_PROJECT_CONFIG_DIR_NAME, "agents"),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test("只有旧目录时项目级内容目录沿用旧目录", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yoyo-compat-legacy-content-"));
  try {
    await mkdir(join(workspace, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME, "agents"), {
      recursive: true,
    });
    assert.equal(
      resolveWorkspaceSubagentRoot(workspace),
      join(workspace, LEGACY_NATIVE_PROJECT_CONFIG_DIR_NAME, "agents"),
    );
    // 目录不存在时仍然回到原生目录，保证新项目不会写进历史目录。
    const fresh = join(workspace, "fresh-project");
    await mkdir(fresh, { recursive: true });
    assert.equal(
      resolveWorkspaceSubagentRoot(fresh),
      join(fresh, NATIVE_PROJECT_CONFIG_DIR_NAME, "agents"),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("跨工具 .agents 目录仍然被识别（回归）", async () => {
  await withIsolatedHome(async () => {
    const workspace = await mkdtemp(join(tmpdir(), "yoyo-compat-agents-"));
    try {
      await writeMcpConfig(
        join(workspace, AGENTS_PROJECT_CONFIG_DIR_NAME),
        "mcp.json",
        "agents-mcp",
      );
      const result = await createMcpSyncService().loadMcpFromUserDirectory({
        workspacePath: workspace,
      });
      assert.deepEqual(
        result.servers.map((server) => server.name),
        ["agents-mcp"],
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
