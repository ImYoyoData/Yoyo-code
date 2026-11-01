/**
 * sendQueuedGuide 回归：
 * - guide 成功：reserve 原项 → 以新 commandId 走 guide admission → 删除原项；
 * - admission 拒绝：释放 reservation，原项保留；
 * - compact / goal 项拒绝，不进入 reserve。
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { NATIVE_HANDLERS } from "../src/zcode-protocol-v4/commands/handlers/index.js";
import type { V4CommandCoreHost } from "../src/zcode-protocol-v4/commands/types.js";

const ORIGINAL_ITEM_ID = "queue_original";
const COMMAND_ID = "cmd-guide";

function queueItem(kind: "sendText" | "compact" | "sendGoalCommand" = "sendText") {
  return {
    queueItemId: ORIGINAL_ITEM_ID,
    sourceCommandId: "cmd-original",
    clientId: "desktop",
    kind,
    text: "hello",
    attachments: [],
    delivery: { requested: "queue", admitted: "queue" },
    order: { admissionSeq: 1, queuePosition: 0 },
    steer: { state: "notRequested" },
    dispatch: { state: "queued" },
    admittedAt: Date.now(),
    provenance: { sourceCommandId: "cmd-earlier" },
  };
}

function envelope(type: "sendQueuedGuide" = "sendQueuedGuide"): CommandEnvelope {
  return {
    commandId: COMMAND_ID,
    clientId: "desktop",
    sessionId: "sess_1",
    baseRevision: 1,
    type,
    payload: { queueItemId: ORIGINAL_ITEM_ID },
    issuedAt: Date.now(),
  };
}

function makeHost(
  item: ReturnType<typeof queueItem>,
  sendInputResult: Record<string, unknown>,
) {
  const calls = {
    reserve: [] as Array<[string, string]>,
    release: [] as Array<[string, string]>,
    remove: [] as Array<[string, Record<string, unknown> | undefined]>,
    sendInput: [] as Array<[unknown, Record<string, unknown>]>,
  };
  const record = {
    app: {
      sessionId: "sess_1",
      reserveQueueItem: async (pendingInputId: string, reservationId: string) => {
        calls.reserve.push([pendingInputId, reservationId]);
        return true;
      },
      releaseQueueItemReservation: async (pendingInputId: string, reservationId: string) => {
        calls.release.push([pendingInputId, reservationId]);
        return true;
      },
      removeQueueItem: async (
        pendingInputId: string,
        options?: Record<string, unknown>,
      ) => {
        calls.remove.push([pendingInputId, options]);
        return true;
      },
      sendInput: async (input: unknown, options: Record<string, unknown>) => {
        calls.sendInput.push([input, options]);
        return sendInputResult;
      },
    },
    traceContext: { traceId: "trace_1", sessionId: "sess_1" },
    workspace: { workspacePath: "D:/work" },
    persistence: "immediate" as const,
  };
  const host = {
    getRecord: () => record,
    getQueueItem: () => item,
  } as unknown as V4CommandCoreHost;
  return { host, calls };
}

test("guide 成功：以新 commandId 注入 guide，并删除原队列项", async () => {
  const { host, calls } = makeHost(queueItem(), {
    kind: "queued",
    pendingInputId: `queue_${COMMAND_ID}`,
    queueLength: 1,
    turnId: "turn_1",
  });

  await NATIVE_HANDLERS.sendQueuedGuide(host, envelope());

  assert.deepEqual(calls.reserve, [[ORIGINAL_ITEM_ID, COMMAND_ID]]);
  assert.equal(calls.sendInput.length, 1);
  const [input, options] = calls.sendInput[0]!;
  assert.deepEqual(input, { text: "hello" });
  assert.equal(options.delivery, "start_turn");
  assert.equal(options.queueDelivery, "guide");
  assert.equal(options.inputId, COMMAND_ID);
  const intent = options.intent as Record<string, unknown>;
  assert.equal(intent.requestedDelivery, "guide");
  assert.equal(intent.admittedDelivery, "guide");
  // 新 admission 必须换新 id，原 queueItemId 只留在 provenance，避免删除时误删 guide。
  assert.equal(intent.queueItemId, `queue_${COMMAND_ID}`);
  assert.notEqual(intent.queueItemId, ORIGINAL_ITEM_ID);
  assert.deepEqual(intent.provenance, { sourceCommandId: "cmd-earlier" });

  assert.equal(calls.remove.length, 1);
  assert.equal(calls.remove[0]![0], ORIGINAL_ITEM_ID);
  assert.equal(calls.remove[0]![1]?.reason, "promoted");
  assert.equal(calls.remove[0]![1]?.reservationId, COMMAND_ID);
  assert.equal(calls.release.length, 0);
});

test("admission 拒绝：释放 reservation 且保留原项", async () => {
  const { host, calls } = makeHost(queueItem(), {
    kind: "rejected",
    reason: "turn_not_steerable",
  });

  await assert.rejects(() => NATIVE_HANDLERS.sendQueuedGuide(host, envelope()), /rejected/i);
  assert.deepEqual(calls.release, [[ORIGINAL_ITEM_ID, COMMAND_ID]]);
  assert.equal(calls.remove.length, 0);
});

test("compact / goal 项不支持引导，直接拒绝且不 reserve", async () => {
  for (const kind of ["compact", "sendGoalCommand"] as const) {
    const { host, calls } = makeHost(queueItem(kind), { kind: "queued" });
    await assert.rejects(
      () => NATIVE_HANDLERS.sendQueuedGuide(host, envelope()),
      /only supports sendText/,
    );
    assert.equal(calls.reserve.length, 0);
    assert.equal(calls.sendInput.length, 0);
  }
});
