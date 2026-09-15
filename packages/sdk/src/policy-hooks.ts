import type { AnyReasonCode } from "@agent-rails/contract";
import type { Address } from "@solana/kit";
import { AgentRailsError } from "./errors.js";

/**
 * Soft policy hooks (ADR-005 section 6; blueprint L4).
 *
 * Contextual rules the chain cannot see: whether an invoice is still open, whether it is a
 * business day, whether this task has spent its share. They are defence in depth and not
 * the guarantee — the program remains the authority — but a layer that is skipped is not
 * defence in anything, and these were previously exported without ever being called.
 *
 * A hook that times out or throws denies. The alternative is a payment system whose
 * controls evaporate under load, which is when it matters most; `failOpen` exists for the
 * genuinely advisory hook and is a deliberate per-hook decision, never a default.
 */

export type PolicyHookRequest = {
  session: Address;
  policy: Address;
  intentId: string;
  destination: Address;
  destinationLabel?: string;
  mint: Address;
  amount: bigint;
  reference: string;
  memo?: string;
};

export type HookVerdict =
  | { allow: true }
  | { allow: false; reasonCode?: AnyReasonCode; message?: string };

export type PolicyHook = {
  name: string;
  /** Milliseconds before the hook is treated as unavailable. Default 2000. */
  timeoutMs?: number;
  /** Advisory hooks may permit on failure. Everything else denies. Default false. */
  failOpen?: boolean;
  evaluate(request: PolicyHookRequest): Promise<HookVerdict> | HookVerdict;
};

export type PolicyHooks = {
  beforeSend?: PolicyHook[];
};

const DEFAULT_TIMEOUT_MS = 2_000;

class HookTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HookTimeout(`Hook "${name}" timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run every hook in order, stopping at the first denial.
 *
 * Throws `AgentRailsError` rather than returning a verdict so a caller cannot proceed by
 * forgetting to check the return value — the same reason the outcome field on the error
 * type is mandatory.
 */
export async function runPolicyHooks(
  hooks: PolicyHook[] | undefined,
  request: PolicyHookRequest,
): Promise<void> {
  if (!hooks?.length) return;

  for (const hook of hooks) {
    let verdict: HookVerdict;
    try {
      verdict = await withTimeout(
        Promise.resolve(hook.evaluate(request)),
        hook.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        hook.name,
      );
    } catch (error) {
      if (hook.failOpen) {
        continue;
      }
      throw new AgentRailsError({
        reasonCode: "HOOK_UNAVAILABLE",
        message:
          `Policy hook "${hook.name}" could not be evaluated: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        outcome: "denied",
        source: "hook",
        intentId: request.intentId,
        cause: error,
      });
    }

    if (!verdict.allow) {
      throw new AgentRailsError({
        reasonCode: verdict.reasonCode ?? "HOOK_DENIED",
        message: verdict.message ?? `Policy hook "${hook.name}" denied this payment.`,
        outcome: "denied",
        source: "hook",
        intentId: request.intentId,
      });
    }
  }
}
