/**
 * The Metrics page's data contracts (docs/product/metrics-page.md §F).
 *
 * These live in the dashboard rather than in `@agent-rails/contract` on purpose:
 * contract is the compatibility anchor every surface pins, and `MetricsSummary`
 * is a hosted-dashboard view shape with no counterpart on the CLI, the MCP
 * server or any adapter. Putting it upstream would let a UI change gate MCP
 * transport compatibility.
 *
 * `PaymentRecord` is the one exception, and it is already there.
 */

import { paymentRecordSchema } from "@agent-rails/contract/events";
import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";

const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
/** Base units. A u64 does not survive JSON as a number. */
const baseUnitsSchema = z.string().regex(/^\d+$/);

/** The program's "no limit" sentinel, which is not a number worth printing. */
export const U64_MAX = "18446744073709551615";

/**
 * How well a number is known.
 *
 * The load-bearing field on this page. A spend figure read off an on-chain
 * counter and one replayed from logs that age out are not the same claim, and an
 * operator who cannot tell them apart cannot calibrate against either. Every
 * metric carries one of these and the UI always renders it.
 */
export const exactnessSchema = z.enum([
  /** An on-chain counter. Exact, no gaps. */
  "counter",
  /** Replayed from PaymentExecuted logs. Complete only within RPC retention. */
  "events",
  /** A seeded row with no on-chain counterpart. */
  "demo",
  /** Nothing to read yet. Renders as an em dash, never as a zero. */
  "unavailable",
]);
export type Exactness = z.infer<typeof exactnessSchema>;

/**
 * The buckets the program itself tracks.
 *
 * `custom` is deliberately absent until there is an event replay to honour it: a
 * spend counter is exact for *its own* bucket and says nothing about an
 * arbitrary range, so rendering `lifetimeSpent` under a label reading "Last 7
 * days" would be a lie the reader cannot detect.
 */
export const metricsPeriodSchema = z.enum(["short-window", "long-window", "session-life"]);
export type MetricsPeriod = z.infer<typeof metricsPeriodSchema>;

export const metricsScopeSchema = z.object({
  /** null = every workflow the operator can see. */
  workflowId: z.string().nullable(),
  agentId: z.string().nullable(),
  mint: addressSchema.nullable(),
});
export type MetricsScope = z.infer<typeof metricsScopeSchema>;

/** One amount, carried the way every other Agent Rails surface carries one. */
export const metricAmountSchema = z.object({
  raw: baseUnitsSchema,
  mint: addressSchema,
  /** From the owner-configured MintConfig, never from the mint registry. */
  decimals: z.number().int().min(0).max(18),
  symbol: z.string(),
  /** Spot for native, 1:1 for a known peg, null otherwise. Never guessed. */
  usd: z.number().nullable(),
});
export type MetricAmount = z.infer<typeof metricAmountSchema>;

export const headroomSchema = z.object({
  mint: addressSchema,
  decimals: z.number().int(),
  symbol: z.string(),
  /** Which policy this limit belongs to, so the UI can name it. */
  policy: addressSchema,
  policyName: z.string(),
  window: z.enum(["short", "long", "lifetime", "per-tx"]),
  /** The policy's own duration, so a 6h window is labelled "6h" and not "24h". */
  windowSeconds: z.number().int().nullable(),
  spentRaw: baseUnitsSchema,
  policyMaxRaw: baseUnitsSchema,
  /** The owner ceiling, when the treasury configured one for this mint. */
  ceilingRaw: baseUnitsSchema.nullable(),
  /** True when the policy max is the u64::MAX sentinel. */
  unlimited: z.boolean(),
});
export type Headroom = z.infer<typeof headroomSchema>;

export const integrityRowSchema = z.object({
  session: addressSchema,
  label: z.string(),
  /** Exact count of settled payments for this session's whole life. */
  seq: baseUnitsSchema,
  /** `AgentSession.audit_head`, hex. */
  auditHead: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  /**
   * Phase B: the seq an event replay got to before the chain stopped matching.
   * null means "not checked", which is not "broken".
   */
  verifiedThroughSeq: baseUnitsSchema.nullable(),
  revoked: z.boolean(),
  expiresAt: z.number().int(),
});
export type IntegrityRow = z.infer<typeof integrityRowSchema>;

