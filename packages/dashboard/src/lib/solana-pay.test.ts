import { describe, expect, it } from "vitest";
import {
  microsToDecimal,
  type ParsedTransaction,
  receivedBaseUnits,
  transactionRequestUrl,
  transferRequestUrl,
  USDC_MINTS,
} from "./solana-pay";

const RECIPIENT = "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT: string = USDC_MINTS["mainnet-beta"];

const bal = (accountIndex: number, owner: string, amount: string, mint = MINT) => ({
  accountIndex,
  mint,
  owner,
  uiTokenAmount: { amount },
});

describe("microsToDecimal", () => {
  it("writes Solana Pay's decimal without exponent or trailing zeros", () => {
    expect(microsToDecimal(10_000_000)).toBe("10");
    expect(microsToDecimal(1_500_000)).toBe("1.5");
    expect(microsToDecimal(1)).toBe("0.000001");
  });
});

describe("transferRequestUrl", () => {
  it("builds a solana: URL with the SPL token and reference", () => {
    const url = transferRequestUrl({
      recipient: RECIPIENT,
      amountMicros: 25_000_000,
      mint: MINT,
      reference: PAYER,
      label: "Agent Rails",
      message: "Assistant credit",
    });
    expect(url.startsWith(`solana:${RECIPIENT}?`)).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(query.get("amount")).toBe("25");
    expect(query.get("spl-token")).toBe(MINT);
    expect(query.get("reference")).toBe(PAYER);
  });
});

describe("receivedBaseUnits", () => {
  it("counts what reached the recipient's token account", () => {
    const tx: ParsedTransaction = {
      meta: {
        err: null,
        preTokenBalances: [bal(1, PAYER, "50000000"), bal(2, RECIPIENT, "1000000")],
        postTokenBalances: [bal(1, PAYER, "40000000"), bal(2, RECIPIENT, "11000000")],
      },
    };
    expect(receivedBaseUnits(tx, RECIPIENT, MINT)).toBe(10_000_000n);
  });

  it("counts a token account created by the transfer itself", () => {
    const tx: ParsedTransaction = {
      meta: { err: null, preTokenBalances: [], postTokenBalances: [bal(3, RECIPIENT, "5000000")] },
    };
    expect(receivedBaseUnits(tx, RECIPIENT, MINT)).toBe(5_000_000n);
  });

  it("ignores another mint, another owner, and a failed transaction", () => {
    const other: ParsedTransaction = {
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [
          bal(2, RECIPIENT, "9000000", USDC_MINTS.devnet),
          bal(4, PAYER, "9000000"),
        ],
      },
    };
    expect(receivedBaseUnits(other, RECIPIENT, MINT)).toBe(0n);

    const failed: ParsedTransaction = {
      meta: {
        err: { InstructionError: [0, "Custom"] },
        preTokenBalances: [],
        postTokenBalances: [bal(2, RECIPIENT, "9000000")],
      },
    };
    expect(receivedBaseUnits(failed, RECIPIENT, MINT)).toBe(0n);
  });

  it("never reports an outflow as a negative deposit", () => {
    const tx: ParsedTransaction = {
      meta: {
        err: null,
        preTokenBalances: [bal(2, RECIPIENT, "9000000")],
        postTokenBalances: [bal(2, RECIPIENT, "1000000")],
      },
    };
    expect(receivedBaseUnits(tx, RECIPIENT, MINT)).toBe(0n);
  });
});

describe("transactionRequestUrl", () => {
  it("leaves a link without query parameters unencoded, as wallets expect", () => {
    expect(transactionRequestUrl("https://console.ash.app.br/api/billing/deposits/abc/tx")).toBe(
      "solana:https://console.ash.app.br/api/billing/deposits/abc/tx",
    );
  });

  it("encodes a link that carries its own query, so the wallet cannot split it wrong", () => {
    expect(transactionRequestUrl("https://example.com/tx?id=1&x=2")).toBe(
      `solana:${encodeURIComponent("https://example.com/tx?id=1&x=2")}`,
    );
  });

  it("refuses anything but https", () => {
    expect(() => transactionRequestUrl("http://example.com/tx")).toThrow();
  });
});
