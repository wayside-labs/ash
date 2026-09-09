import {
  mcpGetSessionSchema,
  type McpGetSessionInput,
} from "@agent-rails/contract";
import { fetchMaybeAgentSession } from "@agent-rails/client";
import type { McpRuntime } from "../config.js";
import { serializeAgentSession } from "./serialize.js";

export type GetSessionResponse =
  | ReturnType<typeof serializeAgentSession>
  | {
      found: false;
      address: string;
    };

export async function handleGetSession(
  runtime: McpRuntime,
  rawInput: McpGetSessionInput,
): Promise<GetSessionResponse> {
  const input = mcpGetSessionSchema.parse(rawInput);
  const account = await fetchMaybeAgentSession(runtime.rpc, input.session);

  if (!account.exists) {
    return { found: false, address: input.session };
  }

  return serializeAgentSession(input.session, account.data);
}
