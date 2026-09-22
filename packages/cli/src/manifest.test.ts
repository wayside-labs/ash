import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clusterSlug,
  type Manifest,
  manifestPath,
  readManifest,
  writeManifest,
} from "./manifest.js";

describe("clusterSlug", () => {
  it.each([
    ["https://api.devnet.solana.com", "devnet"],
    ["https://api.mainnet-beta.solana.com", "mainnet"],
    ["https://api.testnet.solana.com", "testnet"],
    ["http://127.0.0.1:8899", "localnet"],
    ["http://localhost:8899", "localnet"],
    ["https://rpc.example.com", "custom"],
    ["not a url", "custom"],
  ])("maps %s to %s", (url, slug) => {
    expect(clusterSlug(url)).toBe(slug);
  });

  /**
   * The separation that matters: a localnet bootstrap must not overwrite the record of a
   * devnet treasury. They are different chains, and one manifest would make
   * `init --rpc localhost` silently strand whatever a rate-limited faucet paid for.
   */
  it("gives devnet and localnet different files", () => {
    expect(manifestPath("/out", "https://api.devnet.solana.com")).not.toBe(
      manifestPath("/out", "http://127.0.0.1:8899"),
    );
  });

  it("names the file after the cluster, under the out dir", () => {
    expect(manifestPath(".agent-rails", "http://127.0.0.1:8899")).toBe(
      ".agent-rails/localnet.json",
    );
  });
});

describe("readManifest", () => {
  it("returns undefined rather than throwing when absent", async () => {
    await expect(readManifest("/nonexistent/path.json")).resolves.toBeUndefined();
  });

  it("round-trips a manifest and never writes key material", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-rails-cli-"));
    const path = join(dir, "devnet.json");
    const manifest: Manifest = {
      version: 1,
      rpcUrl: "https://api.devnet.solana.com",
      programId: "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS",
      treasury: "T",
      solVault: "V",
      policy: "P",
      policyName: "default",
      session: "S",
      sessionKey: "K",
      sessionKeypairPath: "/keys/session-keypair.json",
      sessionExpiresAt: "2026-01-01T00:00:00.000Z",
      feePayer: "F",
      feePayerKeypairPath: "/keys/fee-payer-keypair.json",
      destination: "D",
      destinationLabel: "demo",
      owner: "O",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await writeManifest(path, manifest);
    expect(await readManifest(path)).toEqual(manifest);

    // Paths only. A secret key in here would be committed the first time someone shares a
    // reproduction, and `.gitignore` only guards files matching *keypair*.json.
    const raw = await readFile(path, "utf8");
    expect(raw).not.toMatch(/"(secret|privateKey|keypair)":/);
  });

  it("ignores a manifest written by a future version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-rails-cli-"));
    const path = join(dir, "devnet.json");
    await writeManifest(path, { version: 2 } as unknown as Manifest);
    await expect(readManifest(path)).resolves.toBeUndefined();
  });
});
