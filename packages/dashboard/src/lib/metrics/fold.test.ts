import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { USDC_MINT_DEVNET } from "@agent-rails/contract/mints";
import { describe, expect, it } from "vitest";
import type { SolPrice } from "@/lib/server/price";
import type { SessionView, TreasuryView, VaultBalance } from "@/lib/server/solana";
import {
  type FoldInput,
  foldMetrics,
  priceMoveUsd,
  remainingRaw,
  tightestConstraint,
} from "./fold";
import { MOCK_DESTINATIONS, mockPayments } from "./mock";
import { U64_MAX } from "./schema";

const TREASURY = "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i";
const POLICY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const SESSION_A = "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C";
const SESSION_B = "HN7cABqLq46Es1jh92dQQpjKrpPbvbYmGxzYcRZvkzVP";
const SOL_VAULT = "4Qg14cZWVLPXeFFrcaD9cFZEdLX44M4AWfxdHwSiVYeF";
const HEAD_A = "9c4e17bb5af2408da6013e7cd1a50000000000000000000000000000000000ab";
const HEAD_B = "41ba09f37e02000000000000000000000000000000000000000000000000cd12";

/**
 * The pieces every fixture is built from, hoisted rather than reached for with
 * `treasury().policies[0]`. Indexing a fresh builder needs a non-null assertion
 * on every use, which `noUncheckedIndexedAccess` is right to flag: the assertion
 * says "trust me" about the one thing a test should state outright.
 */
const BASE_COUNTER: SessionView["spend"][number] = {
  mint: USDC_MINT_DEVNET,
  shortSpent: "1500000000",
  longSpent: "4100000000",
  lifetimeSpent: "5320000000",
  shortWindowStart: 1_700_000_000,
};

const BASE_LIMIT: TreasuryView["policies"][number]["limits"][number] = {
  mint: USDC_MINT_DEVNET,
  perTxMax: "200000000",
  shortWindowMax: "5000000000",
  shortWindowSeconds: 86_400,
  longWindowMax: "50000000000",
  longWindowSeconds: 2_592_000,
  lifetimeMax: "150000000000",
};

const BASE_POLICY: TreasuryView["policies"][number] = {
  address: POLICY,
  name: "default",
  destinationMode: 1,
  requireMemo: false,
  activeSessions: 1,
  limits: [BASE_LIMIT],
};

const BASE_CEILING: TreasuryView["mints"][number] = {
  mint: USDC_MINT_DEVNET,
  decimals: 6,
  maxPerTx: "500000000",
  maxShortWindow: "8000000000",
  maxLongWindow: "80000000000",
  maxLifetime: "200000000000",
};

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const SOL_ASSET: VaultBalance["assets"][number] = {
  mint: NATIVE_MINT,
  symbol: "SOL",
  decimals: 9,
  tokenProgram: TOKEN_PROGRAM,
  vault: SOL_VAULT,
  amount: "2410000000",
  exists: true,
  fundingMode: "isolated-vault",
  configured: true,
};

const USDC_ASSET: VaultBalance["assets"][number] = {
  mint: USDC_MINT_DEVNET,
  symbol: "USDC",
  decimals: 6,
  tokenProgram: TOKEN_PROGRAM,
  vault: SOL_VAULT,
  amount: "1500000000",
  exists: true,
  fundingMode: "isolated-vault",
  configured: true,
};

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    address: SESSION_A,
    label: "cfo-bot",
    sessionKey: SESSION_A,
    policy: POLICY,
    expiresAt: 2_000_000_000,
    revoked: false,
    seq: "47",
    auditHead: HEAD_A,
    spend: [BASE_COUNTER],
    ...overrides,
  };
}

function treasury(overrides: Partial<TreasuryView> = {}): TreasuryView {
  return {
    address: TREASURY,
    owner: "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD",
    operator: "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD",
    paused: false,
    solVaultAddress: SOL_VAULT,
    solVaultLamports: 2_410_000_000,
    activeSessions: 1,
    policyCount: 1,
    mints: [BASE_CEILING],
    policies: [BASE_POLICY],
    sessions: [session()],
    decimals: { [USDC_MINT_DEVNET]: 6, [NATIVE_MINT]: 9 },
    ...overrides,
  };
}

