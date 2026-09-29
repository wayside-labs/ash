import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { newId, nowSeconds } from "../store.js";
import type { VendorModule } from "../vendor.js";

type Account = {
  id: string;
  /** sha256 of the bearer token; the token itself is shown once, at creation. */
  tokenHash: string;
  credits: number;
  createdAt: number;
  jobs: number;
};

type ComputeState = { accounts: Record<string, Account> };

const CREDITS_PER_PACK = Number(process.env.COMPUTE_CREDITS_PER_PACK ?? 10);
const MAX_PACKS = 20;
const MAX_INPUT_CHARS = 20_000;

const JOB_COSTS = { keywords: 1, summarize: 2, sha256: 1 } as const;
type JobKind = keyof typeof JOB_COSTS;

const buySchema = z.object({
  packs: z.number().int().min(1).max(MAX_PACKS),
  account_id: z.string().max(64).optional(),
  session: z.string().optional(),
});

const jobSchema = z.object({
  kind: z.enum(Object.keys(JOB_COSTS) as [JobKind, ...JobKind[]]),
  input: z.string().min(1).max(MAX_INPUT_CHARS),
});

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function authenticate(req: IncomingMessage, state: ComputeState): Account | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const hash = Buffer.from(hashToken(token), "hex");
  for (const account of Object.values(state.accounts)) {
    const candidate = Buffer.from(account.tokenHash, "hex");
    if (candidate.length === hash.length && timingSafeEqual(candidate, hash)) return account;
  }
  return null;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be by de do da das dos e em for from has in is it of on or para por " +
    "que se the to um uma was with o os as no na nos nas this that"
  ).split(" "),
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

function frequencies(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return freq;
}

/** Deterministic on purpose: a test can assert the output, and no model key is needed. */
function runJob(kind: JobKind, input: string): unknown {
  switch (kind) {
    case "sha256":
      return { sha256: createHash("sha256").update(input).digest("hex") };
    case "keywords": {
      const ranked = [...frequencies(terms(input))].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
      );
      return { keywords: ranked.slice(0, 10).map(([term, count]) => ({ term, count })) };
    }
    case "summarize": {
      const sentences = input.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
      const freq = frequencies(terms(input));
      const scored = sentences.map((s, i) => {
        const ws = terms(s);
        const score = ws.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0) / Math.max(ws.length, 1);
        return { i, s: s.trim(), score };
      });
      const top = [...scored]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .sort((a, b) => a.i - b.i);
      return { summary: top.map((t) => t.s).join(" "), sentences_in: sentences.length };
    }
  }
}

/**
 * Prepaid credits, the other payment shape an agent meets in the wild: one payment buys a
 * balance, and the balance is spent without touching the chain. It exercises a different
 * policy pressure than per-call billing — fewer, larger payments that hit per-tx limits
 * rather than window counts.
 */
export const compute: VendorModule<ComputeState> = {
  id: "compute",
  title: "Rails Compute — prepaid credits for text jobs",
  unit: `one pack of ${CREDITS_PER_PACK} credits`,
  describe: () => ({
    credits_per_pack: CREDITS_PER_PACK,
    max_packs_per_invoice: MAX_PACKS,
    job_costs: JOB_COSTS,
    jobs: "POST /jobs {kind, input} with Authorization: Bearer <token>",
    balance: "GET /account with Authorization: Bearer <token>",
  }),
  emptyState: () => ({ accounts: {} }),
  quote: (body, state) => {
    const parsed = buySchema.safeParse(body);
    if (!parsed.success) {
      return {
        kind: "error",
        status: 422,
        message: `expected {packs: 1..${MAX_PACKS}, account_id?}`,
      };
    }
    const { packs, account_id } = parsed.data;
    if (account_id && !state.accounts[account_id]) {
      return { kind: "error", status: 404, message: "no such account_id" };
    }
    return { kind: "invoice", units: packs, request: { packs, account_id: account_id ?? null } };
  },
  deliver: async (invoice, _payment, state) => {
    const { packs, account_id } = invoice.request as { packs: number; account_id: string | null };
    const credits = packs * CREDITS_PER_PACK;
    const existing = account_id ? state.accounts[account_id] : undefined;
    if (existing) {
      existing.credits += credits;
      return { account_id: existing.id, credits_added: credits, balance: existing.credits };
    }
    const token = `cpt_${randomBytes(24).toString("base64url")}`;
    const account: Account = {
      id: newId("acct"),
      tokenHash: hashToken(token),
      credits,
      createdAt: nowSeconds(),
      jobs: 0,
    };
    state.accounts[account.id] = account;
    // Stored in the invoice's delivery so a replayed redeem hands back the same token;
    // the invoice is only replayable by the session that paid for it.
    return { account_id: account.id, token, credits_added: credits, balance: credits };
  },
  routes: [
    {
      method: "GET",
      path: "/account",
      handle: ({ req, state }) => {
        const account = authenticate(req, state.data.vendor);
        if (!account) return { status: 401, body: { error: "bearer token required" } };
        return {
          status: 200,
          body: { account_id: account.id, balance: account.credits, jobs: account.jobs },
        };
      },
    },
    {
      method: "POST",
      path: "/jobs",
      handle: async ({ req, body, state }) => {
        const account = authenticate(req, state.data.vendor);
        if (!account) return { status: 401, body: { error: "bearer token required" } };
        const parsed = jobSchema.safeParse(body);
        if (!parsed.success) {
          return {
            status: 422,
            body: { error: `expected {kind: ${Object.keys(JOB_COSTS).join("|")}, input}` },
          };
        }
        const cost = JOB_COSTS[parsed.data.kind];
        if (account.credits < cost) {
          return {
            status: 402,
            body: { error: "insufficient credits", balance: account.credits, cost },
          };
        }
        account.credits -= cost;
        account.jobs += 1;
        await state.save();
        return {
          status: 200,
          body: {
            job_id: newId("job"),
            kind: parsed.data.kind,
            cost,
            balance: account.credits,
            result: runJob(parsed.data.kind, parsed.data.input),
          },
        };
      },
    },
  ],
};
