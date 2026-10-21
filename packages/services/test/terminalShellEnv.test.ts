import assert from "node:assert/strict";
import test from "node:test";
import { applyShellEnvironmentWorkarounds } from "../src/terminal/terminalService.js";

const isWindows = process.platform === "win32";
const PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

test("Windows 下为 pwsh 关闭更新提示（回归）", { skip: !isWindows }, () => {
  // PowerShell 7.6.x 的中文更新提示按本地化文案的行长算补位宽度，算出负数后 FailFast，
  // 启动即退出。这与终端宽度无关，只能通过它自己的开关绕过。
  const env = applyShellEnvironmentWorkarounds(PWSH, {});
  assert.equal(env.POWERSHELL_UPDATECHECK, "Off");
});

test("用户已显式设置时不覆盖", { skip: !isWindows }, () => {
  const env = applyShellEnvironmentWorkarounds("C:\\pwsh.exe", {
    POWERSHELL_UPDATECHECK: "Default",
  });
  assert.equal(env.POWERSHELL_UPDATECHECK, "Default");
});

test("其它 shell 不受影响", { skip: !isWindows }, () => {
  const shells = [
    "C:\\Windows\\System32\\cmd.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ];
  for (const shell of shells) {
    const env = applyShellEnvironmentWorkarounds(shell, {});
    assert.equal(env.POWERSHELL_UPDATECHECK, undefined, shell);
  }
});

test("不改动传入的环境对象", { skip: !isWindows }, () => {
  const original: NodeJS.ProcessEnv = { FOO: "bar" };
  applyShellEnvironmentWorkarounds("C:\\pwsh.exe", original);
  assert.equal(original.POWERSHELL_UPDATECHECK, undefined);
});
