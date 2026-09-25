import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dashboard is the operator surface's *read* half plus exactly one write:
 * the owner moving funds in and out of their own vault. Everything that
 * loosens a constraint — ceilings, policy, sessions, allowlists, pause — lives
 * in `packages/cli`, and that split is enforced by convention rather than by
 * the type system (CLAUDE.md, ADR-002).
 *
 * This is the convention made mechanical. Importing a privileged instruction
 * builder here fails the suite, so wiring "raise the daily limit" into a React
 * page takes a deliberate edit to this list and the argument that goes with it.
 *
 * `withdraw` is the deliberate exception: it is owner-only in the program, the
 * dashboard offers it only when the *on-chain* owner matches the connected
 * wallet, and it keeps working while paused — which is the point of the
 * kill-switch semantics, not a hole in them.
 */

const SRC = join(import.meta.dirname, "../..");

const ALLOWED = new Set(["getWithdrawInstruction", "getWithdrawInstructionAsync"]);

/**
 * Every instruction the program exposes that a lower-privileged caller must not
 * reach from a browser. Spelled out rather than derived, so adding an
 * instruction to the program does not silently widen what this test permits.
 */
const FORBIDDEN = [
  "getCreateTreasuryInstruction",
  "getSetCeilingInstruction",
  "getAddMintInstruction",
  "getRemoveMintInstruction",
  "getCreatePolicyInstruction",
  "getUpdatePolicyInstruction",
  "getClosePolicyInstruction",
  "getAddAllowlistEntryInstruction",
  "getRemoveAllowlistEntryInstruction",
  "getCreateSessionInstruction",
  "getRevokeSessionInstruction",
  "getCloseSessionInstruction",
  "getSetRolesInstruction",
  "getAddGuardianInstruction",
  "getRemoveGuardianInstruction",
  "getPauseInstruction",
  "getUnpauseInstruction",
  "getEnableNativeAllowanceInstruction",
  "getCloseTreasuryInstruction",
  "getCloseReceiptInstruction",
  // The agent's own payment path. It belongs to the MCP server and the session
  // key, never to a page the owner has open in a tab.
  "getExecutePaymentInstruction",
  "getExecutePaymentSolInstruction",
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

describe("the dashboard's on-chain write surface", () => {
  const files = sourceFiles(SRC);

  it("scans a source tree that actually exists", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const builder of FORBIDDEN) {
    it(`never reaches for ${builder}`, () => {
      const offenders = files.filter((file) => readFileSync(file, "utf8").includes(builder));
      expect(offenders, `${builder} is privileged; it belongs in packages/cli`).toEqual([]);
    });
  }

  it("uses no instruction builder outside the allowed set", () => {
    const seen = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /\bget[A-Z]\w*Instruction(?:Async)?\b/g,
      )) {
        seen.add(match[0]);
      }
    }
    // System and SPL builders are defined inline in `lib/server/solana.ts` and
    // are not Agent Rails instructions, so they are matched by name here only
    // if they follow the same convention — which they deliberately do not.
    const unexpected = [...seen].filter((name) => !ALLOWED.has(name));
    expect(unexpected).toEqual([]);
  });
});
