import type { Address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { AgentRailsError } from "./errors.js";
import type { PolicyHook, PolicyHookRequest } from "./policy-hooks.js";
import { runPolicyHooks } from "./policy-hooks.js";

const REQUEST: PolicyHookRequest = {
  session: "SesSion1111111111111111111111111111111111111" as Address,
  policy: "Po1icy11111111111111111111111111111111111111" as Address,
  intentId: "a1b2c3",
  destination: "Dest1111111111111111111111111111111111111111" as Address,
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
  amount: 1_000_000n,
  reference: "invoice-42",
};

function hook(name: string, overrides: Partial<PolicyHook> = {}): PolicyHook {
  return { name, evaluate: () => ({ allow: true }), ...overrides };
}

/** Never settles, so only the timeout can resolve the race. */
function stalls(): Promise<never> {
  return new Promise<never>(() => {});
}

describe("runPolicyHooks", () => {
  it("does nothing when there are no hooks", async () => {
    await expect(runPolicyHooks(undefined, REQUEST)).resolves.toBeUndefined();
    await expect(runPolicyHooks([], REQUEST)).resolves.toBeUndefined();
  });

  it("runs every hook in order when all allow", async () => {
    const calls: string[] = [];
    const hooks = ["first", "second", "third"].map((name) =>
      hook(name, {
        evaluate: () => {
          calls.push(name);
          return { allow: true };
        },
      }),
    );
    await runPolicyHooks(hooks, REQUEST);
    expect(calls).toEqual(["first", "second", "third"]);
  });

  it("accepts a synchronous verdict as well as a promised one", async () => {
    await runPolicyHooks(
      [
        hook("sync", { evaluate: () => ({ allow: true }) }),
        hook("async", { evaluate: async () => ({ allow: true }) }),
      ],
      REQUEST,
    );
  });

  // Throwing rather than returning a verdict is the point: a caller cannot proceed by
  // forgetting to read a return value.
  it("throws a denial carrying the intent id, not a falsy verdict", async () => {
    const error = await runPolicyHooks(
      [hook("budget", { evaluate: () => ({ allow: false }) })],
      REQUEST,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentRailsError);
    const denial = error as AgentRailsError;
    expect(denial.reasonCode).toBe("HOOK_DENIED");
    expect(denial.outcome).toBe("denied");
    expect(denial.source).toBe("hook");
    expect(denial.intentId).toBe("a1b2c3");
    expect(denial.message).toContain("budget");
  });

  it("prefers the hook's own reason code and message", async () => {
    const error = (await runPolicyHooks(
      [
        hook("review", {
          evaluate: () => ({
            allow: false,
            reasonCode: "REVIEW_REQUIRED",
            message: "above the band a person approves",
          }),
        }),
      ],
      REQUEST,
    ).catch((e: unknown) => e)) as AgentRailsError;
    expect(error.reasonCode).toBe("REVIEW_REQUIRED");
    expect(error.message).toBe("above the band a person approves");
  });

  it("stops at the first denial", async () => {
    const later = vi.fn(() => ({ allow: true }) as const);
    await expect(
      runPolicyHooks(
        [
          hook("denies", { evaluate: () => ({ allow: false }) }),
          hook("later", { evaluate: later }),
        ],
        REQUEST,
      ),
    ).rejects.toBeInstanceOf(AgentRailsError);
    expect(later).not.toHaveBeenCalled();
  });

  // ADR-005 section 6. A control that evaporates when its backend is down is not defence
  // in depth, and the moment a hook is unreachable is exactly when load is highest.
  it("denies when a hook throws", async () => {
    const error = (await runPolicyHooks(
      [
        hook("invoices", {
          evaluate: () => {
            throw new Error("connection refused");
          },
        }),
      ],
      REQUEST,
    ).catch((e: unknown) => e)) as AgentRailsError;
    expect(error.reasonCode).toBe("HOOK_UNAVAILABLE");
    expect(error.outcome).toBe("denied");
    expect(error.message).toContain("connection refused");
  });

  it("denies when a hook rejects with a non-Error", async () => {
    const error = (await runPolicyHooks(
      [hook("odd", { evaluate: () => Promise.reject("just a string") })],
      REQUEST,
    ).catch((e: unknown) => e)) as AgentRailsError;
    expect(error.reasonCode).toBe("HOOK_UNAVAILABLE");
    expect(error.message).toContain("just a string");
  });

  it("denies when a hook exceeds its timeout", async () => {
    const error = (await runPolicyHooks(
      [hook("slow", { timeoutMs: 5, evaluate: stalls })],
      REQUEST,
    ).catch((e: unknown) => e)) as AgentRailsError;
    expect(error.reasonCode).toBe("HOOK_UNAVAILABLE");
    expect(error.message).toContain("timed out");
  });

  // failOpen is a per-hook decision for a genuinely advisory check, never a default — so
  // it has to be tested in both of the ways a hook can fail, not just the tidy one.
  it("continues past a failing hook only when it opts into failOpen", async () => {
    const after = vi.fn(() => ({ allow: true }) as const);
    await runPolicyHooks(
      [
        hook("advisory-throw", {
          failOpen: true,
          evaluate: () => {
            throw new Error("down");
          },
        }),
        hook("advisory-timeout", { failOpen: true, timeoutMs: 5, evaluate: stalls }),
        hook("after", { evaluate: after }),
      ],
      REQUEST,
    );
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("does not let failOpen override an explicit denial", async () => {
    // failOpen covers a hook that could not answer. A hook that answered "no" has answered.
    await expect(
      runPolicyHooks(
        [hook("advisory", { failOpen: true, evaluate: () => ({ allow: false }) })],
        REQUEST,
      ),
    ).rejects.toBeInstanceOf(AgentRailsError);
  });
});
