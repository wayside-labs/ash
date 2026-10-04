import { describe, expect, it } from "vitest";
import {
  CLOAK_PAYOUT_LIMITS,
  CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
  cloakPayoutProposalSchema,
  extractTemplateRunProposals,
  formatLamportsAsSol,
  isSolanaAddress,
  PROOF_PACK_API_VERSION,
  parseSolToLamports,
  proofPackSchema,
  RESERVED_PAYEE_ADDRESSES,
  RUN_ERROR_CODES,
  RUN_STEPS,
  runEventSchema,
  SYSTEM_PROGRAM_ADDRESS,
  TEMPLATE_RUN_API_VERSION,
  TEMPLATE_RUN_FENCE,
  withoutTemplateRunBlocks,
  ZEC_MINT,
} from "./template-run.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Deterministic, valid, non-reserved 32-byte address (no real wallet appears in the repo). */
function addr(seed: number): string {
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

const SIG = "5".repeat(87);

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    template: CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
    payees: [
      { label: "Vendor A", address: addr(1), deliver: "SOL", amountSol: "0.02" },
      { label: "Vendor A", address: addr(1), deliver: "ZEC", amountSol: "0.02" },
    ],
    ...overrides,
  };
}

function fence(body: string, info = "") {
  return `\`\`\`${TEMPLATE_RUN_FENCE}${info}\n${body}\n\`\`\``;
}

describe("isSolanaAddress", () => {
  it("accepts real addresses, including the all-ones System Program", () => {
    for (const a of [
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      "11111111111111111111111111111111",
      addr(7),
    ]) {
      expect(isSolanaAddress(a), a).toBe(true);
    }
  });

  it("rejects what is not exactly 32 bytes of base58", () => {
    for (const a of [
      "",
      "abc",
      "0".repeat(44), // not in the alphabet
      "l".repeat(44),
      "O".repeat(44),
      "1".repeat(31),
      "1".repeat(33), // decodes to 33 zero bytes
      "z".repeat(44), // decodes past 256 bits
      `${addr(3)} `,
      ` ${addr(3)}`,
      `${addr(3)}\n`,
    ]) {
      expect(isSolanaAddress(a), JSON.stringify(a)).toBe(false);
    }
  });
});

