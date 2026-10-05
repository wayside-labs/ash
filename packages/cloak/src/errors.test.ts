import { describe, expect, it } from "vitest";
import { classifyError, describeForConsole, RUN_ERROR_MESSAGES, RunError } from "./errors.js";

describe("classifyError", () => {
  it("passes a RunError through untouched", () => {
    const original = new RunError("below_minimum");
    expect(classifyError(original)).toBe(original);
  });

  it("recognises a wallet rejection however the wallet words it", () => {
    for (const error of [
      { code: 4001, message: "User rejected the request." },
      new Error("The user rejected the request"),
      { message: "User denied message signature." },
      "Request rejected by the user",
      new Error("Transaction cancelled"),
    ]) {
      expect(classifyError(error).code, JSON.stringify(error)).toBe("wallet_rejected");
    }
  });

  it("maps the SDK's own wording to a code, and keeps the original as the cause", () => {
    const cases: [unknown, string][] = [
      [new Error("insufficient funds for rent"), "insufficient_balance"],
      [new Error("Deposit amount too small: 5000 lamports"), "below_minimum"],
      [new Error("Cloak SDK: refusing to read circuit artifacts from x"), "circuits_unreachable"],
      [new Error("submission outcome unknown"), "outcome_unknown"],
      [new DOMException("The operation was aborted.", "AbortError"), "aborted"],
    ];
    for (const [error, code] of cases) {
      const classified = classifyError(error);
      expect(classified.code, String(code)).toBe(code);
      expect(classified.cause).toBe(error);
    }
  });

  it("calls an unreachable network by the step's own fallback", () => {
    const down = new TypeError("fetch failed");
    expect(classifyError(down).code).toBe("relay_unreachable");
    expect(classifyError(down, "rpc_unreachable").code).toBe("rpc_unreachable");
  });

  it("recognises the public RPC's refusal of a browser, on the RPC step only", () => {
    const forbidden = new Error('{"error":{"code": 403,"message":"Access forbidden"}}');
    expect(classifyError(forbidden, "rpc_unreachable").code).toBe("rpc_unreachable");
    expect(classifyError(forbidden).code).toBe("unknown");
  });

  it("falls back to unknown for everything else", () => {
    for (const error of [new Error("boom"), {}, null, undefined, 42, "weird"]) {
      expect(classifyError(error).code).toBe("unknown");
    }
  });

  it("never puts the upstream text into the message the card shows", () => {
    const leak = "4Nd1mYQzvgWJ3SecretAddressHere body={proof:...}";
    const recognised = classifyError(new Error(`user rejected the request: recipient ${leak}`));
    expect(recognised.code).toBe("wallet_rejected");
    expect(recognised.message).toBe(RUN_ERROR_MESSAGES.wallet_rejected);
    const unrecognised = classifyError(new Error(`something odd: recipient ${leak}`));
    expect(unrecognised.code).toBe("unknown");
    expect(unrecognised.message).toBe(RUN_ERROR_MESSAGES.unknown);
    for (const error of [recognised, unrecognised]) expect(error.message).not.toContain("4Nd1m");
  });
});

// The SDK's own messages, as they appear in its source. A step that reached the chain, or may
// have, is read as unknown: telling the operator it failed invites the retry that pays twice.
describe("what the SDK says about a step that reached the chain", () => {
  const SIGNATURE = "5".repeat(87);
  const settlement = (outcome: string, signature: string | null) =>
    Object.assign(new Error("The relay could not be reconciled with the chain."), {
      name: "SettlementVerificationError",
      outcome,
      signature,
    });

  it("reads a settlement verdict by its outcome, and keeps the signature of one that landed", () => {
    const landed = classifyError(settlement("landed", SIGNATURE));
    expect(landed.code).toBe("outcome_unknown");
    expect(landed.landedSignature).toBe(SIGNATURE);

    const unknown = classifyError(settlement("unknown", SIGNATURE));
    expect(unknown.code).toBe("outcome_unknown");
    // Only a landed spend has a signature worth recording.
    expect(unknown.landedSignature).toBeUndefined();
  });

  it("does not take a signature that is not one", () => {
    expect(classifyError(settlement("landed", "short")).landedSignature).toBeUndefined();
    expect(classifyError(settlement("landed", null)).landedSignature).toBeUndefined();
    expect(classifyError(settlement("landed", null)).code).toBe("outcome_unknown");
  });

  it("leaves a spend the chain says never happened to the ordinary rules", () => {
    for (const outcome of ["not-landed", "failed"]) {
      expect(classifyError(settlement(outcome, null)).code).toBe("unknown");
    }
  });

  it.each([
    "The relay reported success for 5abc, but that could not be confirmed on chain. timed out",
    "The relay's outcome could not be resolved against chain. no verdict",
    "Transaction succeeded but commitment indices missing: [-1, -1].",
    "Swap execution did not complete within timeout (60 attempts, 2000ms interval).",
    "Swap execution cancelled: likely refunded after timeout",
    "Swap refunded: route unavailable, funds refunded as SOL",
  ])("reads %j as an unknown outcome, never as a closed prompt", (text) => {
    expect(classifyError(new Error(text)).code).toBe("outcome_unknown");
  });

  it("names a wallet approval that came too late, not a rejection", () => {
    const text =
      "The wallet approval took 301 seconds, and Cloak requests stay valid for 300. NOTHING WAS SUBMITTED.";
    expect(classifyError(new Error(text)).code).toBe("approval_too_slow");
  });

  it("does not call a proof the circuit refused a missing download", () => {
    const text =
      "Circuit assertion failed: Error: Assert Failed. Error in template Transaction_123";
    expect(classifyError(new Error(text)).code).toBe("unknown");
    expect(classifyError(new Error("could not load circuit file")).code).toBe(
      "circuits_unreachable",
    );
  });

  it("recognises the dashboard's own wallet errors", () => {
    expect(classifyError(new Error("WALLET_CANNOT_SIGN_MESSAGES")).code).toBe(
      "wallet_cannot_sign_messages",
    );
    expect(classifyError(new Error("WALLET_NOT_FOUND")).code).toBe("wallet_missing");
  });

  it("still takes a real rejection for one", () => {
    expect(classifyError({ code: 4001, message: "User rejected the request." }).code).toBe(
      "wallet_rejected",
    );
  });
});

describe("describeForConsole", () => {
  it("cuts a 44-character secret too, since base58 and base64 keys are that long", () => {
    const base58Key = "4Nd1mYQzvgWJ3SecretSecretSecretSecretSecret1x";
    const out = describeForConsole(new Error(`bad note nk=${base58Key} and more`));
    expect(out).not.toContain(base58Key);
    expect(out).toContain("…[");
  });

  it("cuts long opaque tokens so an SDK error body cannot leak a proof or a key into a log", () => {
    const token = "A".repeat(200);
    const out = describeForConsole(new Error(`relay said ${token} and more`));
    expect(out).not.toContain(token);
    expect(out).toContain("AAAAAAAA…[200]");
  });

  it("keeps ordinary messages readable and bounded", () => {
    expect(describeForConsole(new Error("plain message"))).toBe("plain message");
    expect(describeForConsole(new Error("x ".repeat(500))).length).toBeLessThanOrEqual(400);
    expect(describeForConsole(undefined)).toBe("undefined");
  });
});
