import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export type SpeechDownloadProgress = (receivedBytes: number, totalBytes?: number) => void;

/**
 * 下载语音运行时/模型并校验 SHA256。
 *
 * Node fetch 默认不读 env proxy；宿主环境设置了 http_proxy 时可能连不上 GitHub。
 * 系统 curl 能复用用户代理配置，因此 fetch 失败时用 curl 重试一次。
 */
export async function downloadSpeechFile(
  url: string,
  destination: string,
  expectedSha256: string,
  onProgress: SpeechDownloadProgress,
): Promise<void> {
  try {
    await downloadWithFetch(url, destination, expectedSha256, onProgress);
  } catch (error) {
    logger.warn("[speech] fetch download failed; retrying with curl", {
      error: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error && error.cause ? String(error.cause) : "",
    });
    await downloadWithCurl(url, destination, expectedSha256, onProgress);
  }
}

export async function extractSpeechArchive(
  archivePath: string,
  destination: string,
): Promise<void> {
  if (process.platform === "win32") {
    // Git Bash 的 GNU tar 不能解 zip；优先用 Windows 自带的 bsdtar（System32），再降级 PowerShell。
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    try {
      await execFileAsync(join(systemRoot, "System32", "tar.exe"), [
        "-xf",
        archivePath,
        "-C",
        destination,
      ], { windowsHide: true, timeout: 120_000 });
      return;
    } catch {
      const escape = (value: string) => value.replace(/'/g, "''");
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -Force -LiteralPath '${escape(archivePath)}' -DestinationPath '${escape(destination)}'`,
        ],
        { windowsHide: true, timeout: 120_000 },
      );
      return;
    }
  }
  await execFileAsync("tar", ["-xzf", archivePath, "-C", destination], { timeout: 120_000 });
}

async function downloadWithFetch(
  url: string,
  destination: string,
  expectedSha256: string,
  onProgress: SpeechDownloadProgress,
): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "YoyoCode-Desktop" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`speech download failed: HTTP ${response.status}`);
  }
  const totalBytes = numberOrUndefined(response.headers.get("content-length"));
  const partPath = `${destination}.part`;
  await mkdir(dirname(destination), { recursive: true });
  const hash = createHash("sha256");
  const output = createWriteStream(partPath);
  const reader = response.body.getReader();
  let receivedBytes = 0;
  let lastReport = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      receivedBytes += buffer.byteLength;
      hash.update(buffer);
      if (!output.write(buffer)) await once(output, "drain");
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        onProgress(receivedBytes, totalBytes);
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    output.destroy();
    await rm(partPath, { force: true });
    throw error;
  }
  onProgress(receivedBytes, totalBytes);
  await verifyAndCommit(partPath, destination, hash.digest("hex"), expectedSha256);
}

async function downloadWithCurl(
  url: string,
  destination: string,
  expectedSha256: string,
  onProgress: SpeechDownloadProgress,
): Promise<void> {
  const partPath = `${destination}.part`;
  await mkdir(dirname(destination), { recursive: true });
  await rm(partPath, { force: true });
  onProgress(0);
  const curl =
    process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "curl.exe")
      : "curl";
  try {
    await execFileAsync(
      curl,
      ["-fL", "--retry", "2", "--retry-delay", "1", "--connect-timeout", "30", "-o", partPath, url],
      { windowsHide: true, timeout: 600_000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
  onProgress(0);
  await verifyAndCommit(partPath, destination, await sha256File(partPath), expectedSha256);
}

async function verifyAndCommit(
  partPath: string,
  destination: string,
  actualSha256: string,
  expectedSha256: string,
): Promise<void> {
  if (actualSha256 !== expectedSha256) {
    await rm(partPath, { force: true });
    throw new Error(`speech download checksum mismatch: ${actualSha256}`);
  }
  await rename(partPath, destination);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function numberOrUndefined(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