export const metricsSummarySchema = z.object({
  asOf: z.string(),
  cluster: solanaClusterSchema,
  scope: metricsScopeSchema,
  period: z.object({
    kind: metricsPeriodSchema,
    /** null for session-life, which has no fixed length. */
    seconds: z.number().int().nullable(),
    /**
     * Unix seconds — the current bucket's own start, from
     * `SpendCounter.short_window_start`. Only the short window has one on
     * chain, so the long window reports null rather than a guess.
     */
    startedAt: z.number().int().nullable(),
  }),
  holdings: z.object({
    assets: z.array(metricAmountSchema),
    usd: z.number().nullable(),
    /** True when an asset has no known price, so the USD total is a floor. */
    partial: z.boolean(),
    excluded: z.number().int(),
  }),
  spend: z.object({
    byMint: z.array(metricAmountSchema),
    usd: z.number().nullable(),
    exactness: exactnessSchema,
  }),
  payments: z.object({
    count: z.number().int(),
    /**
     * `seq` counts a session's whole life whatever period is selected, because
     * the program keeps no per-window counter of *attempts*. The UI says so
     * rather than letting the number sit under a window label unqualified.
     */
    lifetimeOnly: z.boolean(),
    exactness: exactnessSchema,
  }),
  denials: z.object({
    /** null, not 0, while there is nothing to read. */
    count: z.number().int().nullable(),
    byReason: z.record(z.string(), z.number().int()),
    exactness: exactnessSchema,
  }),
  headroom: z.array(headroomSchema),
  /**
   * The policies in scope. `destinationMode` is what tells §3 whether there is a
   * roster to show at all: a policy in `Any` mode has none, and an empty list
   * under that mode would read as "nobody may be paid", which is the opposite.
   */
  policies: z.array(
    z.object({
      address: addressSchema,
      name: z.string(),
      /** 0 = DestinationMode::Any, 1 = Allowlist. */
      destinationMode: z.number().int(),
      requireMemo: z.boolean(),
    }),
  ),
  price: z
    .object({
      usd: z.number(),
      change24h: z.number().nullable(),
      source: z.enum(["coingecko", "coinbase"]),
      asOf: z.string(),
    })
    .nullable(),
  integrity: z.array(integrityRowSchema),
  /** Treasuries that could not be read. Surfaced, never folded in as zero. */
  unreadable: z.array(z.object({ treasury: addressSchema, detail: z.string() })),
});
export type MetricsSummary = z.infer<typeof metricsSummarySchema>;

/**
 * An allowlist entry, plus what was paid to it once history exists.
 *
 * `paid: null` means "not known", which is not "never paid" — the roster is
 * exact and the amounts are not, and the UI has to say which is which.
 */
export const destinationContactSchema = z.object({
  label: z.string(),
  normalizedLabel: z.string(),
  owner: addressSchema,
  /** The `AllowlistEntry` PDA. */
  entry: addressSchema,
  policy: addressSchema,
  /** "0" means no override; otherwise it caps this destination below the policy. */
  perTxMaxOverrideRaw: baseUnitsSchema,
  paid: z
    .object({
      count: z.number().int(),
      byMint: z.array(metricAmountSchema),
      lastAt: z.string().nullable(),
    })
    .nullable(),
  demo: z.boolean().default(false),
});
export type DestinationContact = z.infer<typeof destinationContactSchema>;

/**
 * A `PaymentRecord` with the few fields a table needs resolved.
 *
 * Deliberately an `.extend()` on the contract schema, and deliberately still
 * snake_case: one spelling from the operator sink the MCP server writes, through
 * this table, to the CSV column headers. `amount` stays the base-unit string of
 * record; `decimals` is only for rendering it.
 */
export const paymentRecordViewSchema = paymentRecordSchema.extend({
  decimals: z.number().int().nullable(),
  symbol: z.string().nullable(),
  workflow_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  demo: z.boolean().default(false),
});
export type PaymentRecordView = z.infer<typeof paymentRecordViewSchema>;

export const paymentHistorySchema = z.object({
  records: z.array(paymentRecordViewSchema),
  /** False whenever the walk hit retention or the page limit. */
  complete: z.boolean(),
  /** The oldest slot the walk actually reached, for the banner's wording. */
  oldestSlot: z.string().nullable(),
  truncatedBy: z.enum(["retention", "limit", "rpc-error"]).nullable(),
  /** Signature cursor for the next page. */
  before: z.string().nullable(),
  /** session address → seq verified through, when the replay matched the on-chain head. */
  verifiedThrough: z.record(z.string(), z.string().nullable()).optional(),
});
export type PaymentHistory = z.infer<typeof paymentHistorySchema>;
