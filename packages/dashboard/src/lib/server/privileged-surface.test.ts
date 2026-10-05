import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
 * Wave 1 adds session create; wave 2A adds the treasury bootstrap; 2B+ may add
 * policy, allowlist, pause. Each expansion is explicit. Payment instructions stay
 * forbidden — they belong to the session key via MCP, not to a tab the operator
 * has open.
 */

const SRC = join(import.meta.dirname, "../..");

/** Builders this tree may name in its own source. */
const ALLOWED = new Set([
  "getWithdrawInstruction",
  "getWithdrawInstructionAsync",
  "getCreateSessionInstruction",
]);

/**
 * Shared operator modules this tree may import, each with the builders it may reach.
 *
 * A builder reached through one of these never appears in the dashboard's own source,
 * so the text scan above would pass whatever the module grew to contain. The module is
 * read instead — with every relative import it pulls in — and must name nothing outside
 * its set. Wave 2A (ADR-021): `init`'s stages, so the dashboard creates a treasury with
 * exactly the instructions and ordering the CLI does. `update_policy` is here because
 * `buildStages` rewrites a policy that predates a mint; it is not a policy editor, and a
 * page naming it directly still fails the scan above.
 */
const SHARED_OPERATOR_MODULES: Record<string, { source: string; reaches: Set<string> }> = {
  "@ash/cli/bootstrap": {
    source: resolve(SRC, "../../cli/src/bootstrap.ts"),
    reaches: new Set([
      "getCreateTreasuryInstruction",
      "getAddMintInstruction",
      "getCreatePolicyInstruction",
      "getUpdatePolicyInstruction",
      "getAddAllowlistEntryInstruction",
      "getCreateSessionInstruction",
    ]),
  },
};

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

const BUILDER = /\bget[A-Z]\w*Instruction(?:Async)?\b/g;

/** A module and every relative import it reaches, transitively. */
function moduleClosure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const match of readFileSync(entry, "utf8").matchAll(/from "(\.{1,2}\/[^"]+)\.js"/g)) {
    moduleClosure(resolve(dirname(entry), `${match[1]}.ts`), seen);
  }
  return seen;
}

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
      expect(
        offenders,
        `${builder} is privileged; MCP must not reach it (ADR-007). Operator surfaces use an explicit allowlist (ADR-021).`,
      ).toEqual([]);
    });
  }

  it("uses no instruction builder outside the allowed set", () => {
    const seen = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(BUILDER)) {
        seen.add(match[0]);
      }
    }
    // System and SPL builders are defined inline in `lib/server/solana.ts` and
    // are not ASH instructions, so they are matched by name here only
    // if they follow the same convention — which they deliberately do not.
    const unexpected = [...seen].filter((name) => !ALLOWED.has(name));
    expect(unexpected).toEqual([]);
  });

  it("imports no operator module outside the shared allowlist", () => {
    const imported = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(/from "(@ash\/cli[^"]*)"/g)) {
        imported.add(match[1] as string);
      }
    }
    // Positive control: the bootstrap routes do import it, so an empty set means the
    // pattern stopped matching rather than that the dashboard stopped importing.
    expect([...imported]).toContain("@ash/cli/bootstrap");
    expect([...imported].filter((name) => !(name in SHARED_OPERATOR_MODULES))).toEqual([]);
  });

  for (const [name, shared] of Object.entries(SHARED_OPERATOR_MODULES)) {
    it(`${name} reaches only the builders allowlisted for it`, () => {
      const reached = new Set<string>();
      for (const file of moduleClosure(shared.source)) {
        for (const match of readFileSync(file, "utf8").matchAll(BUILDER)) {
          reached.add(match[0]);
        }
      }
      expect(reached.size).toBeGreaterThan(0);
      expect([...reached].filter((builder) => !shared.reaches.has(builder))).toEqual([]);
    });
  }
});
