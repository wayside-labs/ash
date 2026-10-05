import { z } from "zod";

/**
 * Template run v1: what the chat may *propose* for a template that moves funds, what the
 * operator's browser reports while it runs, and the public proof it leaves behind.
 *
 * The chat emits a proposal, a person approves it in a card, and the browser executes it with
 * the operator's own wallet (ADR-027). Nothing here carries a key, a note, a viewing key or a
 * signature over a secret: events and proofs are public data by construction.
 *
 * Imported by client components, so it stays free of `node:*` — which is also why it is a
 * subpath export and not reached through the package root.
 */

export const TEMPLATE_RUN_API_VERSION = "ash.template-run/v1";
export const PROOF_PACK_API_VERSION = "ash.proof-pack/v1";
/** The fenced-block language the chat model uses to propose a run. */
export const TEMPLATE_RUN_FENCE = "template-run";
export const CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID = "builtin:cloak-private-payout";

/** Wrapped ZEC on Solana: the mint the Cloak/Zcash side track names as the verified one. */
export const ZEC_MINT = "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS";
export const ZEC_DECIMALS = 8;

const LAMPORTS_PER_SOL_BIG = 1_000_000_000n;

/**
 * Advisory caps (ADR-027 calls this a soft policy). The model cannot raise them: they are
 * constants of the template, not fields of the proposal. 0.01 SOL is Cloak's own floor for a
 * shield and for a private swap.
 */
export const CLOAK_PAYOUT_LIMITS = {
  maxPayees: 4,
  minPayeeLamports: 10_000_000n,
  maxPayeeLamports: 50_000_000n,
  maxRunLamports: 100_000_000n,
} as const;

/**
 * Destinations a payout must never name: funds sent there are gone or go to a protocol. This is
 * the list a card can refuse on sight; the runner also asks the chain who owns each payee before
 * anything is shielded, which is what catches every other program, mint or token account.
 */
export const RESERVED_PAYEE_ADDRESSES: ReadonlySet<string> = new Set([
  "11111111111111111111111111111111", // System Program
  "1nc1nerator11111111111111111111111111111111", // incinerator
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account program
  "ComputeBudget111111111111111111111111111111", // Compute Budget
  "BPFLoaderUpgradeab1e11111111111111111111111", // upgradeable loader
  "BPFLoader2111111111111111111111111111111111", // loader v2
  "Stake11111111111111111111111111111111111111", // Stake program
  "Vote111111111111111111111111111111111111111", // Vote program
  "Config1111111111111111111111111111111111111", // Config program
  "AddressLookupTab1e1111111111111111111111111", // Address Lookup Table program
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // Memo
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", // Memo v1
  "SysvarC1ock11111111111111111111111111111111", // Clock sysvar
  "SysvarRent111111111111111111111111111111111", // Rent sysvar
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
  "So11111111111111111111111111111111111111112", // wrapped SOL mint
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mint
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT mint
  "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW", // Cloak shield pool
  ZEC_MINT,
]);

/** The owner of an ordinary wallet account; a payee owned by anything else is not a wallet. */
export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A base58 string that decodes to exactly 32 bytes. No curve check: a PDA can receive funds. */
export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let n = 0n;
  for (const ch of value) n = n * 58n + BigInt(BASE58.indexOf(ch));
  if (n >= 1n << 256n) return false;
  const leadingZeros = value.length - value.replace(/^1+/, "").length;
  const bytes = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2);
  return leadingZeros + bytes === 32;
}

/**
 * A plain decimal ("0.02"), never an exponent, a sign or surrounding whitespace: the card shows
 * exactly what was parsed, and `Number` would round amounts the chain counts to the lamport.
 */
export function parseSolToLamports(value: string): bigint | null {
  if (!/^\d{1,4}(\.\d{1,9})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * LAMPORTS_PER_SOL_BIG + BigInt(fraction.padEnd(9, "0"));
}

export function formatLamportsAsSol(lamports: bigint): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL_BIG;
  const fraction = (abs % LAMPORTS_PER_SOL_BIG).toString().padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

const solanaAddressSchema = z
  .string()
  .refine(isSolanaAddress, { message: "not a Solana address (base58, 32 bytes)" })
  .refine((address) => !RESERVED_PAYEE_ADDRESSES.has(address), {
    message: "this address is a program, a mint or a burn address and cannot be a payee",
  });

const payeeSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\p{L}\p{N} ._-]+$/u, { message: "label may only hold letters, digits, space . _ -" }),
  address: solanaAddressSchema,
  deliver: z.enum(["SOL", "ZEC"]),
  /** SOL leaving the pool for this payee, before Cloak's exit fee. A ZEC payee funds it in SOL. */
  amountSol: z.string().superRefine((value, ctx) => {
    const lamports = parseSolToLamports(value);
    if (lamports === null) {
      ctx.addIssue({ code: "custom", message: "amountSol must be a plain decimal like 0.02" });
      return;
    }
    if (lamports < CLOAK_PAYOUT_LIMITS.minPayeeLamports) {
      ctx.addIssue({ code: "custom", message: "amountSol is below 0.01 SOL, Cloak's minimum" });
    }
    if (lamports > CLOAK_PAYOUT_LIMITS.maxPayeeLamports) {
      ctx.addIssue({ code: "custom", message: "amountSol is above this template's 0.05 SOL cap" });
    }
  }),
});

