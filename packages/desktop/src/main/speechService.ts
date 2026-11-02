import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { getZCodeDataRootDir } from "@zcode/services/node";
import {
  type SpeechAssetStatus,
  type SpeechPrepareProgress,
  type SpeechPrepareResult,
} from "@zcode/shared";
import { logger } from "./logger.js";
import { downloadSpeechFile, extractSpeechArchive } from "./speechDownload.js";

const RUNTIME_VERSION = "1.4.3";
const RUNTIME_BASE_URL = `https://github.com/RapidAI/RapidSpeech.cpp/releases/download/v${RUNTIME_VERSION}`;
/** 国内网络访问 GitHub 失败时依次尝试的加速前缀。 */
const RUNTIME_MIRROR_PREFIXES = [
  "https://gh-proxy.com/",
  "https://ghproxy.net/",
  "https://ghfast.top/",
];

interface RuntimeAsset {
  archive: string;
  sha256: string;
  binary: string;
}

/** 官方 RapidSpeech.cpp 预编译包；win/linux 为 CPU，macOS arm64 为 Metal。 */
const RUNTIME_ASSETS: Record<string, RuntimeAsset> = {
  "win32-x64": {
    archive: `rapidspeech-v${RUNTIME_VERSION}-windows-x64-cpu.zip`,
    sha256: "88ed365ef3b84258e36e0717348d68946294bd29ccfa174b9e94a89d374905fc",
    binary: "rs-server.exe",
  },
  "darwin-arm64": {
    archive: `rapidspeech-v${RUNTIME_VERSION}-macos-arm64-metal.tar.gz`,
    sha256: "62c217d3d89378a9ce5f59d83f108dc97c84fd225994212497e708aeb0f34947",
    binary: "rs-server",
  },
  "linux-x64": {
    archive: `rapidspeech-v${RUNTIME_VERSION}-linux-x64-cpu.tar.gz`,
    sha256: "3c49ade064b7bc355bce0c5b50d440446d2595314eeff990bc1ea4c56edad256",
    binary: "rs-server",
  },
  "linux-arm64": {
    archive: `rapidspeech-v${RUNTIME_VERSION}-linux-arm64-cpu.tar.gz`,
    sha256: "313efc62fcbb3a3fd487aaf6a8d723f90f337335da90bfc55bb1fcdd49a2cf4b",
    binary: "rs-server",
  },
};

const XASR_MODEL = {
  url: "https://www.modelscope.cn/models/RapidAI/RapidSpeech/resolve/master/ASR/X-ASR/xasr-q4_k_m.gguf",
  sha256: "f18450bcd94153aebcb5df4894903de1adfa160e095fea4b22486b12bfd3f5b5",
  bytes: 104300800,
  fileName: "xasr-q4_k_m-104300800.gguf",
};

interface RunningSpeechServer {
  child: ChildProcess;
  wsUrl: string;
}

export class DesktopSpeechService {
  private server: RunningSpeechServer | null = null;
  private prepareInFlight: Promise<SpeechPrepareResult> | null = null;
  private assetsInFlight: Promise<SpeechAssetStatus> | null = null;
  private lastAssetError: string | undefined;
  private lastStderr = "";

  constructor(
    private readonly onProgress: (progress: SpeechPrepareProgress) => void = () => {},
  ) {}

  async getStatus(): Promise<SpeechAssetStatus> {
    const key = `${process.platform}-${process.arch}`;
    const asset = RUNTIME_ASSETS[key];
    if (!asset) {
      return {
        supported: false,
        runtimeReady: false,
        modelReady: false,
        ready: false,
        reason: "unsupported_platform",
      };
    }
    const runtimeReady =
      (await this.findFile(
        join(getZCodeDataRootDir(), "speech", "runtime", `${RUNTIME_VERSION}-${key}`),
        asset.binary,
      )) !== null;
    const modelReady =
      (await this.findFile(
        join(getZCodeDataRootDir(), "speech", "models"),
        XASR_MODEL.fileName,
      )) !== null;
    const ready = runtimeReady && modelReady;
    return {
      supported: true,
      runtimeReady,
      modelReady,
      ready,
      ...(!ready && this.lastAssetError ? { reason: this.lastAssetError } : {}),
    };
  }

