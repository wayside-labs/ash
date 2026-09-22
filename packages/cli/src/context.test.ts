import { findPolicyPda } from "@agent-rails/client";
import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { resolvePolicy, resolvePolicyName, resolveTreasury } from "./context.js";
import { CliError } from "./errors.js";
import type { Manifest } from "./manifest.js";
import { encodeFixedName } from "./names.js";

const LOCALNET = "http://127.0.0.1:8899";
const DEVNET = "https://api.devnet.solana.com";

const TREASURY = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const MANIFEST_TREASURY = address("So11111111111111111111111111111111111111112");
const MANIFEST_POLICY = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const FLAG_POLICY = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    rpcUrl: LOCALNET,
    programId: "11111111111111111111111111111111",
    treasury: MANIFEST_TREASURY,
    solVault: "11111111111111111111111111111111",
    policy: MANIFEST_POLICY,
    policyName: "from-manifest",
    session: "11111111111111111111111111111111",
    sessionKey: "11111111111111111111111111111111",
    sessionKeypairPath: "/dev/null",
    sessionExpiresAt: "1970-01-01T00:00:00.000Z",
    feePayer: "11111111111111111111111111111111",
    feePayerKeypairPath: "/dev/null",
    destination: "11111111111111111111111111111111",
    destinationLabel: "demo",
    owner: "11111111111111111111111111111111",
    createdAt: "1970-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveTreasury", () => {
  it("prefers --treasury over the manifest", () => {
    expect(resolveTreasury({ treasury: TREASURY }, manifest(), LOCALNET)).toBe(TREASURY);
  });

  it("falls back to a manifest written for this RPC", () => {
    expect(resolveTreasury({}, manifest(), LOCALNET)).toBe(MANIFEST_TREASURY);
  });

  /**
   * The separation `manifest.test.ts` protects on disk has to hold in memory too: a devnet
   * command must not adopt a localnet treasury just because that file was read first.
   */
  it("refuses a manifest from another cluster", () => {
    expect(() => resolveTreasury({}, manifest(), DEVNET)).toThrow(/Treasury address is required/);
  });

  it("still honours --treasury against a foreign manifest", () => {
    expect(resolveTreasury({ treasury: TREASURY }, manifest(), DEVNET)).toBe(TREASURY);
  });

  // The hint is a separate field, not part of the message: `cli.ts` prints the two apart.
  it("refuses when there is no manifest and no flag, and says what to do", () => {
    expect(() => resolveTreasury({}, undefined, LOCALNET)).toThrow(CliError);
    try {
      resolveTreasury({}, undefined, LOCALNET);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).hint).toMatch(/Pass --treasury or run init/);
    }
  });
});

describe("resolvePolicyName", () => {
  it("prefers the flag, then the manifest, then the default", () => {
    expect(resolvePolicyName({ policyName: "flag" }, manifest())).toBe("flag");
    expect(resolvePolicyName({}, manifest())).toBe("from-manifest");
    expect(resolvePolicyName({}, undefined)).toBe("default");
  });

  // A foreign manifest is ignored for addresses but not for the name: the name only seeds a
  // PDA derivation, and the operator's naming convention does not change with the cluster.
  it("keeps the name from a manifest written elsewhere", () => {
    expect(resolvePolicyName({}, manifest({ rpcUrl: DEVNET }))).toBe("from-manifest");
  });
});

describe("resolvePolicy", () => {
  it("prefers --policy over the manifest", async () => {
    await expect(
      resolvePolicy({ policy: FLAG_POLICY }, manifest(), LOCALNET, TREASURY, "default"),
    ).resolves.toBe(FLAG_POLICY);
  });

  it("falls back to a manifest written for this RPC", async () => {
    await expect(resolvePolicy({}, manifest(), LOCALNET, TREASURY, "default")).resolves.toBe(
      MANIFEST_POLICY,
    );
  });

  // Unlike the treasury, this one is recoverable: the PDA is derivable from the name.
  it("derives the PDA when the manifest is foreign", async () => {
    const [expected] = await findPolicyPda({
      treasury: TREASURY,
      name: encodeFixedName("from-manifest", "--policy-name"),
    });
    await expect(resolvePolicy({}, manifest(), DEVNET, TREASURY, "from-manifest")).resolves.toBe(
      expected,
    );
  });

  it("derives the PDA when there is no manifest at all", async () => {
    const [expected] = await findPolicyPda({
      treasury: TREASURY,
      name: encodeFixedName("default", "--policy-name"),
    });
    await expect(resolvePolicy({}, undefined, LOCALNET, TREASURY, "default")).resolves.toBe(
      expected,
    );
  });

  it("derives a different PDA for a different policy name", async () => {
    const [a, b] = await Promise.all([
      resolvePolicy({}, undefined, LOCALNET, TREASURY, "default"),
      resolvePolicy({}, undefined, LOCALNET, TREASURY, "payroll"),
    ]);
    expect(a).not.toBe(b);
  });
});