export const cloakPayoutProposalSchema = z
  .strictObject({
    apiVersion: z.literal(TEMPLATE_RUN_API_VERSION).default(TEMPLATE_RUN_API_VERSION),
    /** There is no `network` field on purpose: the template pins mainnet, the model cannot pick. */
    template: z.literal(CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID),
    payees: z.array(payeeSchema).min(1).max(CLOAK_PAYOUT_LIMITS.maxPayees),
  })
  .superRefine((proposal, ctx) => {
    const seen = new Set<string>();
    let total = 0n;
    for (const payee of proposal.payees) {
      const key = `${payee.address}:${payee.deliver}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate payout of ${payee.deliver} to ${payee.address}`,
        });
      }
      seen.add(key);
      total += parseSolToLamports(payee.amountSol) ?? 0n;
    }
    if (total > CLOAK_PAYOUT_LIMITS.maxRunLamports) {
      ctx.addIssue({ code: "custom", message: "the run exceeds this template's 0.10 SOL cap" });
    }
  });

export type CloakPayoutProposal = z.infer<typeof cloakPayoutProposalSchema>;
export type CloakPayee = CloakPayoutProposal["payees"][number];

/** A reply bigger than this is not a proposal; it is also not worth parsing. */
const MAX_PROPOSAL_BYTES = 8 * 1024;

export type TemplateRunProposal =
  | { ok: true; proposal: CloakPayoutProposal; raw: string }
  | { ok: false; error: string; raw: string };

type FencedBlock = { start: number; end: number; raw: string };

/**
 * A model asked for a ```template-run block will often write ```json instead (it is what the
 * rest of its answers use), no language at all, or the tag of the other block this prompt teaches
 * (```connector-bundle). The fence language is a hint, not the contract: a block in any other
 * fence counts only when it is pure JSON that declares this contract's `apiVersion`, so a random
 * JSON snippet or a real connector bundle is never taken for a payout, while a payout written
 * under the wrong tag still reaches the card, where the schema and a person judge it.
 */
function looksLikeProposal(raw: string): boolean {
  if (raw.length > MAX_PROPOSAL_BYTES) return false;
  // Cheap first: most fences in a reply are code, and a throw per fence adds up on a long reply.
  if (!raw.startsWith("{") || !raw.includes(TEMPLATE_RUN_API_VERSION)) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return (
      typeof value === "object" &&
      value !== null &&
      (value as { apiVersion?: unknown }).apiVersion === TEMPLATE_RUN_API_VERSION
    );
  } catch {
    return false;
  }
}

/**
 * Closed fenced blocks only: one still streaming in has no closing fence and is not a block.
 *
 * Scanned with `indexOf` rather than one regex: this runs on every streamed chunk of a reply that
 * a model, or a page it quotes, controls, and a pattern whose language and info-string parts
 * overlap goes quadratic on a long unterminated fence line (4 s for 40,000 characters).
 */
function proposalBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf("```", at);
    if (open === -1) break;
    const lineEnd = text.indexOf("\n", open + 3);
    // No newline after an opening fence means none after any later one either.
    if (lineEnd === -1) break;
    const close = text.indexOf("```", lineEnd + 1);
    if (close === -1) break;
    const language = (
      /^[A-Za-z0-9_-]*/.exec(text.slice(open + 3, lineEnd))?.[0] ?? ""
    ).toLowerCase();
    const raw = text.slice(lineEnd + 1, close).trim();
    const block = { start: open, end: close + 3, raw };
    if (language === TEMPLATE_RUN_FENCE || looksLikeProposal(raw)) blocks.push(block);
    at = close + 3;
  }
  return blocks;
}

/**
 * Pulls every proposed payout out of a chat reply and validates it. Model output is untrusted: a
 * block that fails the schema is reported, never half-applied.
 */
export function extractTemplateRunProposals(text: string): TemplateRunProposal[] {
  const out: TemplateRunProposal[] = [];
  for (const { raw } of proposalBlocks(text)) {
    if (raw.length > MAX_PROPOSAL_BYTES) {
      out.push({ ok: false, error: "proposal is too large", raw: raw.slice(0, 200) });
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      out.push({ ok: false, error: "not valid JSON", raw });
      continue;
    }
    const parsed = cloakPayoutProposalSchema.safeParse(data);
    out.push(
      parsed.success
        ? { ok: true, proposal: parsed.data, raw }
        : { ok: false, error: parsed.error.issues.map((i) => i.message).join("; "), raw },
    );
  }
  return out;
}

