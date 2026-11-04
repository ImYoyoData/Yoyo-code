/**
 * 「清空会话记录」= 只隐藏显示，不删数据。
 *
 * 语义约束：边界之前（含边界消息）的记录不再进入 conversation 投影，
 * 但 session store 里的 message 一条不删——runtime 的 messageHistory 与
 * provider 上下文因此完整保留。这里锁住边界裁剪本身与它的安全退化。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_ENTRY_TRANSCRIPT_VISIBILITY_BOUNDARY,
  type MessageWithParts,
  type SessionEntryInfo,
  type SessionId,
} from "@zcode/contracts";
import { hideMessagesBeforeVisibilityBoundary } from "../src/zcode-protocol-v4/cold-event-merge.js";

const SESSION = "sess_visibility" as SessionId;

function message(id: string): MessageWithParts {
  return {
    info: {
      id: id as MessageWithParts["info"]["id"],
      sessionID: SESSION,
      role: "user",
      agent: "build",
      time: { created: 0 },
    },
    parts: [],
  } as MessageWithParts;
}

function boundaryEntry(hiddenBeforeMessageID: unknown): SessionEntryInfo {
  return {
    id: `${SESSION_ENTRY_TRANSCRIPT_VISIBILITY_BOUNDARY}:${SESSION}`,
    sessionID: SESSION,
    type: SESSION_ENTRY_TRANSCRIPT_VISIBILITY_BOUNDARY,
    time: { created: 0, updated: 0 },
    data: { hiddenBeforeMessageID },
  };
}

describe("hideMessagesBeforeVisibilityBoundary", () => {
  const messages = [message("m1"), message("m2"), message("m3")];

  it("没有边界时原样返回全部消息", () => {
    assert.deepEqual(
      hideMessagesBeforeVisibilityBoundary(messages, []).map((m) => m.info.id),
      ["m1", "m2", "m3"],
    );
  });

  it("边界之前的记录被隐藏，边界之后仍可见", () => {
    assert.deepEqual(
      hideMessagesBeforeVisibilityBoundary(messages, [boundaryEntry("m2")]).map(
        (m) => m.info.id,
      ),
      ["m3"],
    );
  });

  it("边界是最后一条消息时界面为空", () => {
    assert.deepEqual(hideMessagesBeforeVisibilityBoundary(messages, [boundaryEntry("m3")]), []);
  });

  it("边界消息找不到时安全退化为全部显示", () => {
    assert.deepEqual(
      hideMessagesBeforeVisibilityBoundary(messages, [boundaryEntry("missing")]).map(
        (m) => m.info.id,
      ),
      ["m1", "m2", "m3"],
    );
  });

  it("非法边界值不生效", () => {
    for (const value of [undefined, null, "", 42, {}]) {
      assert.equal(
        hideMessagesBeforeVisibilityBoundary(messages, [boundaryEntry(value)]).length,
        3,
      );
    }
  });

  it("多次清空以最后一次边界为准", () => {
    assert.deepEqual(
      hideMessagesBeforeVisibilityBoundary(messages, [
        boundaryEntry("m1"),
        boundaryEntry("m2"),
      ]).map((m) => m.info.id),
      ["m3"],
    );
  });

  it("返回新数组，不修改入参（store 数据保持完整）", () => {
    const input = [...messages];
    hideMessagesBeforeVisibilityBoundary(input, [boundaryEntry("m1")]);
    assert.equal(input.length, 3);
  });
});
