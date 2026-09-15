import { fetchMaybePolicy } from "@agent-rails/client";
import type { ServerContext } from "../context.js";
import { serializePolicy } from "./serialize.js";

export type GetPolicyResponse =
  | ReturnType<typeof serializePolicy>
  | { found: false; address: string };

/** Read the bound policy. The address is not a parameter (blueprint I-1). */
export async function handleGetPolicy(context: ServerContext): Promise<GetPolicyResponse> {
  const address = context.bound.policy;
  const account = await fetchMaybePolicy(context.runtime.rpc, address);

  if (!account.exists) {
    return { found: false, address };
  }
  return serializePolicy(address, account.data);
}