/** The reply with its payout blocks taken out: they render as cards, not as raw JSON. */
export function withoutTemplateRunBlocks(text: string): string {
  let out = "";
  let cursor = 0;
  for (const block of proposalBlocks(text)) {
    out += text.slice(cursor, block.start);
    cursor = block.end;
  }
  out += text.slice(cursor);
  return out.replace(/\n{3,}/g, "\n\n");
}

export const RUN_STEPS = [
  "preflight",
  "derive-keys",
  "shield",
  // A transaction of its own, right after the deposit, that writes a hash of the privacy text
  // on-chain (Memo program). It is not part of any payout and a failure does not stop the run.
  "commit",
  "payout",
  "report",
  "recover",
] as const;
export const runStepSchema = z.enum(RUN_STEPS);
export type RunStep = z.infer<typeof runStepSchema>;

/**
 * Why a run stopped. The card maps each code to a sentence; none of them carries a raw upstream
 * message, which can quote an address, a request body or an account of the operator's.
 */
export const RUN_ERROR_CODES = [
  "mainnet_disabled",
  "wallet_missing",
  "wallet_rejected",
  "wallet_not_allowed",
  "wallet_cannot_sign_messages",
  "insufficient_balance",
  "below_minimum",
  "payee_invalid",
  "circuits_unreachable",
  "relay_unreachable",
  "rpc_unreachable",
  "swap_quote_unavailable",
  "quote_moved",
  "approval_too_slow",
  "run_in_progress",
  "keys_not_deterministic",
  "keys_mismatch",
  "outcome_unknown",
  "aborted",
  "unknown",
] as const;
export const runErrorCodeSchema = z.enum(RUN_ERROR_CODES);
export type RunErrorCode = z.infer<typeof runErrorCodeSchema>;

const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** The shape of a transaction signature: base58, 64 to 90 characters. A shape, not proof it landed. */
export function isTransactionSignature(value: string): boolean {
  return TX_SIGNATURE.test(value);
}

const txSignatureSchema = z.string().regex(TX_SIGNATURE);

/**
 * One line of a run's timeline. Public by construction: `strictObject` refuses a field nobody
 * declared, and `message` is for the operator, never a dump of an SDK object.
 */
export const runEventSchema = z.strictObject({
  runId: z.string().min(1).max(64),
  at: z.string().min(10).max(40),
  step: runStepSchema,
  status: z.enum(["started", "progress", "done", "failed", "skipped"]),
  payeeIndex: z
    .number()
    .int()
    .min(0)
    .max(CLOAK_PAYOUT_LIMITS.maxPayees - 1)
    .optional(),
  signature: txSignatureSchema.optional(),
  errorCode: runErrorCodeSchema.optional(),
  message: z.string().max(300).optional(),
});
export type RunEvent = z.infer<typeof runEventSchema>;

const lamportsString = z.string().regex(/^\d{1,20}$/);

/**
 * The standalone transaction that wrote a hash of the privacy text on-chain: a commitment made
 * before the text is submitted, which the submission then reveals. `memo` is what the Memo
 * instruction carries, so a reader can compare it with the explorer without our code.
 */
const commitmentSchema = z.strictObject({
  signature: txSignatureSchema,
  memo: z.string().min(1).max(200),
});

/**
 * What a judge needs to check a run without trusting us: every signature, who paid and who was
 * paid, and the honest limits. Amounts are decimal strings because JSON has no bigint.
 */
export const proofPackSchema = z.strictObject({
  apiVersion: z.literal(PROOF_PACK_API_VERSION),
  template: z.literal(CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID),
  runId: z.string().min(1).max(64),
  cluster: z.literal("mainnet-beta"),
  cloakProgramId: z.string(),
  sdk: z.strictObject({ name: z.literal("@cloak.dev/sdk"), version: z.string() }),
  funder: solanaAddressSchema,
  startedAt: z.string(),
  finishedAt: z.string(),
  shield: z.strictObject({ signature: txSignatureSchema, amountLamports: lamportsString }),
  commitment: commitmentSchema.optional(),
  payouts: z.array(
    z.strictObject({
      index: z.number().int().min(0),
      label: z.string(),
      address: solanaAddressSchema,
      deliver: z.enum(["SOL", "ZEC"]),
      grossLamports: lamportsString,
      feeLamports: lamportsString,
      netLamports: lamportsString,
      /** ZEC payouts only: the quote the swap was bounded by, in ZEC base units (8 decimals). */
      minOutputBaseUnits: lamportsString.optional(),
      signature: txSignatureSchema,
    }),
  ),
  notes: z.array(z.string()),
});
export type ProofPack = z.infer<typeof proofPackSchema>;

/** Mainnet explorer link for a signature; the template never runs anywhere else. */
export function mainnetExplorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}`;
}