function vault(overrides: Partial<VaultBalance> = {}): VaultBalance {
  return {
    treasury: TREASURY,
    solVault: SOL_VAULT,
    lamports: 2_410_000_000,
    owner: "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD",
    assets: [SOL_ASSET, USDC_ASSET],
    ...overrides,
  };
}

const PRICE: SolPrice = {
  usd: 182.4,
  change24h: -1.2,
  source: "coingecko",
  asOf: "2026-09-25T12:00:00.000Z",
};

function input(overrides: Partial<FoldInput> = {}): FoldInput {
  return {
    cluster: "devnet",
    asOf: "2026-09-25T12:00:00.000Z",
    scope: { workflowId: null, agentId: null, mint: null },
    period: "short-window",
    treasuries: [treasury()],
    vaults: [vault()],
    price: PRICE,
    sessionFilter: null,
    unreadable: [],
    ...overrides,
  };
}

describe("holdings", () => {
  it("prices native at spot and a pegged mint one to one", () => {
    const { holdings } = foldMetrics(input());
    // 2.41 SOL × 182.40 = 439.584, plus 1500 USDC at par.
    expect(holdings.usd).toBeCloseTo(2.41 * 182.4 + 1500, 6);
    expect(holdings.partial).toBe(false);
    expect(holdings.excluded).toBe(0);
  });

  it("excludes an unpriceable mint from the total and says how many", () => {
    const unknown = "So11111111111111111111111111111111111111113";
    const withUnknown = vault({
      assets: [
        SOL_ASSET,
        USDC_ASSET,
        { ...USDC_ASSET, mint: unknown, symbol: null, amount: "9000000" },
      ],
    });
    const { holdings } = foldMetrics(input({ vaults: [withUnknown] }));
    expect(holdings.excluded).toBe(1);
    expect(holdings.partial).toBe(true);
    // The unknown mint contributes nothing rather than being counted as zero
    // dollars of a real balance.
    expect(holdings.usd).toBeCloseTo(2.41 * 182.4 + 1500, 6);
  });

  it("reports no dollar total at all when the price feed is down", () => {
    const { holdings } = foldMetrics(
      input({ price: null, vaults: [vault({ assets: [SOL_ASSET] })] }),
    );
    expect(holdings.usd).toBeNull();
    expect(holdings.assets[0]?.usd).toBeNull();
  });
});

describe("spend", () => {
  it("reads the counter the selected period names", () => {
    const short = foldMetrics(input({ period: "short-window" })).spend;
    const long = foldMetrics(input({ period: "long-window" })).spend;
    const life = foldMetrics(input({ period: "session-life" })).spend;

    expect(short.byMint[0]?.raw).toBe("1500000000");
    expect(long.byMint[0]?.raw).toBe("4100000000");
    expect(life.byMint[0]?.raw).toBe("5320000000");
    expect(short.exactness).toBe("counter");
  });

  it("sums across sessions in base units, never through a float", () => {
    // Two counters whose sum is past Number.MAX_SAFE_INTEGER: a float would
    // round this and a u64 does not.
    const huge = { ...BASE_COUNTER, shortSpent: "9007199254740993" };
    const big = treasury({
      sessions: [
        session({ spend: [huge] }),
        session({ address: SESSION_B, auditHead: HEAD_B, spend: [huge] }),
      ],
    });
    const { spend } = foldMetrics(input({ treasuries: [big] }));
    expect(spend.byMint[0]?.raw).toBe("18014398509481986");
  });

  it("reports unavailable, not zero, when there is no counter to read", () => {
    const { spend } = foldMetrics(input({ treasuries: [treasury({ sessions: [] })] }));
    expect(spend.byMint).toEqual([]);
    expect(spend.exactness).toBe("unavailable");
  });

  it("honours a mint-scoped view", () => {
    const { spend } = foldMetrics(
      input({ scope: { workflowId: null, agentId: null, mint: NATIVE_MINT } }),
    );
    expect(spend.byMint).toEqual([]);
  });
});

