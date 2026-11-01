/**
 * SQLite 事务隔离回归。
 *
 * `node:sqlite` 的 DatabaseSync 事务属于整条连接：BEGIN 到 COMMIT/ROLLBACK 之间一旦 await，
 * 其他会话的写入会落进同一个事务，fork 回滚时被一起撤销，重启后会话/历史直接消失。
 * 这里用故障注入在 fork 提交前抛错，同时并发写其他会话，断言那些写入不被回滚。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createSessionId } from "@zcode/contracts";
import { createSqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import {
  CHILD_ID,
  EXISTING_ID,
  HISTORY_MARKER,
  PARENT_ID,
  SURVIVOR_ID,
  forkBundle,
  seedFailedForkRace,
  sessionInput,
} from "./fixtures/session-transaction-race.js";

const roots: string[] = [];
const stores: Array<ReturnType<typeof createSqliteSessionStore>> = [];

function openStore(failFork = false, dbPath?: string) {
  const store = createSqliteSessionStore({
    ...(dbPath ? { dbPath } : {}),
    ...(failFork ? { forkCommitFaultAt: "beforeCommit" as const } : {}),
  });
  stores.push(store);
  return store;
}

async function openTempStore(failFork = false) {
  const directory = await mkdtemp(join(tmpdir(), "session-transaction-"));
  roots.push(directory);
  const dbPath = join(directory, "db.sqlite");
  return { store: openStore(failFork, dbPath), dbPath, directory };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("connection-wide transaction isolation", () => {
  it("fork 回滚不撤销其他会话已成功的创建、更新和历史写入", async () => {
    const { store, directory } = await openTempStore(true);
    const results = await seedFailedForkRace(store, directory);
    const rejected = results[0]!;
    assert.equal(rejected.status, "rejected");
    assert.match(
      String((rejected as PromiseRejectedResult).reason?.message),
      /beforeCommit/,
      "故障注入应让 fork 在提交前失败",
    );
    assert.deepEqual(
      results.slice(1).map((result) => result.status),
      ["fulfilled", "fulfilled", "fulfilled", "fulfilled"],
    );
    assert.equal(await store.getSession(CHILD_ID), null);
    assert.equal((await store.getSession(EXISTING_ID))?.title, "independent update");
    assert.equal((await store.getSession(SURVIVOR_ID))?.id, SURVIVOR_ID);
    assert.equal((await store.messages({ sessionID: SURVIVOR_ID }))[0]?.parts[0]?.type, "text");
    assert.equal(
      ((await store.messages({ sessionID: SURVIVOR_ID }))[0]?.parts[0] as { text?: string })?.text,
      HISTORY_MARKER,
    );
  });

  it("同时发起的成功 fork 各自提交，重启后 child 历史仍在", async () => {
    const { store, dbPath, directory } = await openTempStore();
    await store.createSession(sessionInput(PARENT_ID, directory));
    const childIds = [createSessionId("fork-one"), createSessionId("fork-two")];
    const results = await Promise.allSettled(
      childIds.map((id) => store.commitForkBundle(forkBundle(directory, id))),
    );
    assert.deepEqual(
      results.map((result) => result.status),
      ["fulfilled", "fulfilled"],
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopened = openStore(false, dbPath);
    for (const id of childIds) {
      assert.equal((await reopened.getSession(id))?.parentID, PARENT_ID);
      const parts = (await reopened.messages({ sessionID: id }))[0]?.parts ?? [];
      assert.equal((parts[0] as { text?: string; sessionID?: string })?.text, HISTORY_MARKER);
      assert.equal(parts[0]?.sessionID, id);
    }
  });
});
