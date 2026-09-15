import type { Address, TransactionPartialSigner } from "@solana/kit";
import {
  type AgentRailsSecurityConfig,
  type ResolvedSecurity,
  resolveSecurity,
} from "./security.js";

export type AgentRailsSigner = TransactionPartialSigner;

export type AgentRailsPluginConfig = {
  session: Address;
  signer: AgentRailsSigner;
  /**
   * Off-chain guard-rails. Defaults to the `balanced` preset.
   *
   * Nothing here can widen what the program permits; it decides how much this client
   * refuses on its own before the chain is asked. See `@agent-rails/contract`'s
   * `IMMUTABLE_GUARANTEES` for the properties no posture may weaken.
   */
  security?: AgentRailsSecurityConfig;
};

export type AgentRailsPlugin = {
  session: Address;
  signer: AgentRailsSigner;
  security: ResolvedSecurity;
};

/**
 * Kit plugin entry point: `client.use(agentRails({ session, signer, security }))`.
 *
 * The posture is resolved here rather than at first use, so a malformed override is a
 * startup error in the developer's face instead of a surprise on the first payment.
 */
export function agentRails(config: AgentRailsPluginConfig): AgentRailsPlugin {
  return {
    session: config.session,
    signer: config.signer,
    security: resolveSecurity(config.security),
  };
}