describe("SOL amounts", () => {
  it("parses plain decimals to lamports, exactly", () => {
    expect(parseSolToLamports("0.02")).toBe(20_000_000n);
    expect(parseSolToLamports("0.020000000")).toBe(20_000_000n);
    expect(parseSolToLamports("1")).toBe(1_000_000_000n);
    expect(parseSolToLamports("0.000000001")).toBe(1n);
    expect(parseSolToLamports("1234.5")).toBe(1_234_500_000_000n);
  });

  it("refuses anything that is not a plain decimal", () => {
    for (const v of [
      "",
      " 0.02",
      "0.02 ",
      "1e-2",
      "-1",
      "+1",
      ".5",
      "5.",
      "0.0000000001",
      "0,02",
      "NaN",
      "0x10",
      "12345",
    ]) {
      expect(parseSolToLamports(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("formats lamports back without trailing zeros", () => {
    expect(formatLamportsAsSol(20_000_000n)).toBe("0.02");
    expect(formatLamportsAsSol(1_000_000_000n)).toBe("1");
    expect(formatLamportsAsSol(5_060_000n)).toBe("0.00506");
    expect(formatLamportsAsSol(1n)).toBe("0.000000001");
    expect(formatLamportsAsSol(0n)).toBe("0");
    expect(formatLamportsAsSol(-1_500_000n)).toBe("-0.0015");
  });

  it("round-trips every value the parser accepts", () => {
    for (const lamports of [1n, 10_000_000n, 49_999_999n, 123_456_789n, 9_999_999_999_999n]) {
      expect(parseSolToLamports(formatLamportsAsSol(lamports))).toBe(lamports);
    }
  });
});

describe("cloakPayoutProposalSchema", () => {
  it("accepts a proposal and fills the api version", () => {
    const parsed = cloakPayoutProposalSchema.parse(proposal());
    expect(parsed.apiVersion).toBe(TEMPLATE_RUN_API_VERSION);
    expect(parsed.payees).toHaveLength(2);
  });

  it("lets one address receive SOL and ZEC, but not the same asset twice", () => {
    expect(cloakPayoutProposalSchema.safeParse(proposal()).success).toBe(true);
    const twice = proposal({
      payees: [
        { label: "A", address: addr(1), deliver: "SOL", amountSol: "0.02" },
        { label: "B", address: addr(1), deliver: "SOL", amountSol: "0.02" },
      ],
    });
    const result = cloakPayoutProposalSchema.safeParse(twice);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("duplicate payout");
  });

  it("has no field for the network or anything else nobody declared", () => {
    for (const extra of [{ network: "devnet" }, { cluster: "mainnet-beta" }, { memo: "x" }]) {
      expect(cloakPayoutProposalSchema.safeParse(proposal(extra)).success).toBe(false);
    }
    const withExtraPayeeField = proposal({
      payees: [
        { label: "A", address: addr(1), deliver: "SOL", amountSol: "0.02", destination: "x" },
      ],
    });
    expect(cloakPayoutProposalSchema.safeParse(withExtraPayeeField).success).toBe(false);
  });

  it("refuses a template that is not this one", () => {
    expect(
      cloakPayoutProposalSchema.safeParse(proposal({ template: "builtin:dca-sol" })).success,
    ).toBe(false);
  });

  it("enforces 1 to 4 payees", () => {
    expect(cloakPayoutProposalSchema.safeParse(proposal({ payees: [] })).success).toBe(false);
    const five = Array.from({ length: CLOAK_PAYOUT_LIMITS.maxPayees + 1 }, (_, i) => ({
      label: `P${i}`,
      address: addr(10 + i),
      deliver: "SOL",
      amountSol: "0.01",
    }));
    expect(cloakPayoutProposalSchema.safeParse(proposal({ payees: five })).success).toBe(false);
    expect(
      cloakPayoutProposalSchema.safeParse(proposal({ payees: five.slice(0, 4) })).success,
    ).toBe(true);
  });

  it("enforces the per-payee floor and ceiling and the per-run ceiling", () => {
    const one = (amountSol: string) =>
      proposal({
        payees: [{ label: "A", address: addr(1), deliver: "SOL", amountSol }],
      });
    expect(cloakPayoutProposalSchema.safeParse(one("0.009999999")).success).toBe(false);
    expect(cloakPayoutProposalSchema.safeParse(one("0.01")).success).toBe(true);
    expect(cloakPayoutProposalSchema.safeParse(one("0.05")).success).toBe(true);
    expect(cloakPayoutProposalSchema.safeParse(one("0.050000001")).success).toBe(false);

    // 3 x 0.04 = 0.12 > 0.10 even though each payee is under its own cap.
    const over = proposal({
      payees: [1, 2, 3].map((i) => ({
        label: `P${i}`,
        address: addr(20 + i),
        deliver: "SOL",
        amountSol: "0.04",
      })),
    });
    const result = cloakPayoutProposalSchema.safeParse(over);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("0.10 SOL cap");
  });

  it("refuses amounts written in any way the card would not show verbatim", () => {
    for (const amountSol of ["1e-2", "0,02", " 0.02", "0.02 ", "-0.02", ".02", "abc", ""]) {
      const p = proposal({
        payees: [{ label: "A", address: addr(1), deliver: "SOL", amountSol }],
      });
      expect(cloakPayoutProposalSchema.safeParse(p).success, JSON.stringify(amountSol)).toBe(false);
    }
    const asNumber = proposal({
      payees: [{ label: "A", address: addr(1), deliver: "SOL", amountSol: 0.02 }],
    });
    expect(cloakPayoutProposalSchema.safeParse(asNumber).success).toBe(false);
  });

  it("refuses programs, mints and burn addresses as payees", () => {
    for (const reserved of RESERVED_PAYEE_ADDRESSES) {
      const p = proposal({
        payees: [{ label: "A", address: reserved, deliver: "SOL", amountSol: "0.02" }],
      });
      expect(cloakPayoutProposalSchema.safeParse(p).success, reserved).toBe(false);
    }
    expect(RESERVED_PAYEE_ADDRESSES.has(ZEC_MINT)).toBe(true);
  });

  it("only lists real 32-byte addresses, so a typo cannot sit in the list unnoticed", () => {
    for (const reserved of RESERVED_PAYEE_ADDRESSES) {
      expect(isSolanaAddress(reserved), reserved).toBe(true);
    }
    // The ones a payout is most likely to hit by accident: a token mint and a sysvar.
    expect(RESERVED_PAYEE_ADDRESSES.has("So11111111111111111111111111111111111111112")).toBe(true);
    expect(RESERVED_PAYEE_ADDRESSES.has("SysvarC1ock11111111111111111111111111111111")).toBe(true);
    expect(SYSTEM_PROGRAM_ADDRESS).toBe("11111111111111111111111111111111");
  });

  it("refuses a bad address and a hostile label", () => {
    // Base58 has no checksum: dropping a character can yield another valid-looking address,
    // which is why the card shows the whole address and asks for a confirmation. Only what
    // cannot be 32 bytes is refused here.
    for (const address of ["not-an-address", addr(1).slice(0, 20), `${addr(1)}x`, `0${addr(1)}`]) {
      const p = proposal({
        payees: [{ label: "A", address, deliver: "SOL", amountSol: "0.02" }],
      });
      expect(cloakPayoutProposalSchema.safeParse(p).success, address).toBe(false);
    }
    for (const label of ["", "   ", "x".repeat(41), "<script>", "a\nb", "Acme; DROP TABLE"]) {
      const p = proposal({
        payees: [{ label, address: addr(1), deliver: "SOL", amountSol: "0.02" }],
      });
      expect(cloakPayoutProposalSchema.safeParse(p).success, JSON.stringify(label)).toBe(false);
    }
    const accented = proposal({
      payees: [{ label: "Fornecedor Ação-1", address: addr(1), deliver: "SOL", amountSol: "0.02" }],
    });
    expect(cloakPayoutProposalSchema.safeParse(accented).success).toBe(true);
  });
});

describe("extractTemplateRunProposals", () => {
  it("returns a validated proposal from a closed block", () => {
    const text = `Here is the plan.\n\n${fence(JSON.stringify(proposal()))}\n\nNothing runs until you approve.`;
    const found = extractTemplateRunProposals(text);
    expect(found).toHaveLength(1);
    expect(found[0]?.ok).toBe(true);
  });

  it("ignores a block that is still streaming in", () => {
    const open = `Plan:\n\`\`\`${TEMPLATE_RUN_FENCE}\n${JSON.stringify(proposal())}`;
    expect(extractTemplateRunProposals(open)).toEqual([]);
  });

  it("tolerates an info string after the language", () => {
    const found = extractTemplateRunProposals(fence(JSON.stringify(proposal()), " json"));
    expect(found[0]?.ok).toBe(true);
  });

  it("reports invalid JSON and schema failures instead of applying them", () => {
    const found = extractTemplateRunProposals(
      `${fence("{ nope")}\n${fence(JSON.stringify(proposal({ payees: [] })))}`,
    );
    expect(found.map((f) => f.ok)).toEqual([false, false]);
    expect(found[0]).toMatchObject({ ok: false, error: "not valid JSON" });
  });

  it("does not read other fences, nor a fence quoted inside another language", () => {
    const other = `\`\`\`json\n${JSON.stringify(proposal())}\n\`\`\``;
    expect(extractTemplateRunProposals(other)).toEqual([]);
    const connector = `\`\`\`connector-bundle\n${JSON.stringify(proposal())}\n\`\`\``;
    expect(extractTemplateRunProposals(connector)).toEqual([]);
  });

  it("returns every block, in order", () => {
    const a = proposal();
    const b = proposal({
      payees: [{ label: "B", address: addr(2), deliver: "SOL", amountSol: "0.03" }],
    });
    const found = extractTemplateRunProposals(
      `${fence(JSON.stringify(a))}\ntext\n${fence(JSON.stringify(b))}`,
    );
    expect(found).toHaveLength(2);
    expect(found.every((f) => f.ok)).toBe(true);
  });

  it("refuses a block too large to be a proposal without parsing it", () => {
    const huge = `{"template":"${"x".repeat(9000)}"}`;
    const [found] = extractTemplateRunProposals(fence(huge));
    expect(found).toMatchObject({ ok: false, error: "proposal is too large" });
    expect(found?.raw.length).toBeLessThanOrEqual(200);
  });

  it("cannot be tricked by a closing fence inside a JSON string", () => {
    const sneaky = proposal({
      payees: [{ label: "A```B", address: addr(1), deliver: "SOL", amountSol: "0.02" }],
    });
    const found = extractTemplateRunProposals(fence(JSON.stringify(sneaky)));
    // The early fence cuts the JSON short: it fails validation, it is never half-applied.
    expect(found.every((f) => !f.ok)).toBe(true);
  });
});

describe("withoutTemplateRunBlocks", () => {
  it("removes the blocks and collapses the gap they leave", () => {
    const text = `Before.\n\n${fence(JSON.stringify(proposal()))}\n\n\n\nAfter.`;
    expect(withoutTemplateRunBlocks(text)).toBe("Before.\n\n\n\nAfter.".replace(/\n{3,}/g, "\n\n"));
  });

  it("leaves a block that is still streaming alone", () => {
    const open = `Plan:\n\`\`\`${TEMPLATE_RUN_FENCE}\n{"a":1`;
    expect(withoutTemplateRunBlocks(open)).toBe(open);
  });
});

describe("runEventSchema", () => {
  const base = {
    runId: "run_1",
    at: "2026-10-04T15:00:00.000Z",
    step: "shield",
    status: "done",
    signature: SIG,
  };

  it("accepts a timeline line", () => {
    expect(runEventSchema.safeParse(base).success).toBe(true);
    expect(
      runEventSchema.safeParse({
        runId: "run_1",
        at: base.at,
        step: "payout",
        status: "failed",
        payeeIndex: 1,
        errorCode: "wallet_rejected",
        message: "Signature rejected in the wallet.",
      }).success,
    ).toBe(true);
  });

  it("has no room for a secret: every undeclared field is refused", () => {
    for (const field of ["privateKey", "nk", "viewingKey", "blinding", "note", "seed", "secret"]) {
      expect(runEventSchema.safeParse({ ...base, [field]: "x" }).success, field).toBe(false);
    }
  });

  it("refuses a malformed signature and an unknown step or error code", () => {
    expect(runEventSchema.safeParse({ ...base, signature: "short" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...base, step: "withdraw-everything" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...base, errorCode: "boom" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...base, payeeIndex: 4 }).success).toBe(false);
  });

  it("has a commit step, between the deposit and the payouts", () => {
    expect(RUN_STEPS).toEqual([
      "preflight",
      "derive-keys",
      "shield",
      "commit",
      "payout",
      "report",
      "recover",
    ]);
    expect(runEventSchema.safeParse({ ...base, step: "commit", signature: SIG }).success).toBe(
      true,
    );
  });

  it("names the stops a run can come to, including the ones added after the first review", () => {
    for (const code of ["quote_moved", "approval_too_slow", "run_in_progress", "outcome_unknown"]) {
      expect(RUN_ERROR_CODES).toContain(code);
      expect(runEventSchema.safeParse({ ...base, errorCode: code }).success, code).toBe(true);
    }
  });
});

describe("proofPackSchema", () => {
  const pack = {
    apiVersion: PROOF_PACK_API_VERSION,
    template: CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
    runId: "run_1",
    cluster: "mainnet-beta",
    cloakProgramId: "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW",
    sdk: { name: "@cloak.dev/sdk", version: "0.2.5" },
    funder: addr(9),
    startedAt: "2026-10-04T15:00:00.000Z",
    finishedAt: "2026-10-04T15:05:00.000Z",
    shield: { signature: SIG, amountLamports: "40000000" },
    payouts: [
      {
        index: 0,
        label: "Vendor A",
        address: addr(1),
        deliver: "SOL",
        grossLamports: "20000000",
        feeLamports: "5060000",
        netLamports: "14940000",
        signature: SIG,
      },
      {
        index: 1,
        label: "Vendor A",
        address: addr(1),
        deliver: "ZEC",
        grossLamports: "20000000",
        feeLamports: "5060000",
        netLamports: "14940000",
        minOutputBaseUnits: "134000",
        signature: SIG,
      },
    ],
    notes: ["Deposit and withdrawal amounts are public."],
  };

  it("accepts a pack and only on mainnet", () => {
    expect(proofPackSchema.safeParse(pack).success).toBe(true);
    expect(proofPackSchema.safeParse({ ...pack, cluster: "devnet" }).success).toBe(false);
  });

  it("carries the commitment that wrote the privacy text's hash on-chain, when there is one", () => {
    const commitment = {
      signature: SIG,
      memo: `agent-rails/privacy-text/v1 sha256=${"a".repeat(64)}`,
    };
    expect(proofPackSchema.safeParse({ ...pack, commitment }).success).toBe(true);
    // Optional: a run made without it is still a valid pack.
    expect(proofPackSchema.safeParse(pack).success).toBe(true);
    for (const bad of [
      { ...commitment, signature: "short" },
      { ...commitment, memo: "" },
      { ...commitment, memo: "x".repeat(201) },
      { ...commitment, extra: "no room for a secret" },
    ]) {
      expect(proofPackSchema.safeParse({ ...pack, commitment: bad }).success).toBe(false);
    }
  });

  it("refuses unknown fields, so a key cannot ride along into the repo", () => {
    expect(proofPackSchema.safeParse({ ...pack, spendKey: "x" }).success).toBe(false);
    const withNote = {
      ...pack,
      payouts: [{ ...pack.payouts[0], note: "base64..." }],
    };
    expect(proofPackSchema.safeParse(withNote).success).toBe(false);
  });
});

describe("a payout written in the wrong fence", () => {
  const withMarker = () => ({ apiVersion: TEMPLATE_RUN_API_VERSION, ...proposal() });
  const tagged = (tag: string, body: unknown) =>
    `\`\`\`${tag}\n${typeof body === "string" ? body : JSON.stringify(body)}\n\`\`\``;

  it("still reaches the card when a model writes json instead of template-run", () => {
    const found = extractTemplateRunProposals(`Plan:\n${tagged("json", withMarker())}\nDone.`);
    expect(found).toHaveLength(1);
    expect(found[0]?.ok).toBe(true);
  });

  it("accepts no language at all, any capitalisation of json, and the other tag the prompt teaches", () => {
    // The last is what Haiku wrote in a rehearsal: the connector fence sits in the same prompt.
    for (const tag of ["", "JSON", "connector-bundle", "text"]) {
      expect(extractTemplateRunProposals(tagged(tag, withMarker()))[0]?.ok, tag).toBe(true);
    }
  });

  it("shows a refusal, not raw JSON, when the payout in a json fence is invalid", () => {
    const bad = {
      ...withMarker(),
      payees: [{ ...proposal().payees[0], address: "not-an-address" }],
    };
    const [found] = extractTemplateRunProposals(tagged("json", bad));
    expect(found).toMatchObject({ ok: false });
    expect(found && !found.ok && found.error).toContain("not a Solana address");
  });

  it("never mistakes other JSON, other languages or prose for a payout", () => {
    for (const block of [
      tagged("json", { hello: "world" }),
      tagged("json", { ...proposal() }), // no apiVersion: not declared as ours
      tagged("json", { apiVersion: "agent-rails.connector/v1", name: "x" }),
      tagged("json", "[1, 2, 3]"),
      tagged("json", "{ not json"),
      tagged("python", 'print("agent-rails.template-run/v1")'),
      // A real connector bundle declares its own version and stays a connector.
      tagged("connector-bundle", { apiVersion: "agent-rails.connector/v1", name: "x" }),
      tagged("bash", `curl -d '${JSON.stringify(withMarker())}' https://example.com`),
      tagged("", "plain text with no structure"),
    ]) {
      expect(extractTemplateRunProposals(`x\n${block}\ny`), block).toEqual([]);
    }
  });

  it("leaves a json block still streaming in alone", () => {
    const open = `Plan:\n\`\`\`json\n${JSON.stringify(withMarker())}`;
    expect(extractTemplateRunProposals(open)).toEqual([]);
    expect(withoutTemplateRunBlocks(open)).toBe(open);
  });

  it("finds the payout among other code blocks and keeps those blocks in the reply", () => {
    const code = '```python\nprint("hi")\n```';
    const text = `Before.\n\n${code}\n\n${tagged("json", withMarker())}\n\nAfter.`;
    expect(extractTemplateRunProposals(text)).toHaveLength(1);
    const stripped = withoutTemplateRunBlocks(text);
    expect(stripped).toContain(code);
    expect(stripped).not.toContain(TEMPLATE_RUN_API_VERSION);
    expect(stripped).toContain("Before.");
    expect(stripped).toContain("After.");
  });

  it("strips a json-fenced payout so the reply shows the card, not the JSON", () => {
    const stripped = withoutTemplateRunBlocks(`Plan.\n\n${tagged("json", withMarker())}\n\nDone.`);
    expect(stripped).toBe("Plan.\n\nDone.".replace(/\n{3,}/g, "\n\n"));
  });

  it("does not parse a json block bigger than a proposal can be", () => {
    const huge = { ...withMarker(), pad: "x".repeat(9000) };
    expect(extractTemplateRunProposals(tagged("json", huge))).toEqual([]);
  });
});

// The reply is parsed again on every streamed chunk, and its text is not ours: a page the model
// quotes can carry anything. A scanner that backtracks turns a long fence line into seconds.
describe("hostile reply text", () => {
  const within = (ms: number, work: () => void) => {
    const started = performance.now();
    work();
    expect(performance.now() - started).toBeLessThan(ms);
  };

  it("takes linear time on a long unterminated fence line", () => {
    const text = `\`\`\`${"a".repeat(200_000)}`;
    within(1000, () => {
      expect(extractTemplateRunProposals(text)).toEqual([]);
      expect(withoutTemplateRunBlocks(text)).toBe(text);
    });
  });

  it("takes linear time on a fence opener repeated on one line, and on many short fences", () => {
    within(1000, () => {
      extractTemplateRunProposals("```a".repeat(50_000));
      extractTemplateRunProposals("```a\n".repeat(50_000));
      extractTemplateRunProposals("```\n```".repeat(25_000));
    });
  });

  it("still finds a payout that follows a pile of junk fences", () => {
    const junk = "```x\nnot json\n```\n".repeat(200);
    const found = extractTemplateRunProposals(`${junk}${fence(JSON.stringify(proposal()))}`);
    expect(found).toHaveLength(1);
    expect(found[0]?.ok).toBe(true);
  });
});
