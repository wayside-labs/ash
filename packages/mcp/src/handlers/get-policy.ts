import { fetchMaybePolicy } from "@agent-rails/client";
import { describeSecurity } from "@agent-rails/contract";
import type { ServerContext } from "../context.js";
import { serializePolicy } from "./serialize.js";

export type GetPolicyResponse =
  | (ReturnType<typeof serializePolicy> & {
      guard_rails: { preset: string; summary: string[] };
    })
  | { found: false; address: string };

/**
 * Read the bound policy. The address is not a parameter (blueprint I-1).
 *
 * The response also describes the off-chain posture, so a caller can see what will be
 * refused before it is refused — that a memo is needed above a threshold, or that a dry run
 * has to come first. Publishing the rules is not a leak: they are constraints on the caller,
 * and an agent that knows them wastes fewer attempts.
 */
export async function handleGetPolicy(context: ServerContext): Promise<GetPolicyResponse> {
  const address = context.bound.policy;
  const account = await fetchMaybePolicy(context.runtime.rpc, address);

  if (!account.exists) {
    return { found: false, address };
  }

  return {
    ...serializePolicy(address, account.data),
    guard_rails: {
      preset: context.security.preset,
      summary: describeSecurity(context.security.posture),
    },
  };
}
