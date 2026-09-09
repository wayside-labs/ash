import {
  mcpGetPolicySchema,
  type McpGetPolicyInput,
} from "@agent-rails/contract";
import { fetchMaybePolicy } from "@agent-rails/client";
import type { McpRuntime } from "../config.js";
import { serializePolicy } from "./serialize.js";

export type GetPolicyResponse =
  | ReturnType<typeof serializePolicy>
  | {
      found: false;
      address: string;
    };

export async function handleGetPolicy(
  runtime: McpRuntime,
  rawInput: McpGetPolicyInput,
): Promise<GetPolicyResponse> {
  const input = mcpGetPolicySchema.parse(rawInput);
  const account = await fetchMaybePolicy(runtime.rpc, input.policy);

  if (!account.exists) {
    return { found: false, address: input.policy };
  }

  return serializePolicy(input.policy, account.data);
}