describe("payments", () => {
  it("counts seq exactly and flags that it is lifetime", () => {
    const { payments } = foldMetrics(input());
    expect(payments.count).toBe(47);
    expect(payments.exactness).toBe("counter");
    expect(payments.lifetimeOnly).toBe(true);
  });

  it("sums seq across sessions", () => {
    const two = treasury({
      sessions: [session(), session({ address: SESSION_B, seq: "12", auditHead: HEAD_B })],
    });
    expect(foldMetrics(input({ treasuries: [two] })).payments.count).toBe(59);
  });

  it("is unavailable with no session, so an empty treasury never reads as zero payments", () => {
    const { payments } = foldMetrics(input({ treasuries: [treasury({ sessions: [] })] }));
    expect(payments.exactness).toBe("unavailable");
  });

  it("narrows to one session when the scope names an agent", () => {
    const two = treasury({
      sessions: [session(), session({ address: SESSION_B, seq: "12", auditHead: HEAD_B })],
    });
    const { payments } = foldMetrics(input({ treasuries: [two], sessionFilter: [SESSION_B] }));
    expect(payments.count).toBe(12);
  });
});

describe("denials", () => {
  it("is never a zero in Phase A", () => {
    const { denials } = foldMetrics(input());
    expect(denials.count).toBeNull();
    expect(denials.exactness).toBe("unavailable");
  });
});

describe("headroom", () => {
  it("emits short, long and lifetime, and not per-tx", () => {
    const { headroom } = foldMetrics(input());
    expect(headroom.map((row) => row.window)).toEqual(["short", "long", "lifetime"]);
  });

  it("carries the policy's own window duration rather than a hardcoded day", () => {
    const sixHour = treasury({
      policies: [{ ...BASE_POLICY, limits: [{ ...BASE_LIMIT, shortWindowSeconds: 21_600 }] }],
    });
    const { headroom, period } = foldMetrics(input({ treasuries: [sixHour] }));
    expect(headroom[0]?.windowSeconds).toBe(21_600);
    expect(period.seconds).toBe(21_600);
  });

  it("pairs each window with the owner ceiling for the same window", () => {
    const { headroom } = foldMetrics(input());
    expect(headroom[0]?.ceilingRaw).toBe("8000000000");
    expect(headroom[1]?.ceilingRaw).toBe("80000000000");
    expect(headroom[2]?.ceilingRaw).toBe("200000000000");
  });

  it("marks the u64::MAX sentinel unlimited instead of printing it", () => {
    const unlimited = treasury({
      policies: [{ ...BASE_POLICY, limits: [{ ...BASE_LIMIT, shortWindowMax: U64_MAX }] }],
    });
    const { headroom } = foldMetrics(input({ treasuries: [unlimited] }));
    expect(headroom[0]?.unlimited).toBe(true);
  });

  it("charges spend only to the policy the session is bound to", () => {
    const other = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const twoPolicies = treasury({
      policies: [BASE_POLICY, { ...BASE_POLICY, address: other, name: "second" }],
    });
    const { headroom } = foldMetrics(input({ treasuries: [twoPolicies] }));
    const second = headroom.filter((row) => row.policy === other);
    // The only session is bound to the first policy, so the second has spent
    // nothing — not the same total counted twice.
    expect(second.every((row) => row.spentRaw === "0")).toBe(true);
  });
});

describe("tightestConstraint", () => {
  it("picks the window with the least left", () => {
    const { headroom } = foldMetrics(input());
    const tightest = tightestConstraint(headroom);
    expect(tightest).not.toBeNull();
    expect(tightest?.window).toBe("short");
    expect(tightest && remainingRaw(tightest)).toBe("3500000000");
  });

  it("skips unlimited windows rather than ranking them as the loosest", () => {
    const rows = foldMetrics(input()).headroom.map((row) =>
      row.window === "short" ? { ...row, unlimited: true, policyMaxRaw: U64_MAX } : row,
    );
    expect(tightestConstraint(rows)?.window).not.toBe("short");
  });

  it("returns null when nothing in scope is limited", () => {
    const rows = foldMetrics(input()).headroom.map((row) => ({
      ...row,
      unlimited: true,
      policyMaxRaw: U64_MAX,
    }));
    expect(tightestConstraint(rows)).toBeNull();
  });

  it("floors remaining at zero once spend has reached the limit", () => {
    const [row] = foldMetrics(input()).headroom;
    expect(row).toBeDefined();
    expect(row && remainingRaw({ ...row, spentRaw: "9999999999999" })).toBe("0");
  });
});

describe("integrity", () => {
  it("reports the recorded head and leaves verification unclaimed", () => {
    const { integrity } = foldMetrics(input());
    expect(integrity[0]?.auditHead).toBe(HEAD_A);
    expect(integrity[0]?.seq).toBe("47");
    // Not verified is not broken, and Phase A must not imply otherwise.
    expect(integrity[0]?.verifiedThroughSeq).toBeNull();
  });
});

