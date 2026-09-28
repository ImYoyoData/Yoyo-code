// GitHubProvider 没有从 electron-updater 包根导出，只能走子路径；该包未声明 exports 字段。
// 扩展名必须写全：main 是 ESM 产物，tsup 会把依赖保留为外部 import，
// 而 Node 的 ESM 解析器不补扩展名——省略 .js 会让安装包启动即 ERR_MODULE_NOT_FOUND。
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import {
  resolveNewBlockMapUrl,
  resolveOldBlockMapUrl,
} from "./differentialBlockMapUrl.js";

/**
 * 修正旧 blockmap 地址的 GitHub provider。
 *
 * 上游只替换文件名里的版本号，旧 blockmap 会去新 Release 的 tag 目录下找，404 之后
 * `AppUpdater.differentialDownloadInstaller` 捕获异常并整包下载——表现就是「每次都全量」。
 * 这里把 tag 段一起换成旧版本，让差分真正走通。
 */
export class DifferentialGitHubProvider extends GitHubProvider {
  override getBlockMapFiles(
    baseUrl: URL,
    oldVersion: string,
    newVersion: string,
    oldBlockMapFileBaseUrl: string | null = null,
  ): URL[] {
    // previousBlockmapBaseUrlOverride 只是 electron-updater 的测试钩子，交给上游处理。
    if (oldBlockMapFileBaseUrl) {
      return super.getBlockMapFiles(baseUrl, oldVersion, newVersion, oldBlockMapFileBaseUrl);
    }
    const oldBlockMapUrl = resolveOldBlockMapUrl(baseUrl, oldVersion, newVersion);
    if (!oldBlockMapUrl) {
      return super.getBlockMapFiles(baseUrl, oldVersion, newVersion, oldBlockMapFileBaseUrl);
    }
    return [oldBlockMapUrl, resolveNewBlockMapUrl(baseUrl)];
  }
}
