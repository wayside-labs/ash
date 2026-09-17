import { readFileSync } from "node:fs";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

/**
 * Install a compiled program at its declared address, by writing the loader's accounts
 * directly through Surfpool's `surfnet_setAccount` cheatcode.
 *
 * `solana program deploy` cannot do this job. It deploys at whatever address the keypair
 * file names, and `target/deploy/agent_rails-keypair.json` is gitignored — correctly, since
 * `.gitignore` refuses to carry raw secret keys and ADR-011 governs the program id. On a
 * developer's machine that file happens to hold the key for `declare_id!`; on a fresh
 * checkout `cargo build-sbf` mints a new one, the deploy lands at a random address, and
 * every instruction then fails its own declared-id check. That is exactly what CI did, at a
 * program id nobody recognised, while the deploy command exited 0.
 *
 * Writing the accounts sidesteps the key entirely: a surfnet owns its ledger, so the
 * program can simply be placed where the program says it lives. No keypair enters the
 * repository and no deploy command runs.
 */
export async function installProgram(
  rpcUrl: string,
  programId: string,
  soPath: string,
): Promise<void> {
  const elf = readFileSync(soPath);
  const addr = getAddressEncoder();

  const [programData] = await getProgramDerivedAddress({
    programAddress: address(LOADER),
    seeds: [addr.encode(address(programId))],
  });

  // UpgradeableLoaderState::ProgramData — a 4-byte enum tag (3), the deploy slot, then an
  // Option<Pubkey> authority written as its `Some` tag plus the key. 45 bytes, then the ELF.
  const header = Buffer.alloc(45);
  header.writeUInt32LE(3, 0);
  header.writeBigUInt64LE(0n, 4);
  header.writeUInt8(1, 12);
  Buffer.from(addr.encode(address(programId))).copy(header, 13);
  const programDataAccount = Buffer.concat([header, elf]);

  // UpgradeableLoaderState::Program — enum tag (2) and the programdata address.
  const programAccount = Buffer.alloc(36);
  programAccount.writeUInt32LE(2, 0);
  Buffer.from(addr.encode(programData)).copy(programAccount, 4);

  await setAccount(rpcUrl, programData, {
    lamports: 10_000_000_000,
    // Hex, not base64: `surfnet_setAccount` decodes a string `data` field as hex.
    data: programDataAccount.toString("hex"),
    owner: LOADER,
    executable: false,
    rentEpoch: 0,
  });

  await setAccount(rpcUrl, programId, {
    lamports: 10_000_000_000,
    data: programAccount.toString("hex"),
    owner: LOADER,
    executable: true,
    rentEpoch: 0,
  });
}

async function setAccount(rpcUrl: string, pubkey: string, update: unknown): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setAccount",
      params: [pubkey, update],
    }),
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (body.error) {
    throw new Error(`surfnet_setAccount(${pubkey}) failed: ${body.error.message}`);
  }
}
