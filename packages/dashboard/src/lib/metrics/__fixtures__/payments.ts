/**
 * Test fixture for the metrics fold: a plausible payment history over the seed's
 * workflows and agents. It was the Phase A stand-in for §5 until the real history
 * (event replay) replaced it; nothing in the app imports it any more.
 *
 * The owner addresses are syntactically valid base58 but are not real accounts.
 */

import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { USDC_MINT_DEVNET } from "@agent-rails/contract/mints";
import type { DestinationContact, PaymentRecordView } from "../schema";

/** 28 hex chars; the row index supplies the last 4, so every id is valid by construction. */
const INTENT_PREFIX = "9c4e17bb5af2408da6013e7cd1a5";
const intentId = (n: number) => `${INTENT_PREFIX}${n.toString(16).padStart(4, "0")}`;

const SESSION = {
  cfo: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
  ap: "HN7cABqLq46Es1jh92dQQpjKrpPbvbYmGxzYcRZvkzVP",
  trader: "3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF",
} as const;
const TREASURY = "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i";
const POLICY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

/**
 * Five registered destinations, one of which has never been paid.
 *
 * That last row is the point of having five: it is what makes "the roster is
 * exact, the amounts are not" visible on screen rather than merely documented.
 *
 * The owner addresses are syntactically valid base58 but are not real accounts,
 * so anything rendering these rows must suppress its explorer link while `demo`
 * is set. A dead Solscan tab is worse than no link.
 */
export const MOCK_DESTINATIONS: DestinationContact[] = [
  {
    label: "Acme Hosting",
    normalizedLabel: "acme hosting",
    owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    entry: "6XU36wCxWobLx5Rtsb58kmgAKKJYoGkGfqALcW1JTBWY",
    policy: POLICY,
    perTxMaxOverrideRaw: "0",
    paid: null,
    demo: true,
  },
  {
    label: "Cloud GPU",
    normalizedLabel: "cloud gpu",
    owner: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    entry: "BdYTTV5sJVnKcQDTGKtCTsNwJKnBQZ1xjA2mF2vNiwHF",
    policy: POLICY,
    // 100 USDC, under the policy's own per-payment cap.
    perTxMaxOverrideRaw: "100000000",
    paid: null,
    demo: true,
  },
  {
    label: "Data Vendor",
    normalizedLabel: "data vendor",
    owner: "AC5RDfQFmDS1deWZvFJkQeDot3EnGXNytj8fN8Pu1cM7",
    entry: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW",
    policy: POLICY,
    perTxMaxOverrideRaw: "0",
    paid: null,
    demo: true,
  },
  {
    label: "Payroll Ops",
    normalizedLabel: "payroll ops",
    owner: "GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp",
    entry: "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1",
    policy: POLICY,
    perTxMaxOverrideRaw: "0",
    paid: null,
    demo: true,
  },
  {
    label: "Superteam Earn",
    normalizedLabel: "superteam earn",
    owner: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    entry: "AjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw2",
    policy: POLICY,
    perTxMaxOverrideRaw: "0",
    paid: null,
    demo: true,
  },
];

type Row = [
  minutesAgo: number,
  workflowId: string,
  agentId: string,
  agentName: string,
  session: keyof typeof SESSION,
  destIndex: number,
  mint: string,
  amountRaw: string,
  outcome: PaymentRecordView["outcome"],
  reason?: string,
];