  async ensureAssets(): Promise<SpeechAssetStatus> {
    if (this.assetsInFlight) return this.assetsInFlight;
    this.assetsInFlight = this.doEnsureAssets().finally(() => {
      this.assetsInFlight = null;
    });
    return this.assetsInFlight;
  }

  async prepare(): Promise<SpeechPrepareResult> {
    if (this.server) {
      return { supported: true, wsUrl: this.server.wsUrl };
    }
    if (this.prepareInFlight) {
      return this.prepareInFlight;
    }
    this.prepareInFlight = this.doPrepare().finally(() => {
      this.prepareInFlight = null;
    });
    return this.prepareInFlight;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.child.kill();
    await new Promise<void>((resolve) => {
      if (server.child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2_000);
      server.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async doEnsureAssets(): Promise<SpeechAssetStatus> {
    const key = `${process.platform}-${process.arch}`;
    const asset = RUNTIME_ASSETS[key];
    if (!asset) {
      return this.getStatus();
    }
    try {
      this.lastAssetError = undefined;
      await this.ensureRuntime(key, asset);
      await this.ensureModel();
      return this.getStatus();
    } catch (error) {
      this.lastAssetError = error instanceof Error ? error.message : "speech_asset_failed";
      logger.error("[speech] asset preparation failed", {
        error: this.lastAssetError,
        stderr: this.lastStderr,
      });
      return this.getStatus();
    }
  }

  private async doPrepare(): Promise<SpeechPrepareResult> {
    const assets = await this.ensureAssets();
    if (!assets.supported) {
      return { supported: false, reason: assets.reason ?? "unsupported_platform" };
    }
    if (!assets.ready) {
      return { supported: false, reason: assets.reason ?? "speech_assets_not_ready" };
    }
    const key = `${process.platform}-${process.arch}`;
    const asset = RUNTIME_ASSETS[key]!;
    try {
      const runtime = await this.ensureRuntime(key, asset);
      const modelPath = await this.ensureModel();
      const wsUrl = await this.startServer(runtime.binary, modelPath);
      return { supported: true, wsUrl };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "speech_prepare_failed";
      logger.error("[speech] prepare failed", { error: reason, stderr: this.lastStderr });
      return { supported: false, reason };
    }
  }

  private async ensureRuntime(
    key: string,
    asset: RuntimeAsset,
  ): Promise<{ directory: string; binary: string }> {
    const root = join(getZCodeDataRootDir(), "speech", "runtime", `${RUNTIME_VERSION}-${key}`);
    const existing = await this.findFile(root, asset.binary);
    if (existing) {
      if (process.platform !== "win32") await chmod(existing, 0o755).catch(() => {});
      return { directory: dirname(existing), binary: existing };
    }

    await mkdir(root, { recursive: true });
    const archivePath = join(root, asset.archive);
    this.emitProgress({ phase: "runtime" });
    try {
      await downloadSpeechFile(
        `${RUNTIME_BASE_URL}/${asset.archive}`,
        archivePath,
        asset.sha256,
        (receivedBytes, totalBytes) =>
          this.emitProgress({
            phase: "runtime",
            receivedBytes,
            totalBytes,
            ...percent(receivedBytes, totalBytes),
          }),
        RUNTIME_MIRROR_PREFIXES,
      );
    } catch (error) {
      logger.error("[speech] runtime download failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("runtime_download_failed");
    }
    try {
      try {
        await extractSpeechArchive(archivePath, root);
      } catch (error) {
        logger.error("[speech] runtime archive extraction failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error("runtime_extract_failed");
      }
    } finally {
      await rm(archivePath, { force: true });
    }
    const extracted = await this.findFile(root, asset.binary);
    if (!extracted) {
      throw new Error(`speech runtime archive is missing ${asset.binary}`);
    }
    if (process.platform !== "win32") await chmod(extracted, 0o755);
    return { directory: dirname(extracted), binary: extracted };
  }

  private async ensureModel(): Promise<string> {
    const root = join(getZCodeDataRootDir(), "speech", "models");
    const modelPath = join(root, XASR_MODEL.fileName);
    const existing = await this.findFile(root, XASR_MODEL.fileName);
    if (existing) return existing;

    await mkdir(root, { recursive: true });
    this.emitProgress({ phase: "model" });
    try {
      await downloadSpeechFile(
        XASR_MODEL.url,
        modelPath,
        XASR_MODEL.sha256,
        (receivedBytes, totalBytes) =>
          this.emitProgress({
            phase: "model",
            receivedBytes,
            totalBytes,
            ...percent(receivedBytes, totalBytes ?? XASR_MODEL.bytes),
          }),
      );
    } catch (error) {
      logger.error("[speech] model download failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("model_download_failed");
    }
    return modelPath;
  }

  private async startServer(binary: string, modelPath: string): Promise<string> {
    if (this.server) return this.server.wsUrl;
    this.emitProgress({ phase: "starting" });
    const httpPort = await freePort();
    let wsPort = await freePort();
    while (wsPort === httpPort) wsPort = await freePort();

    const args = [
      "--asr-model",
      modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(httpPort),
      "--ws-port",
      String(wsPort),
      // Windows/Linux 官方预编译是 CPU 版；macOS arm64 是 Metal 版，交给运行时自动选择。
      ...(process.platform === "darwin" ? [] : ["--cpu"]),
    ];
    const child = spawn(binary, args, {
      cwd: dirname(binary),
      env: speechProcessEnv(binary),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.lastStderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.lastStderr = `${this.lastStderr}${text}`.slice(-4_000);
      if (/ERROR|failed|panic/i.test(text)) logger.warn("[speech] runtime", { line: text.trim() });
    });
    child.once("exit", (code) => {
      logger.info("[speech] runtime exited", { code });
      if (this.server?.child === child) this.server = null;
    });
    this.server = { child, wsUrl: `ws://127.0.0.1:${wsPort}/asr/stream?chunk_len=96` };

    const ready = await waitForHealth(httpPort, 45_000);
    if (!ready) {
      this.server = null;
      child.kill();
      logger.error("[speech] runtime did not become ready", {
        stderr: this.lastStderr.trim() || "timeout",
      });
      throw new Error("runtime_start_failed");
    }
    logger.info("[speech] runtime ready", { wsPort });
    return this.server.wsUrl;
  }

  private async findFile(root: string, name: string): Promise<string | null> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const fullPath = join(root, entry.name);
      if (entry.isFile() && entry.name === name) return fullPath;
      if (entry.isDirectory()) {
        const nested = await this.findFile(fullPath, name);
        if (nested) return nested;
      }
    }
    return null;
  }

  private emitProgress(progress: SpeechPrepareProgress): void {
    this.onProgress(progress);
  }
}

function percent(receivedBytes: number, totalBytes?: number): { percent?: number } {
  return totalBytes && totalBytes > 0
    ? { percent: Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) }
    : {};
}

function speechProcessEnv(binary: string): NodeJS.ProcessEnv {
  if (process.platform === "win32") return process.env;
  const root = dirname(dirname(binary));
  const libraryPath = join(root, "lib");
  return {
    ...process.env,
    ...(process.platform === "darwin"
      ? { DYLD_LIBRARY_PATH: [libraryPath, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(":") }
      : { LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }),
  };
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return true;
    } catch {
      // runtime 仍在加载模型
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}
