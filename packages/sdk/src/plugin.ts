import type { Address, TransactionPartialSigner } from "@solana/kit";
import type { PolicyHooks } from "./policy-hooks.js";

export type AgentRailsSigner = TransactionPartialSigner;

export type AgentRailsPluginConfig = {
  session: Address;
  signer: AgentRailsSigner;
  hooks?: PolicyHooks;
};

export type AgentRailsPlugin = {
  session: Address;
  signer: AgentRailsSigner;
  hooks: PolicyHooks;
};

/** Kit plugin entry point: `client.use(agentRails({ session, signer }))`. */
export function agentRails(config: AgentRailsPluginConfig): AgentRailsPlugin {
  return {
    session: config.session,
    signer: config.signer,
    hooks: config.hooks ?? {},
  };
}