describe("period", () => {
  it("takes the most recent short-window start, which is the live bucket", () => {
    const two = treasury({
      sessions: [
        session({ spend: [{ ...BASE_COUNTER, shortWindowStart: 1_700_000_000 }] }),
        session({
          address: SESSION_B,
          auditHead: HEAD_B,
          spend: [{ ...BASE_COUNTER, shortWindowStart: 1_700_086_400 }],
        }),
      ],
    });
    expect(foldMetrics(input({ treasuries: [two] })).period.startedAt).toBe(1_700_086_400);
  });

  it("reports no start for the long window, which the program does not record", () => {
    const { period } = foldMetrics(input({ period: "long-window" }));
    expect(period.startedAt).toBeNull();
    expect(period.seconds).toBe(2_592_000);
  });

  it("reports no duration for session lifetime, which has none", () => {
    const { period } = foldMetrics(input({ period: "session-life" }));
    expect(period.seconds).toBeNull();
    expect(period.startedAt).toBeNull();
  });
});

describe("partial reads", () => {
  it("passes unreadable treasuries through instead of folding them in as zero", () => {
    const summary = foldMetrics(
      input({ unreadable: [{ treasury: SESSION_B, detail: "rpc timeout" }] }),
    );
    expect(summary.unreadable).toHaveLength(1);
    // The readable treasury still produced its numbers.
    expect(summary.payments.count).toBe(47);
  });
});

describe("priceMoveUsd", () => {
  it("attributes only the price move, on the SOL actually held", () => {
    const summary = foldMetrics(input());
    // 2.41 SOL at 182.40, down 1.2% over the day.
    const expected = 2.41 * 182.4 * (1 - 1 / (1 - 1.2 / 100));
    expect(priceMoveUsd(summary)).toBeCloseTo(expected, 6);
    // Down day, so the move is negative.
    expect(priceMoveUsd(summary) ?? 0).toBeLessThan(0);
  });

  it("is null without a price, and null without a 24h change", () => {
    expect(priceMoveUsd(foldMetrics(input({ price: null })))).toBeNull();
    expect(priceMoveUsd(foldMetrics(input({ price: { ...PRICE, change24h: null } })))).toBeNull();
  });

  it("is null when the vaults hold no SOL", () => {
    const usdcOnly = vault({ assets: [USDC_ASSET] });
    expect(priceMoveUsd(foldMetrics(input({ vaults: [usdcOnly] })))).toBeNull();
  });
});

describe("the §5 fixture", () => {
  const payments = mockPayments(Date.parse("2026-09-25T12:00:00.000Z"));

  it("has twenty rows covering all four outcomes", () => {
    expect(payments).toHaveLength(20);
    const counts = payments.reduce<Record<string, number>>((acc, row) => {
      acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ settled: 15, denied: 3, indeterminate: 1, review_required: 1 });
  });

  it("gives a signature only to settled rows", () => {
    for (const row of payments) {
      expect(Boolean(row.signature)).toBe(row.outcome === "settled");
    }
  });

  it("settles 1,588.50 USDC and 1.25 SOL, and counts no refusal as spend", () => {
    const settled = payments.filter((row) => row.outcome === "settled");
    const usdc = settled
      .filter((row) => row.symbol === "USDC")
      .reduce((total, row) => total + BigInt(row.amount ?? "0"), 0n);
    const sol = settled
      .filter((row) => row.symbol === "SOL")
      .reduce((total, row) => total + BigInt(row.amount ?? "0"), 0n);
    expect(usdc).toBe(1_588_500_000n);
    expect(sol).toBe(1_250_000_000n);
  });

  it("registers a destination that was never paid, so the roster claim is visible", () => {
    const paidTo = new Set(payments.map((row) => row.destination));
    const unpaid = MOCK_DESTINATIONS.filter((dest) => !paidTo.has(dest.owner));
    expect(unpaid.map((dest) => dest.label)).toEqual(["Superteam Earn"]);
  });

  it("marks every row demo, so nothing here can read as chain truth", () => {
    expect(payments.every((row) => row.demo)).toBe(true);
    expect(MOCK_DESTINATIONS.every((dest) => dest.demo)).toBe(true);
  });
});
