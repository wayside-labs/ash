import {
  CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
  type CloakPayoutProposal,
  cloakPayoutProposalSchema,
} from "@ash/contract/template-run";
import { buildRunPlan, type RunPlan } from "./plan.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Deterministic, valid, non-reserved address. No real wallet appears in this repository's tests. */
export function addr(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes[0] = 0x41 + (seed % 100);
  for (let i = 1; i < 32; i++) bytes[i] = (seed * 31 + i * 17) % 256;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

export const FUNDER = addr(900);

export function proposalOf(
  payees: { address?: string; deliver?: "SOL" | "ZEC"; amountSol?: string; label?: string }[] = [
    { deliver: "SOL" },
    { deliver: "ZEC" },
  ],
): CloakPayoutProposal {
  return cloakPayoutProposalSchema.parse({
    template: CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
    payees: payees.map((p, i) => ({
      label: p.label ?? `Payee ${i + 1}`,
      address: p.address ?? addr(1 + i),
      deliver: p.deliver ?? "SOL",
      amountSol: p.amountSol ?? "0.02",
    })),
  });
}

/** The plan for the demo run: 0.02 SOL in SOL and 0.02 SOL in ZEC, a quote of 0.00183 ZEC. */
export function demoPlan(options: { quotes?: boolean } = {}): RunPlan {
  const quotes = options.quotes === false ? undefined : new Map([[1, 183_000n]]);
  return buildRunPlan(proposalOf(), {
    runId: "run_test0001",
    funder: FUNDER,
    ...(quotes ? { zecQuotes: quotes } : {}),
  });
}
