import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSolanaAddress, RESERVED_PAYEE_ADDRESSES } from "@ash/contract/template-run";
import { describe, expect, it } from "vitest";
import {
  COMMITMENT_MEMO,
  COMMITMENT_MEMO_PREFIX,
  commitmentMemo,
  MEMO_PROGRAM_ADDRESS,
  PRIVACY_TEXT_SHA256,
  parseCommitmentMemo,
} from "./commitment.js";
// The judges' script is self-contained on purpose (Node's own modules only), so it repeats a few
// constants of `commitment.ts`; it is imported here so that the two cannot drift apart.
import * as verify from "./verify-hash.js";

const TEMPLATE = new URL("../../../examples/templates/cloak-private-payout/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, TEMPLATE), "utf8");
const canonical = (markdown: string) => verify.canonicalizeText(verify.extractText(markdown));

describe("the SPL Memo program address", () => {
  it("is the real one, which mainnet shows as an executable program", () => {
    expect(MEMO_PROGRAM_ADDRESS).toBe("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(isSolanaAddress(MEMO_PROGRAM_ADDRESS)).toBe(true);
    // The payee list was checked against mainnet when it was written; it names the same program.
    expect(RESERVED_PAYEE_ADDRESSES.has(MEMO_PROGRAM_ADDRESS)).toBe(true);
  });

  it("is not the lookalike that was once offered for it", () => {
    // The same first 37 characters, a different ending. It decodes to 31 bytes, so it is not an
    // address at all, and an RPC answers "WrongSize" to it; a transaction aimed at it could not be
    // built.
    const lookalike = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLJwqwG";
    expect(lookalike.slice(0, 37)).toBe(MEMO_PROGRAM_ADDRESS.slice(0, 37));
    expect(lookalike).not.toBe(MEMO_PROGRAM_ADDRESS);
    expect(isSolanaAddress(lookalike)).toBe(false);
  });
});

describe("the memo", () => {
  const hash = "ab".repeat(32);

  it("is a fixed prefix and the hash in lowercase hex", () => {
    expect(commitmentMemo(hash)).toBe(`agent-rails/privacy-text/v1 sha256=${hash}`);
    expect(commitmentMemo(hash).startsWith(COMMITMENT_MEMO_PREFIX)).toBe(true);
    expect(new TextEncoder().encode(COMMITMENT_MEMO).length).toBeLessThan(120);
  });

  it("reads back the hash it carries, and nothing else", () => {
    expect(parseCommitmentMemo(commitmentMemo(hash))).toBe(hash);
    for (const other of [
      "",
      "hello",
      commitmentMemo(hash).toUpperCase(),
      `${commitmentMemo(hash)} `,
      `${COMMITMENT_MEMO_PREFIX}${"ab".repeat(31)}`,
      `${COMMITMENT_MEMO_PREFIX}${"AB".repeat(32)}`,
      `agent-rails/privacy-text/v2 sha256=${hash}`,
    ]) {
      expect(parseCommitmentMemo(other), other).toBeNull();
    }
  });

  it("will not be built from anything but a SHA-256 in lowercase hex", () => {
    for (const bad of ["", "xyz", hash.toUpperCase(), hash.slice(1), `${hash}0`]) {
      expect(() => commitmentMemo(bad), bad).toThrow();
    }
  });
});

describe("the hash is the one of the text that is submitted", () => {
  it("matches PRIVACY.md, so the memo the runner writes vouches for that text", () => {
    expect(
      verify.sha256Hex(canonical(read("PRIVACY.md"))),
      "PRIVACY.md changed. Run `pnpm verify-hash`, paste its SHA-256 into commitment.ts, and write the commitment on-chain again: a hash committed before an edit no longer vouches for the text.",
    ).toBe(PRIVACY_TEXT_SHA256);
    expect(COMMITMENT_MEMO).toBe(commitmentMemo(PRIVACY_TEXT_SHA256));
  });

  it("is a text inside the Privacy Sprint's word limit, in both languages", () => {
    for (const name of ["PRIVACY.md", "PRIVACY.en.md"]) {
      const words = verify.countWords(canonical(read(name)));
      expect(words, name).toBeGreaterThan(200);
      expect(words, name).toBeLessThanOrEqual(verify.WORD_LIMIT);
    }
  });

  it("is found by the script's own default path, from where the script lives", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const found = readFileSync(resolve(here, verify.DEFAULT_TEXT_PATH), "utf8");
    expect(found).toBe(read("PRIVACY.md"));
  });

  it("changes with one character of the text", () => {
    const text = canonical(read("PRIVACY.md"));
    const edited = text.replace("Cloak", "Clóak");
    expect(edited).not.toBe(text);
    expect(verify.sha256Hex(edited)).not.toBe(verify.sha256Hex(text));
  });
});

describe("the judges' script and this package say the same thing", () => {
  it("shares the program, the prefix and the format", () => {
    expect(verify.MEMO_PROGRAM_ADDRESS).toBe(MEMO_PROGRAM_ADDRESS);
    expect(verify.MEMO_PREFIX).toBe(COMMITMENT_MEMO_PREFIX);
    expect(verify.expectedMemo("cd".repeat(32))).toBe(commitmentMemo("cd".repeat(32)));
    expect(verify.expectedMemo(PRIVACY_TEXT_SHA256)).toBe(COMMITMENT_MEMO);
    expect(() => verify.expectedMemo("nope")).toThrow();
  });
});

describe("canonicalizeText", () => {
  it("makes the same text from line ends, trailing spaces and extra blank lines", () => {
    const plain = "Um parágrafo.\n\nOutro parágrafo.";
    for (const variant of [
      "Um parágrafo.\r\n\r\nOutro parágrafo.",
      "Um parágrafo.  \n\t\nOutro parágrafo.   ",
      "\n\n  \nUm parágrafo.\n\n\n\n\nOutro parágrafo.\n\n",
      "Um parágrafo.\r\rOutro parágrafo.",
    ]) {
      expect(verify.canonicalizeText(variant), JSON.stringify(variant)).toBe(plain);
    }
  });

  it("treats a composed and a decomposed accent as the same letter", () => {
    expect(verify.canonicalizeText("á")).toBe(verify.canonicalizeText("á"));
  });

  it("keeps what is the text: words, punctuation, the paragraph break, markup", () => {
    const text = "**Rótulo.** Uma frase, com `código`.\n\nSegundo *parágrafo*.";
    expect(verify.canonicalizeText(text)).toBe(text);
    expect(verify.canonicalizeText("a b")).not.toBe(verify.canonicalizeText("a  b"));
  });

  it("is idempotent", () => {
    const once = verify.canonicalizeText("  x \r\n\r\n\r\n y  ");
    expect(verify.canonicalizeText(once)).toBe(once);
  });
});

describe("sha256Hex and countWords", () => {
  it("is SHA-256 of the UTF-8 bytes, as any other tool computes it", () => {
    expect(verify.sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // "é" is the two bytes C3 A9 in UTF-8: a tool that hashed Latin-1 would get another value.
    expect(verify.sha256Hex("é")).toBe(
      createHash("sha256")
        .update(Buffer.from([0xc3, 0xa9]))
        .digest("hex"),
    );
    expect(verify.sha256Hex("é")).not.toBe(verify.sha256Hex("e"));
  });

  it("counts words as wc -w does", () => {
    expect(verify.countWords("um dois  três\nquatro\n\ncinco")).toBe(5);
    expect(verify.countWords("")).toBe(0);
  });
});

describe("extractText", () => {
  it("takes what is between the Portuguese markers", () => {
    const md = "# T\n<!-- texto:inicio -->\nO texto.\n<!-- texto:fim -->\nDepois.";
    expect(canonical(md)).toBe("O texto.");
  });

  it("takes what is between the English markers", () => {
    const md = "# T\n<!-- text:start -->\nThe text.\n<!-- text:end -->\nAfter.";
    expect(canonical(md)).toBe("The text.");
  });

  it("takes the whole input when there are no markers, as for text pasted from a form", () => {
    expect(canonical("Only the text.\r\n")).toBe("Only the text.");
  });

  it("refuses an opening marker that is never closed", () => {
    expect(() => verify.extractText("<!-- texto:inicio -->\nx")).toThrow(/texto:fim/);
  });
});

const MEMO = commitmentMemo("12".repeat(32));
const transaction = (memo: string, overrides: Record<string, unknown> = {}) => ({
  slot: 123_456,
  blockTime: 1_791_000_000,
  meta: { err: null },
  transaction: {
    signatures: ["sig"],
    message: {
      accountKeys: [
        { pubkey: "FunderWallet", signer: true, writable: true },
        { pubkey: MEMO_PROGRAM_ADDRESS, signer: false, writable: false },
      ],
      instructions: [{ program: "spl-memo", programId: MEMO_PROGRAM_ADDRESS, parsed: memo }],
    },
  },
  ...overrides,
});

describe("verifyTransaction", () => {
  it("accepts the transaction whose Memo instruction carries the hash, and says who and when", () => {
    expect(verify.verifyTransaction(transaction(MEMO), MEMO, null)).toEqual({
      ok: true,
      memo: MEMO,
      feePayer: "FunderWallet",
      slot: 123_456,
      blockTime: new Date(1_791_000_000 * 1000).toISOString(),
    });
  });

  it("refuses a different memo, naming both", () => {
    const verdict = verify.verifyTransaction(
      transaction(commitmentMemo("34".repeat(32))),
      MEMO,
      null,
    );
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain("34".repeat(32));
    expect(!verdict.ok && verdict.reason).toContain("12".repeat(32));
  });

  it("refuses a transaction that failed, whatever it carried", () => {
    const failed = transaction(MEMO, { meta: { err: { InstructionError: [0, "Custom"] } } });
    expect(verify.verifyTransaction(failed, MEMO, null)).toMatchObject({ ok: false });
  });

  it("refuses an answer with no transaction in it", () => {
    expect(verify.verifyTransaction(null, MEMO, null)).toMatchObject({ ok: false });
  });

  it("does not take another program for the Memo program because it calls itself one", () => {
    const impostor = transaction(MEMO, {});
    impostor.transaction.message.instructions = [
      {
        program: "spl-memo",
        programId: "Impostor1111111111111111111111111111111111",
        parsed: MEMO,
      },
    ];
    const verdict = verify.verifyTransaction(impostor, MEMO, null);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain("no instruction of the Memo program");
  });

  it("accepts a transaction with several memos when one of them is the commitment", () => {
    const several = transaction("something else");
    several.transaction.message.instructions.push({
      program: "spl-memo",
      programId: MEMO_PROGRAM_ADDRESS,
      parsed: MEMO,
    });
    expect(verify.verifyTransaction(several, MEMO, null)).toMatchObject({ ok: true });
  });

  it("can require the wallet that paid and signed, which binds the commitment to the team's", () => {
    expect(verify.verifyTransaction(transaction(MEMO), MEMO, "FunderWallet")).toMatchObject({
      ok: true,
    });
    const other = verify.verifyTransaction(transaction(MEMO), MEMO, "SomeoneElse");
    expect(other.ok).toBe(false);
    expect(!other.ok && other.reason).toContain("FunderWallet");
  });
});

describe("the command line", () => {
  const SOURCE =
    "# Texto\n<!-- texto:inicio -->\n\nPrimeiro parágrafo.\n\nSegundo parágrafo.\n<!-- texto:fim -->\n";
  const HASH = verify.sha256Hex("Primeiro parágrafo.\n\nSegundo parágrafo.");

  function ioFor(
    options: {
      answer?: unknown;
      failFetch?: Error;
      stdin?: string;
      env?: Record<string, string>;
      files?: Record<string, string>;
    } = {},
  ) {
    const lines: string[] = [];
    const requests: { url: string; body: unknown }[] = [];
    const files: Record<string, string> = {
      "/repo/examples/templates/cloak-private-payout/PRIVACY.md": SOURCE,
      ...options.files,
    };
    const io: verify.Io = {
      out: (line) => lines.push(line),
      readText: (path) => {
        const text = files[path];
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
        return text;
      },
      readStdin: () => options.stdin ?? "",
      fetchJson: async (url, body) => {
        requests.push({ url, body });
        if (options.failFetch) throw options.failFetch;
        return options.answer;
      },
      env: (name) => options.env?.[name],
      here: "/repo/packages/cloak/src",
    };
    return { io, lines, requests, text: () => lines.join("\n") };
  }

  it("hashes the text next to it by default, and prints what to look for on-chain", async () => {
    const { io, text, requests } = ioFor();
    expect(await verify.run([], io)).toBe(0);
    expect(text()).toContain(`SHA-256   ${HASH}`);
    expect(text()).toContain(`Memo      agent-rails/privacy-text/v1 sha256=${HASH}`);
    expect(text()).toContain("Words     4");
    expect(requests).toEqual([]); // no network unless asked
  });

  it("prints the canonical text alone, for a reader who would rather use sha256sum", async () => {
    const { io, lines } = ioFor();
    expect(await verify.run(["--print-text"], io)).toBe(0);
    expect(lines).toEqual(["Primeiro parágrafo.\n\nSegundo parágrafo."]);
  });

  it("gives the same hash for the text pasted from a form, whatever its line ends", async () => {
    const { io, text } = ioFor({ stdin: "Primeiro parágrafo.\r\n\r\nSegundo parágrafo.  \r\n" });
    expect(await verify.run(["--stdin"], io)).toBe(0);
    expect(text()).toContain(HASH);
  });

  it("hashes another file on request", async () => {
    const { io, text } = ioFor({ files: { "/x/other.md": "Só isto." } });
    expect(await verify.run(["--text-file", "/x/other.md"], io)).toBe(0);
    expect(text()).toContain(verify.sha256Hex("Só isto."));
  });

  it("warns when the text is over the limit", async () => {
    const { io, text } = ioFor({ files: { "/x/long.md": "palavra ".repeat(301) } });
    expect(await verify.run(["--text-file", "/x/long.md"], io)).toBe(0);
    expect(text()).toContain("OVER the 300-word limit");
  });

  describe("with --tx", () => {
    const memo = commitmentMemo(HASH);

    it("verifies a transaction whose memo is the hash, and asks the RPC the right question", async () => {
      const { io, text, requests } = ioFor({ answer: { result: transaction(memo) } });
      expect(await verify.run(["--tx", "SIGNATURE", "--rpc", "https://rpc.example"], io)).toBe(0);
      expect(text()).toContain("RESULT: VERIFIED");
      expect(text()).toContain("Signed by    FunderWallet");
      expect(text()).toContain("https://explorer.solana.com/tx/SIGNATURE");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://rpc.example");
      expect(requests[0]?.body).toMatchObject({
        method: "getTransaction",
        params: ["SIGNATURE", { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      });
    });

    it("exits 1 when the memo on-chain is another hash, as it would after the text was edited", async () => {
      const { io, text } = ioFor({
        answer: { result: transaction(commitmentMemo("ff".repeat(32))) },
      });
      expect(await verify.run(["--tx", "SIGNATURE"], io)).toBe(1);
      expect(text()).toContain("RESULT: NOT VERIFIED");
      expect(text()).not.toContain("RESULT: VERIFIED");
    });

    it("exits 1 when the wallet is not the one named", async () => {
      const { io, text } = ioFor({ answer: { result: transaction(memo) } });
      expect(await verify.run(["--tx", "SIGNATURE", "--signer", "SomeoneElse"], io)).toBe(1);
      expect(text()).toContain("not by SomeoneElse");
    });

    it("exits 1 when the RPC has no such transaction", async () => {
      const { io, text } = ioFor({ answer: { result: null } });
      expect(await verify.run(["--tx", "SIGNATURE"], io)).toBe(1);
      expect(text()).toContain("no such transaction");
    });

    it("exits 2 when the RPC refuses, and when it cannot be reached", async () => {
      const refused = ioFor({ answer: { error: { message: "Invalid param: WrongSize" } } });
      expect(await verify.run(["--tx", "SIGNATURE"], refused.io)).toBe(2);
      expect(refused.text()).toContain("WrongSize");
      const down = ioFor({ failFetch: new Error("fetch failed") });
      expect(await verify.run(["--tx", "SIGNATURE"], down.io)).toBe(2);
      expect(down.text()).toContain("could not reach the RPC");
    });

    it("uses --rpc, then $SOLANA_RPC_URL, then the public endpoint", async () => {
      const answer = { result: transaction(memo) };
      const flag = ioFor({ answer, env: { SOLANA_RPC_URL: "https://env.example" } });
      await verify.run(["--tx", "S", "--rpc", "https://flag.example"], flag.io);
      expect(flag.requests[0]?.url).toBe("https://flag.example");
      const env = ioFor({ answer, env: { SOLANA_RPC_URL: " https://env.example " } });
      await verify.run(["--tx", "S"], env.io);
      expect(env.requests[0]?.url).toBe("https://env.example");
      const none = ioFor({ answer });
      await verify.run(["--tx", "S"], none.io);
      expect(none.requests[0]?.url).toBe("https://api.mainnet-beta.solana.com");
    });
  });

  it("exits 2 on a bad argument, a flag with no value, or text it cannot read", async () => {
    for (const argv of [["--nope"], ["--tx"], ["--tx", "--rpc"], ["--text-file", "/missing.md"]]) {
      const { io } = ioFor();
      expect(await verify.run(argv, io), argv.join(" ")).toBe(2);
    }
  });

  it("exits 2 on an empty text rather than hashing nothing", async () => {
    const { io } = ioFor({ stdin: "  \n\n " });
    expect(await verify.run(["--stdin"], io)).toBe(2);
  });

  it("prints its usage", async () => {
    const { io, text } = ioFor();
    expect(await verify.run(["--help"], io)).toBe(0);
    expect(text()).toContain("--tx <signature>");
  });
});
