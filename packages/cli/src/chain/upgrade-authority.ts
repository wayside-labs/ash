import {
  type Address,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import type { Rpc } from "../rpc.js";

/**
 * Who can replace the program under every treasury that trusts it.
 *
 * ADR-011 makes the upgrade authority the headline trust claim — `0.x` a single key,
 * `1.0.0-beta` a Squads 3-of-5, `1.0.0` renounced — and says `doctor` reports it. It did
 * not, which made the one claim a user is told to verify on-chain the one thing the tooling
 * never looked at.
 *
 * Read from the loader's `ProgramData` account rather than from any of our own state: the
 * whole point is that it cannot be asserted by us.
 */

const UPGRADEABLE_LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");

export type UpgradeAuthority =
  | { kind: "key"; authority: Address }
  /** Renounced. `1.0.0` in ADR-011's phases: nobody can upgrade it, including us. */
  | { kind: "none" }
  /** Not deployed with the upgradeable loader at all, so there is nothing to upgrade. */
  | { kind: "not-upgradeable" };

/**
 * `UpgradeableLoaderState::ProgramData` is a 4-byte little-endian enum tag (3), an 8-byte
 * deploy slot, then `Option<Pubkey>` as a 1-byte tag plus the key — 45 bytes before the ELF
 * starts. Only that header is fetched: the payload is ~700 KB and irrelevant here.
 */
const HEADER_LEN = 45;

export async function readUpgradeAuthority(
  rpc: Rpc,
  programAddress: Address,
): Promise<UpgradeAuthority> {
  const program = await rpc
    .getAccountInfo(programAddress, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (program.value == null || program.value.owner !== UPGRADEABLE_LOADER) {
    return { kind: "not-upgradeable" };
  }

  const [programData] = await getProgramDerivedAddress({
    programAddress: UPGRADEABLE_LOADER,
    seeds: [getAddressEncoder().encode(programAddress)],
  });

  const account = await rpc
    .getAccountInfo(programData, {
      commitment: "confirmed",
      encoding: "base64",
      dataSlice: { offset: 0, length: HEADER_LEN },
    })
    .send();
  if (account.value == null) return { kind: "not-upgradeable" };

  const raw = Array.isArray(account.value.data) ? account.value.data[0] : account.value.data;
  return decodeUpgradeAuthority(new Uint8Array(getBase64Encoder().encode(raw as string)));
}

/**
 * Split out from the read so the byte offsets are testable without a validator. They are
 * the part that silently rots: a header that shifts by one turns "renounced" into a key, or
 * the other way round, and both readings look plausible in a terminal.
 */
export function decodeUpgradeAuthority(bytes: Uint8Array): UpgradeAuthority {
  if (bytes.length < HEADER_LEN) return { kind: "not-upgradeable" };
  // A ProgramData account is tag 3. Anything else at this address is not one.
  const tag = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  if (tag !== 3) return { kind: "not-upgradeable" };
  if (bytes[12] === 0) return { kind: "none" };
  return { kind: "key", authority: getAddressDecoder().decode(bytes.subarray(13, HEADER_LEN)) };
}

export { UPGRADEABLE_LOADER };
