/**
 * 主进程语音服务集成测试（需要网络下载约 116MB 运行时+模型）：
 *   YOYO_SPEECH_E2E=1 node --import tsx --test packages/desktop/test/speechService.integration.test.ts
 *
 * 覆盖：运行时/模型下载与 SHA256、tar 解压、rs-server 启动、WebSocket 流式 partial/final。
 * 默认跳过，避免 CI 拉取大文件。
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ENABLED = process.env.YOYO_SPEECH_E2E === "1";

test("speech service prepares runtime/model and streams X-ASR text", { skip: !ENABLED, timeout: 300_000 }, async (t) => {
  const base = await mkdtemp(join(tmpdir(), "yoyo-speech-e2e-"));
  process.env.ZCODE_DATA_BASE_DIR = base;
  const progress = [];
  const { DesktopSpeechService } = await import("../src/main/speechService.js");
  const service = new DesktopSpeechService((entry) => progress.push(entry));
  t.after(async () => {
    await service.stop();
    await rm(base, { recursive: true, force: true });
  });

  const prepared = await service.prepare();
  assert.equal(prepared.supported, true, prepared.reason);
  assert.match(prepared.wsUrl ?? "", /^ws:\/\/127\.0\.0\.1:\d+\/asr\/stream\?chunk_len=96$/);
  assert.ok(progress.some((entry) => entry.phase === "runtime"));
  assert.ok(progress.some((entry) => entry.phase === "model"));

  const pcm = await readTestPcm();
  const messages = await streamPcm(prepared.wsUrl!, pcm);
  const final = messages.filter((m) => m.type === "final").at(-1);
  assert.ok(messages.some((m) => m.type === "partial"), "expected partial messages");
  assert.match(final?.text ?? "", /昨天是 Monday/u);
  assert.match(final?.text ?? "", /星期三/u);
  console.log("transcript:", final?.text);
});

async function streamPcm(wsUrl: string, pcm: Buffer) {
  const ws = new WebSocket(wsUrl);
  const messages: Array<{ type?: string; text?: string }> = [];
  const finalPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASR final timeout")), 30_000);
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(
        typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data),
      ) as { type?: string; text?: string };
      messages.push(payload);
      if (payload.type === "final") {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ASR WebSocket error"));
    });
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("ASR WebSocket open failed")), {
      once: true,
    });
  });
  for (let offset = 0; offset < pcm.length; offset += 3_200) {
    ws.send(pcm.subarray(offset, Math.min(offset + 3_200, pcm.length)));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  ws.send(JSON.stringify({ type: "eos" }));
  await finalPromise;
  ws.close();
  return messages;
}

/** 16k mono s16le；测试音频由 Windows SAPI 生成后离线重采样得到。 */
async function readTestPcm(): Promise<Buffer> {
  const wavPath =
    process.env.YOYO_SPEECH_E2E_WAV ??
    join(tmpdir(), "xasr-test-zh.wav");
  const wav = await readFile(wavPath);
  if (wav.toString("ascii", 0, 4) !== "RIFF") throw new Error(`not a wav: ${wavPath}`);
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = wav.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      format = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === "data") data = body;
    offset += 8 + size + (size % 2);
  }
  if (!format || !data || format.format !== 1 || format.bits !== 16) {
    throw new Error("unsupported test wav (expect PCM16)");
  }
  const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
  const mono =
    format.channels === 1 ? samples : downmix(samples, format.channels);
  if (format.channels === 1 && format.sampleRate === 16_000) {
    return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  }
  const ratio = format.sampleRate / 16_000;
  const output = Buffer.alloc(Math.floor(mono.length / ratio) * 2);
  for (let index = 0; index < output.length / 2; index += 1) {
    const position = index * ratio;
    const first = Math.floor(position);
    const second = Math.min(first + 1, mono.length - 1);
    const fraction = position - first;
    const value = mono[first] * (1 - fraction) + mono[second] * fraction;
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(value))), index * 2);
  }
  return output;
}

function downmix(samples: Int16Array, channels: number): Float32Array {
  const mono = new Float32Array(samples.length / channels);
  for (let index = 0; index < mono.length; index += 1) {
    let value = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      value += samples[index * channels + channel];
    }
    mono[index] = value / channels;
  }
  return mono;
}
