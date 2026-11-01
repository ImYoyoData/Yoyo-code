import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpeechPrepareProgress } from "@zcode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";

export type SpeechDictationStatus = "idle" | "preparing" | "recording" | "finalizing";

export type SpeechDictationErrorCode =
  | "unsupported"
  | "prepare_failed"
  | "microphone_denied"
  | "connection_failed"
  | "failed";

export interface SpeechDictationError {
  code: SpeechDictationErrorCode;
  detail?: string;
}

export interface SpeechDictationOptions {
  /** 录音开始时输入框里的原始文本。 */
  getBaseText: () => string;
  /** 把「原始文本 + 已识别文本」写回输入框。 */
  applyText: (text: string) => void;
  /** 失败/取消时恢复原始文本。 */
  restoreBaseText: (text: string) => void;
  focusEditor: () => void;
}

export interface SpeechDictationController {
  supported: boolean;
  status: SpeechDictationStatus;
  error: SpeechDictationError | null;
  progress: SpeechPrepareProgress | null;
  /** 已稳定显示的识别文本（partial/final）。 */
  text: string;
  toggle: () => void;
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
}

const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 1_600; // 100ms
const FINAL_TIMEOUT_MS = 8_000;

export function useSpeechDictation(
  options: SpeechDictationOptions,
): SpeechDictationController {
  const platform = useOptionalPlatform();
  const supported = typeof platform?.speechPrepare === "function";
  const [status, setStatus] = useState<SpeechDictationStatus>("idle");
  const [error, setError] = useState<SpeechDictationError | null>(null);
  const [progress, setProgress] = useState<SpeechPrepareProgress | null>(null);
  const [text, setText] = useState("");
  const statusRef = useRef<SpeechDictationStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const baseTextRef = useRef("");
  const lastTextRef = useRef("");
  const chunkRef = useRef<number[]>([]);
  const resamplePosRef = useRef(0);
  const finalTextRef = useRef<string | null>(null);
  const finalResolveRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setStatusBoth = useCallback((next: SpeechDictationStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const cleanup = useCallback(() => {
    const processor = processorRef.current;
    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
    }
    sourceRef.current?.disconnect();
    sinkRef.current?.disconnect();
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    const context = audioContextRef.current;
    if (context && context.state !== "closed") void context.close();
    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    wsRef.current = null;
    mediaRef.current = null;
    audioContextRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    sinkRef.current = null;
    chunkRef.current = [];
    resamplePosRef.current = 0;
    finalResolveRef.current = null;
    finalTextRef.current = null;
  }, []);

  const finish = useCallback(
    (finalText: string) => {
      const base = baseTextRef.current;
      if (finalText.trim().length > 0) {
        const combined = joinDictation(base, finalText);
        optionsRef.current.applyText(combined);
        lastTextRef.current = combined;
        setText(finalText);
      }
      cleanup();
      setStatusBoth("idle");
      optionsRef.current.focusEditor();
    },
    [cleanup, setStatusBoth],
  );

  const fail = useCallback(
    (code: SpeechDictationErrorCode, detail?: string) => {
      const base = baseTextRef.current;
      if (base) optionsRef.current.restoreBaseText(base);
      cleanup();
      setStatusBoth("idle");
      setText("");
      setError({ code, ...(detail ? { detail } : {}) });
    },
    [cleanup, setStatusBoth],
  );

  const flushChunk = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const chunk = chunkRef.current;
    if (chunk.length === 0) return;
    const buffer = new Int16Array(chunk);
    chunkRef.current = [];
    ws.send(buffer.buffer);
  }, []);

  const appendSamples = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      const step = sampleRate / TARGET_SAMPLE_RATE;
      const chunk = chunkRef.current;
      if (step === 1) {
        for (let index = 0; index < samples.length; index += 1) {
          chunk.push(toInt16(samples[index] ?? 0));
          if (chunk.length >= CHUNK_SAMPLES) flushChunk();
        }
        return;
      }
      let position = resamplePosRef.current;
      while (position < samples.length) {
        const index = Math.floor(position);
        const fraction = position - index;
        const current = samples[index] ?? 0;
        const next = samples[index + 1] ?? current;
        chunk.push(toInt16(current + (next - current) * fraction));
        if (chunk.length >= CHUNK_SAMPLES) flushChunk();
        position += step;
      }
      resamplePosRef.current = position - samples.length;
    },
    [flushChunk],
  );

  const start = useCallback(async () => {
    if (statusRef.current !== "idle" || !platform?.speechPrepare) return;
    setError(null);
    setProgress(null);
    setText("");
    setStatusBoth("preparing");
    const unsubscribe = platform.onSpeechProgress?.((next) => setProgress(next));
    try {
      const prepared = await platform.speechPrepare();
      setProgress(null);
      if (!prepared.supported || !prepared.wsUrl) {
        fail("prepare_failed", prepared.reason);
        return;
      }

      const ws = new WebSocket(prepared.wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      const ready = waitForSocketReady(ws);
      ws.addEventListener("message", (event) => {
        const payload = parseServerMessage(event.data);
        if (!payload) return;
        if (payload.type === "partial") {
          const partial = payload.text ?? "";
          const combined = joinDictation(baseTextRef.current, partial);
          optionsRef.current.applyText(combined);
          lastTextRef.current = combined;
          setText(partial);
        } else if (payload.type === "final") {
          const finalText = payload.text ?? lastTextRef.current;
          finalTextRef.current = finalText;
          finalResolveRef.current?.();
        } else if (payload.type === "error") {
          fail("failed", payload.message);
        }
      });
      ws.addEventListener("error", () => fail("connection_failed"));

      const readyOk = await ready;
      if (!readyOk) {
        fail("connection_failed");
        return;
      }

      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaRef.current = media;
      const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(media);
      sourceRef.current = source;
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const sink = context.createGain();
      sink.gain.value = 0;
      sinkRef.current = sink;
      processor.onaudioprocess = (event) => {
        appendSamples(event.inputBuffer.getChannelData(0), context.sampleRate);
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);

      baseTextRef.current = optionsRef.current.getBaseText();
      lastTextRef.current = baseTextRef.current;
      resamplePosRef.current = 0;
      setStatusBoth("recording");
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      fail(name === "NotAllowedError" || name === "SecurityError" ? "microphone_denied" : "failed",
        caught instanceof Error ? caught.message : String(caught));
    } finally {
      unsubscribe?.();
      setProgress(null);
    }
  }, [appendSamples, fail, platform, setStatusBoth]);

  const stop = useCallback(() => {
    if (statusRef.current !== "recording") return;
    setStatusBoth("finalizing");
    flushChunk();
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      finish(lastTextRef.current);
      return;
    }
    const completed = new Promise<void>((resolve) => {
      finalResolveRef.current = resolve;
    });
    ws.send(JSON.stringify({ type: "eos" }));
    void Promise.race([
      completed,
      new Promise<void>((resolve) => setTimeout(resolve, FINAL_TIMEOUT_MS)),
    ]).then(() => {
      const finalText = finalTextRef.current;
      finish(finalText ?? lastTextRef.current);
    });
  }, [finish, flushChunk, setStatusBoth]);

  const cancel = useCallback(() => {
    if (statusRef.current === "idle") return;
    fail("failed");
  }, [fail]);

  const toggle = useCallback(() => {
    if (statusRef.current === "recording") stop();
    else if (statusRef.current === "idle") void start();
  }, [start, stop]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    supported,
    status,
    error,
    progress,
    text,
    toggle,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}

function toInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * 32767);
}

function joinDictation(base: string, text: string): string {
  if (!text) return base;
  if (!base) return text;
  const baseEndsWithSpace = /\s$/u.test(base);
  const lastChar = base.at(-1) ?? "";
  const firstChar = text.at(0) ?? "";
  const baseIsCjk = /[\u3000-\u9fff\uff00-\uffef]/u.test(lastChar);
  const textIsCjkPunctuation = /[\u3000-\u9fff\uff00-\uffef]/u.test(firstChar);
  return baseEndsWithSpace || baseIsCjk || textIsCjkPunctuation ? `${base}${text}` : `${base} ${text}`;
}

function parseServerMessage(data: unknown): { type?: string; text?: string; message?: string } | null {
  try {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
    return JSON.parse(text) as { type?: string; text?: string; message?: string };
  } catch {
    return null;
  }
}

function waitForSocketReady(ws: WebSocket): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve(true);
      return;
    }
    const timeout = setTimeout(() => resolve(false), 10_000);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        resolve(false);
      },
      { once: true },
    );
  });
}
