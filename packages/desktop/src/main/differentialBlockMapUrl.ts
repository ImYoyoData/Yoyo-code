/**
 * 差分更新要同时下载新旧两个 blockmap，地址拼错就会退回整包下载。
 *
 * electron-updater 上游的 `Provider.getBlockMapFiles` 只把 URL 路径里的版本号替换成旧版本，
 * 基址仍指向新 Release 的 tag 目录，于是它请求的是
 * `.../releases/download/v<新版本>/<文件名含旧版本>.blockmap`——这个地址必然 404。
 *
 * GitHub Release 的下载路径形如 `/{owner}/{repo}/releases/download/{tag}/{file}`，
 * 版本号同时出现在 tag 段和文件名里，两处都要替换才会落到旧 Release。
 * 线上验证：`v3.15.5/Yoyo-Code-3.15.4-win-x64.exe.blockmap` 返回 404，
 * 而 `v3.15.4/Yoyo-Code-3.15.4-win-x64.exe.blockmap` 返回 200。
 */

/** GitHub Release 资产下载路径里，tag 段紧跟在这个片段之后。 */
const RELEASE_DOWNLOAD_SEGMENT = "download";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** 读取下载路径里的 Release tag；路径不是 Release 下载地址时返回 null。 */
function readReleaseTag(pathname: string): string | null {
  const segments = pathname.split("/");
  const downloadIndex = segments.lastIndexOf(RELEASE_DOWNLOAD_SEGMENT);
  if (downloadIndex < 0) return null;
  return segments[downloadIndex + 1] ?? null;
}

/**
 * 解析旧版本 blockmap 的绝对地址。
 *
 * tag 里不含新版本号时说明无法推导旧版本所在目录（例如 tag 是 `stable` 这类固定名），
 * 返回 null 让调用方保留上游行为——此时和修复前一样会退回整包，但不会拼出错误的地址。
 */
export function resolveOldBlockMapUrl(
  baseUrl: URL,
  oldVersion: string,
  newVersion: string,
): URL | null {
  const tag = readReleaseTag(baseUrl.pathname);
  if (!tag?.includes(newVersion)) return null;
  const oldPath = baseUrl.pathname.replace(
    new RegExp(escapeForRegExp(newVersion), "gu"),
    oldVersion,
  );
  return new URL(`${oldPath}.blockmap`, baseUrl);
}

/** 新版本 blockmap 的绝对地址。 */
export function resolveNewBlockMapUrl(baseUrl: URL): URL {
  return new URL(`${baseUrl.pathname}.blockmap`, baseUrl);
}
