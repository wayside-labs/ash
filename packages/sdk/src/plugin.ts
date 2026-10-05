import type { Address, TransactionPartialSigner } from "@solana/kit";
import { type AshSecurityConfig, type ResolvedSecurity, resolveSecurity } from "./security.js";

export type AshSigner = TransactionPartialSigner;

export type AshPluginConfig = {
  session: Address;
  signer: AshSigner;
  /**
   * Off-chain guard-rails. Defaults to the `balanced` preset.
   *
   * Nothing here can widen what the program permits; it decides how much this client
   * refuses on its own before the chain is asked. See `@ash/contract`'s
   * `IMMUTABLE_GUARANTEES` for the properties no posture may weaken.
   */
  security?: AshSecurityConfig;
};

export type AshPlugin = {
  session: Address;
  signer: AshSigner;
  security: ResolvedSecurity;
};

/**
 * Kit plugin entry point: `client.use(ash({ session, signer, security }))`.
 *
 * The posture is resolved here rather than at first use, so a malformed override is a
 * startup error in the developer's face instead of a surprise on the first payment.
 */
export function ash(config: AshPluginConfig): AshPlugin {
  return {
    session: config.session,
    signer: config.signer,
    security: resolveSecurity(config.security),
  };
}
