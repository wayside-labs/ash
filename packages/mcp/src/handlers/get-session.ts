import { fetchMaybeAgentSession } from "@agent-rails/client";
import type { ServerContext } from "../context.js";
import { serializeAgentSession } from "./serialize.js";

export type GetSessionResponse =
  | ReturnType<typeof serializeAgentSession>
  | { found: false; address: string };

/** Read the bound session. The address is not a parameter (blueprint I-1). */
export async function handleGetSession(context: ServerContext): Promise<GetSessionResponse> {
  const address = context.bound.session;
  const account = await fetchMaybeAgentSession(context.runtime.rpc, address);

  if (!account.exists) {
    return { found: false, address };
  }
  return serializeAgentSession(address, account.data);
}
