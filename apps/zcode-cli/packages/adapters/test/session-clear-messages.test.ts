/**
 * 清空会话聊天记录（clearMessages）回归。
 *
 * 语义：只删 message/part，保留 session 行与标题；别的会话的聊天记录不受影响；
 * 事务失败必须整体回滚，不能留下“message 删了、part 还在”的半状态。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createSessionId } from "@zcode/contracts";
import { createSqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import {
  EXISTING_ID,
  HISTORY_MARKER,
  SURVIVOR_ID,
  messageInput,
  sessionInput,
} from "./fixtures/session-transaction-race.js";

const roots: string[] = [];
const stores: Array<ReturnType<typeof createSqliteSessionStore>> = [];

function openStore() {
  const store = createSqliteSessionStore();
  stores.push(store);
  return store;
}

async function openTempStore() {
  const directory = await mkdtemp(join(tmpdir(), "session-clear-history-"));
  roots.push(directory);
  return { store: openStore(), directory };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("clearMessages", () => {
  it("删除目标会话的 message/part，保留 session 与其他会话历史", async () => {
    const { store, directory } = await openTempStore();
    await store.createSession(sessionInput(SURVIVOR_ID, directory));
    await store.createSession(sessionInput(EXISTING_ID, directory));
    const survivor = messageInput(SURVIVOR_ID);
    const other = messageInput(EXISTING_ID);
    await store.saveMessage(survivor.info);
    for (const part of survivor.parts) await store.savePart(part);
    await store.saveMessage(other.info);
    for (const part of other.parts) await store.savePart(part);

    const removed = await store.clearMessages!({ sessionID: SURVIVOR_ID });
    assert.equal(removed, 1);
    assert.deepEqual(await store.messages({ sessionID: SURVIVOR_ID }), []);
    // 任务事实保留：session 行仍在，标题不变。
    assert.equal((await store.getSession(SURVIVOR_ID))?.title, SURVIVOR_ID);
    // 其他会话完全不受影响。
    const otherMessages = await store.messages({ sessionID: EXISTING_ID });
    assert.equal(otherMessages.length, 1);
    assert.equal((otherMessages[0]?.parts[0] as { text?: string })?.text, HISTORY_MARKER);
  });

  it("对没有消息的会话是幂等的 no-op", async () => {
    const { store, directory } = await openTempStore();
    const emptyId = createSessionId("clear-history-empty");
    await store.createSession(sessionInput(emptyId, directory));
    assert.equal(await store.clearMessages!({ sessionID: emptyId }), 0);
    assert.equal(await store.clearMessages!({ sessionID: emptyId }), 0);
    assert.equal((await store.getSession(emptyId))?.id, emptyId);
  });
});
