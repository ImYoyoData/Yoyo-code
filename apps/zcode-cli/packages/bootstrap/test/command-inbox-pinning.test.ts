/**
 * CommandInbox pin 判定回归。
 *
 * 清空聊天记录必须在「没有并发写入」时执行，但执行它的那条命令自身必然 in-flight。
 * 早期实现直接调用 hasPinnedSessionState(sessionId)，于是活会话 100% 判定为忙，
 * UI 永远只收到失败——这里锁住 exceptCommandId 的语义。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommandInbox } from "../src/zcode-protocol-v4/command-inbox.js";

function createInbox(): CommandInbox {
  return new CommandInbox({
    getRevision: () => 0,
    getLogEpoch: () => "epoch",
    allowsColdSession: (envelope) => envelope.type === "clearSessionHistory",
  });
}

function envelope(commandId: string, type: "clearSessionHistory" | "sendText" = "sendText") {
  return {
    commandId,
    clientId: "test-client",
    sessionId: "sess_test",
    type,
    payload: type === "sendText" ? { text: "hi" } : {},
    issuedAt: Date.now(),
  };
}

describe("CommandInbox.hasPinnedSessionState", () => {
  it("未排除自身时，执行中的命令算作 pinned", async () => {
    const inbox = createInbox();
    const outcome = await inbox.handle(envelope("cmd-self"));
    assert.equal(outcome.kind, "execute");
    assert.equal(inbox.hasPinnedSessionState("sess_test"), true);
  });

  it("exceptCommandId 排除自身后，只剩不存在并发写入", async () => {
    const inbox = createInbox();
    const outcome = await inbox.handle(envelope("cmd-self"));
    assert.equal(outcome.kind, "execute");
    // 这正是 clearSessionHistory 的 busy 预检：不能因为自己 in-flight 就拒绝。
    assert.equal(inbox.hasPinnedSessionState("sess_test", { exceptCommandId: "cmd-self" }), false);
  });

  it("其它并发命令仍然阻止清空", async () => {
    const inbox = createInbox();
    assert.equal((await inbox.handle(envelope("cmd-other"))).kind, "execute");
    assert.equal(inbox.hasPinnedSessionState("sess_test", { exceptCommandId: "cmd-self" }), true);
  });

  it("冷会话允许 clearSessionHistory 直接进入执行", async () => {
    const inbox = new CommandInbox({
      // 不在内存注册表 = revision null
      getRevision: () => null,
      getLogEpoch: () => null,
      allowsColdSession: (value) => value.type === "clearSessionHistory",
    });
    const outcome = await inbox.handle(envelope("cmd-cold", "clearSessionHistory"));
    assert.equal(outcome.kind, "execute");
  });

  it("普通命令对冷会话仍然拒绝", async () => {
    const inbox = new CommandInbox({
      getRevision: () => null,
      getLogEpoch: () => null,
      allowsColdSession: (value) => value.type === "clearSessionHistory",
    });
    const outcome = await inbox.handle(envelope("cmd-cold-send", "sendText"));
    assert.equal(outcome.kind, "ack");
    if (outcome.kind === "ack") {
      assert.equal(outcome.ack.status, "rejected");
      assert.equal(outcome.ack.reasonCode, "proto.sessionNotFound");
    }
  });
});
