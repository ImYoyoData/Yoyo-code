import type { ZCodeAccountAccess, ZCodeProviderAccountAccess } from "@zcode/shared";
import {
  AccountRequestCredentialUnavailableError,
  type AccountAccessIdentityInput,
  type AccountRequestAuthInput,
  type AccountRequestAuthMaterial,
} from "./accountProviderRequestAuthService.js";
import type { IAccountRequestAuthService } from "./accountRequestAuthService.js";

/**
 * 无账号体系下的账号请求鉴权实现。
 *
 * Yoyo Code 只使用用户自备的自定义 / API-Key Provider，不存在账号连接，
 * 因此这里恒定表示「没有账号可用」：
 * - `resolveAccessCurrent` 一律返回 null，调用方按未连接处理；
 * - `resolveCurrent` 返回空材料（没有 apiKey、没有账号头）；
 * - `assertCurrent` 直接抛 `AccountRequestCredentialUnavailableError`，
 *   它的语义就是「该 Provider 需要账号而当前没有」。
 *
 * 这几个返回值不是兜底分支：账号能力在本分支不存在，所以它们就是唯一实现。
 */
export function createNoAccountRequestAuthService(): IAccountRequestAuthService {
  return {
    async resolveAccessCurrent(
      _access: ZCodeProviderAccountAccess,
    ): Promise<ZCodeAccountAccess | null> {
      return null;
    },
    async resolveCurrent(_input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial> {
      return {};
    },
    async assertCurrent(input: AccountAccessIdentityInput): Promise<void> {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    },
  };
}