/** All four outcomes appear, so every branch of the outcome badge is exercised. */
const ROWS: Row[] = [
  [2, "w_demo_fornec", "a_demo_cfo", "CFO Bot", "cfo", 0, USDC_MINT_DEVNET, "120000000", "settled"],
  [13, "w_demo_fornec", "a_demo_cfo", "CFO Bot", "cfo", 1, USDC_MINT_DEVNET, "80000000", "settled"],
  [
    20,
    "w_demo_fornec",
    "a_demo_ap",
    "AP Assistant",
    "ap",
    2,
    USDC_MINT_DEVNET,
    "300000000",
    "denied",
    "DESTINATION_NOT_ALLOWED",
  ],
  [
    34,
    "w_demo_defi",
    "a_demo_trader",
    "Trader Bot",
    "trader",
    3,
    NATIVE_MINT,
    "1250000000",
    "indeterminate",
  ],
  [
    47,
    "w_demo_fornec",
    "a_demo_cfo",
    "CFO Bot",
    "cfo",
    0,
    USDC_MINT_DEVNET,
    "120000000",
    "settled",
  ],
  [61, "w_demo_loja", "a_demo_maria", "Maria", "cfo", 2, USDC_MINT_DEVNET, "45500000", "settled"],
  [
    88,
    "w_demo_fornec",
    "a_demo_ap",
    "AP Assistant",
    "ap",
    1,
    USDC_MINT_DEVNET,
    "220000000",
    "denied",
    "EXCEEDS_SHORT_WINDOW",
  ],
  [
    104,
    "w_demo_defi",
    "a_demo_trader",
    "Trader Bot",
    "trader",
    3,
    NATIVE_MINT,
    "750000000",
    "settled",
  ],
  [133, "w_demo_loja", "a_demo_joao", "João", "cfo", 0, USDC_MINT_DEVNET, "18000000", "settled"],
  [
    150,
    "w_demo_fornec",
    "a_demo_cfo",
    "CFO Bot",
    "cfo",
    1,
    USDC_MINT_DEVNET,
    "160000000",
    "settled",
  ],
  [
    187,
    "w_demo_defi",
    "a_demo_research",
    "Researcher",
    "trader",
    2,
    USDC_MINT_DEVNET,
    "12000000",
    "settled",
  ],
  [
    210,
    "w_demo_fornec",
    "a_demo_ap",
    "AP Assistant",
    "ap",
    0,
    USDC_MINT_DEVNET,
    "95000000",
    "settled",
  ],
  [
    264,
    "w_demo_loja",
    "a_demo_maria",
    "Maria",
    "cfo",
    2,
    USDC_MINT_DEVNET,
    "60000000",
    "review_required",
  ],
  [
    301,
    "w_demo_fornec",
    "a_demo_cfo",
    "CFO Bot",
    "cfo",
    0,
    USDC_MINT_DEVNET,
    "120000000",
    "settled",
  ],
  [
    355,
    "w_demo_defi",
    "a_demo_trader",
    "Trader Bot",
    "trader",
    3,
    NATIVE_MINT,
    "500000000",
    "settled",
  ],
  [
    402,
    "w_demo_fornec",
    "a_demo_ap",
    "AP Assistant",
    "ap",
    1,
    USDC_MINT_DEVNET,
    "140000000",
    "settled",
  ],
  [
    468,
    "w_demo_loja",
    "a_demo_joao",
    "João",
    "cfo",
    0,
    USDC_MINT_DEVNET,
    "22500000",
    "denied",
    "MEMO_REQUIRED",
  ],
  [
    540,
    "w_demo_fornec",
    "a_demo_cfo",
    "CFO Bot",
    "cfo",
    2,
    USDC_MINT_DEVNET,
    "410000000",
    "settled",
  ],
  [
    611,
    "w_demo_defi",
    "a_demo_research",
    "Researcher",
    "trader",
    2,
    USDC_MINT_DEVNET,
    "8000000",
    "settled",
  ],
  [
    720,
    "w_demo_fornec",
    "a_demo_cfo",
    "CFO Bot",
    "cfo",
    1,
    USDC_MINT_DEVNET,
    "260000000",
    "settled",
  ],
];

/**
 * Timestamps are relative to module evaluation rather than frozen, so the table
 * reads as recent activity whenever the page is opened.
 */
export function mockPayments(now = Date.now()): PaymentRecordView[] {
  return ROWS.map(
    (
      [
        minutesAgo,
        workflowId,
        agentId,
        agentName,
        session,
        destIndex,
        mint,
        amount,
        outcome,
        reason,
      ],
      index,
    ) => {
      const dest = MOCK_DESTINATIONS[destIndex] as DestinationContact;
      const settled = outcome === "settled";
      return {
        ts: new Date(now - minutesAgo * 60_000).toISOString(),
        treasury: TREASURY,
        session: SESSION[session],
        policy: POLICY,
        intent: intentId(index),
        outcome,
        ...(reason ? { reason_code: reason as never, source: "program" as const } : {}),
        destination: dest.owner,
        destination_label: dest.label,
        mint,
        amount,
        // Only a settled payment has a signature, which is what a detail view
        // would key an explorer link off.
        ...(settled ? { signature: `demo${index.toString().padStart(2, "0")}` } : {}),
        decimals: mint === NATIVE_MINT ? 9 : 6,
        symbol: mint === NATIVE_MINT ? "SOL" : "USDC",
        workflow_id: workflowId,
        agent_id: agentId,
        agent_name: agentName,
        demo: true,
      } satisfies PaymentRecordView;
    },
  );
}

export const MOCK_PAYMENTS: PaymentRecordView[] = mockPayments();
