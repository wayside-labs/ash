import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  fetchMaybeTreasury,
  findPolicyPda,
  findSolVaultPda,
} from "@agent-rails/client";
import { type Address, address, type KeyPairSigner } from "@solana/kit";
import type { GlobalCliOptions } from "./cli-options.js";
import { CliError } from "./errors.js";
import { type Manifest, manifestPath, readManifest } from "./manifest.js";
import { encodeFixedName } from "./names.js";
import { assertProgramDeployed, connect, type Rpc } from "./rpc.js";
import { expandPath, loadWallet } from "./wallet.js";

export type ResolvedContext = {
  rpcUrl: string;
  rpc: Rpc;
  wallet: KeyPairSigner;
  outDir: string;
  manifestFile: string;
  manifest?: Manifest;
  treasury: Address;
  solVault: Address;
  policy: Address;
  policyName: string;
};

export async function loadContext(
  options: GlobalCliOptions,
  requireManifest = true,
): Promise<ResolvedContext> {
  const outDir = expandPath(options.out);
  const rpcUrl = options.rpc;
  const rpc = connect(rpcUrl);
  await assertProgramDeployed(rpc, AGENT_RAILS_PROGRAM_ADDRESS, rpcUrl);
  const wallet = await loadWallet(options.wallet);

  const manifestFile = manifestPath(outDir, rpcUrl);
  const manifest = await readManifest(manifestFile);
  if (requireManifest && !manifest && !options.treasury) {
    throw new CliError("No treasury found for this cluster", {
      hint:
        `Run \`agent-rails init --rpc ${rpcUrl}\` first, or pass --treasury <address>. ` +
        `Manifest path: ${manifestFile}`,
    });
  }

  const treasury = resolveTreasury(options, manifest, rpcUrl);

  const treasuryAccount = await fetchMaybeTreasury(rpc, treasury, { commitment: "confirmed" });
  if (!treasuryAccount.exists) {
    throw new CliError(`No treasury account at ${treasury}`, {
      hint: "Check --treasury or re-run init.",
    });
  }

  const policyName = resolvePolicyName(options, manifest);
  const policy = await resolvePolicy(options, manifest, rpcUrl, treasury, policyName);

  const [solVault] = await findSolVaultPda({ treasury });

  return {
    rpcUrl,
    rpc,
    wallet,
    outDir,
    manifestFile,
    ...(manifest ? { manifest } : {}),
    treasury,
    solVault,
    policy,
    policyName,
  };
}

/** Whether `manifest` describes the cluster `rpcUrl` points at. */
function manifestMatches(manifest: Manifest | undefined, rpcUrl: string): manifest is Manifest {
  return manifest !== undefined && manifest.rpcUrl === rpcUrl;
}

/**
 * Precedence: an explicit `--treasury`, then a manifest written for *this* RPC. A manifest
 * from another cluster is ignored rather than fallen back on — its addresses name accounts
 * that do not exist here, so trusting it would send a devnet command at a localnet PDA and
 * fail with "no treasury account" instead of the actionable error below.
 */
export function resolveTreasury(
  options: Pick<GlobalCliOptions, "treasury">,
  manifest: Manifest | undefined,
  rpcUrl: string,
): Address {
  if (options.treasury) return address(options.treasury);
  if (manifestMatches(manifest, rpcUrl)) return address(manifest.treasury);
  throw new CliError("Treasury address is required", {
    hint: "Pass --treasury or run init for this cluster.",
  });
}

/**
 * The name is needed even when the manifest is absent or foreign, because it is what the
 * policy PDA is derived from below.
 */
export function resolvePolicyName(
  options: Pick<GlobalCliOptions, "policyName">,
  manifest: Manifest | undefined,
): string {
  return options.policyName ?? manifest?.policyName ?? "default";
}

/**
 * Same precedence as the treasury, with one addition: the PDA is derivable, so a missing or
 * foreign manifest is recoverable here rather than fatal.
 */
export async function resolvePolicy(
  options: Pick<GlobalCliOptions, "policy">,
  manifest: Manifest | undefined,
  rpcUrl: string,
  treasury: Address,
  policyName: string,
): Promise<Address> {
  if (options.policy) return address(options.policy);
  if (manifestMatches(manifest, rpcUrl)) return address(manifest.policy);
  const [policy] = await findPolicyPda({
    treasury,
    name: encodeFixedName(policyName, "--policy-name"),
  });
  return policy;
}
