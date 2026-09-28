import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkspaceDisplayNamesPatch,
  resolveWorkspaceDisplayName,
  resolveWorkspaceDisplayNameKey,
  resolveWorkspaceFolderName,
  shouldShowFolderNameUnder,
} from "../src/lib/workspaceDisplayName.js";

const WINDOWS_PATH = "D:\\work\\my-project";

test("备注名 key 走身份优先、回退路径", () => {
  // 与 AGENTS.md 的身份规则一致：远程 workspace 用 workspaceIdentity，避免同名路径互相覆盖。
  assert.equal(
    resolveWorkspaceDisplayNameKey({ workspacePath: WINDOWS_PATH, workspaceIdentity: "ssh://host/a" }),
    "ssh://host/a",
  );
  assert.equal(
    resolveWorkspaceDisplayNameKey({ workspacePath: WINDOWS_PATH, workspaceIdentity: "  " }),
    WINDOWS_PATH,
  );
  assert.equal(
    resolveWorkspaceDisplayNameKey({ workspacePath: WINDOWS_PATH, workspaceIdentity: null }),
    WINDOWS_PATH,
  );
});

test("真实文件夹名取路径末段", () => {
  assert.equal(resolveWorkspaceFolderName(WINDOWS_PATH), "my-project");
  assert.equal(resolveWorkspaceFolderName("/home/dev/proj/"), "proj");
});

test("没有备注时主名就是文件夹名", () => {
  assert.equal(
    resolveWorkspaceDisplayName({ workspacePath: WINDOWS_PATH }),
    "my-project",
  );
  assert.equal(
    resolveWorkspaceDisplayName({ workspacePath: WINDOWS_PATH, displayName: "   " }),
    "my-project",
  );
});

test("有备注时主名用备注，真实文件夹名不受影响", () => {
  const name = resolveWorkspaceDisplayName({
    workspacePath: WINDOWS_PATH,
    displayName: "  支付重构  ",
  });
  assert.equal(name, "支付重构");
  // 重命名只是内部备注：路径和文件夹名都不变。
  assert.equal(resolveWorkspaceFolderName(WINDOWS_PATH), "my-project");
});

test("SSH 远程 workspace 沿用既有的别名后缀", () => {
  const name = resolveWorkspaceDisplayName({
    workspacePath: "/srv/app",
    displayName: "线上服务",
    remoteTarget: { kind: "ssh", sshConfigAlias: "prod" } as never,
  });
  assert.equal(name, "线上服务 [SSH: prod]");
});

test("只在有备注且与文件夹名不同时才补第二行", () => {
  assert.equal(
    shouldShowFolderNameUnder({ displayName: "支付重构", folderName: "my-project" }),
    true,
  );
  // 没有备注、或备注就等于文件夹名，两行会显示同样的文字。
  assert.equal(
    shouldShowFolderNameUnder({ folderName: "my-project" }),
    false,
  );
  assert.equal(
    shouldShowFolderNameUnder({ displayName: "my-project", folderName: "my-project" }),
    false,
  );
});

test("写入备注", () => {
  assert.deepEqual(
    buildWorkspaceDisplayNamesPatch({
      current: {},
      workspaceKey: WINDOWS_PATH,
      nextDisplayName: "支付重构",
      workspacePath: WINDOWS_PATH,
    }),
    { [WINDOWS_PATH]: "支付重构" },
  );
});

test("清空备注会删除 key，而不是留下空值", () => {
  assert.deepEqual(
    buildWorkspaceDisplayNamesPatch({
      current: { [WINDOWS_PATH]: "支付重构", "/other": "别的" },
      workspaceKey: WINDOWS_PATH,
      nextDisplayName: "   ",
      workspacePath: WINDOWS_PATH,
    }),
    { "/other": "别的" },
  );
});

test("备注等于文件夹名时删除 key（不存冗余值）", () => {
  // 否则清空备注后会留下一条与默认值等价的记录，重启后看不出到底改没改过。
  assert.deepEqual(
    buildWorkspaceDisplayNamesPatch({
      current: { [WINDOWS_PATH]: "支付重构" },
      workspaceKey: WINDOWS_PATH,
      nextDisplayName: "my-project",
      workspacePath: WINDOWS_PATH,
    }),
    {},
  );
});

test("没有实际变化时不产生写入", () => {
  assert.equal(
    buildWorkspaceDisplayNamesPatch({
      current: { [WINDOWS_PATH]: "支付重构" },
      workspaceKey: WINDOWS_PATH,
      nextDisplayName: "支付重构",
      workspacePath: WINDOWS_PATH,
    }),
    null,
  );
  // 已经没有备注又提交空值，也不该产生一次设置写盘。
  assert.equal(
    buildWorkspaceDisplayNamesPatch({
      current: {},
      workspaceKey: WINDOWS_PATH,
      nextDisplayName: "",
      workspacePath: WINDOWS_PATH,
    }),
    null,
  );
});

test("修改某个 workspace 的备注不影响其他 workspace", () => {
  assert.deepEqual(
    buildWorkspaceDisplayNamesPatch({
      current: { "/other": "别的" },
      workspaceKey: WINDOWS_PATH,
      nextDisplayName: "支付重构",
      workspacePath: WINDOWS_PATH,
    }),
    { "/other": "别的", [WINDOWS_PATH]: "支付重构" },
  );
});
