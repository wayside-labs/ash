import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The privilege split is MCP versus operator surfaces, not CLI versus dashboard
 * (ADR-021). MCP never reaches privileged builders; CLI and dashboard may, under
 * the same on-chain role checks.
 *
 * This test is the allowlist made mechanical. Importing a builder outside
 * `ALLOWED` fails the suite, so wiring a new on-chain action into a React page
 * takes a deliberate edit here and the ADR that goes with it.
 *
 * Wave 1 adds session create; wave 2+ may add policy, allowlist, pause. Each
 * expansion is explicit. Payment instructions stay forbidden — they belong to
 * the session key via MCP, not to a tab the operator has open.
 */

const SRC = join(import.meta.dirname, "../..");

const ALLOWED = new Set([
  "getWithdrawInstruction",
  "getWithdrawInstructionAsync",
  "getCreateSessionInstruction",
]);

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
