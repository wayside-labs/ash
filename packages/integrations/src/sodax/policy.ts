/**
 * Off-chain destination policy (ADR-005's soft-policy tier). The on-chain allowlist governs what
 * reaches the desk wallet but only knows Solana accounts; a SODAX intent can deliver to any of 22
 * networks, so the connector refuses to build a transaction whose recipient the operator has not
 * listed. Fail-closed: an empty allowlist permits only returning funds to the signing address on
 * its own chain.
 */

export type Destination = { chainKey: string; address: string };

export type DestinationAllowlist = readonly Destination[];

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// EVM addresses are case-insensitive (checksum casing); Solana, Stellar, Sui etc. are not.
function normalize(address: string): string {
  return EVM_ADDRESS.test(address) ? address.toLowerCase() : address;
}

function same(a: Destination, b: Destination): boolean {
  return a.chainKey === b.chainKey && normalize(a.address) === normalize(b.address);
}

export function parseAllowlist(raw: string | undefined): DestinationAllowlist {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf(":");
      if (sep <= 0 || sep === entry.length - 1) {
        throw new Error(
          `SODAX_ALLOWED_DESTINATIONS entry "${entry}" must be <chainKey>:<address>, e.g. 0xa4b1.arbitrum:0xabc…`,
        );
      }
      return { chainKey: entry.slice(0, sep), address: entry.slice(sep + 1) };
    });
}

export type DestinationCheck = { ok: true } | { ok: false; reason: string };

export function checkDestination(
  allowlist: DestinationAllowlist,
  source: Destination,
  destination: Destination,
): DestinationCheck {
  if (same(source, destination)) return { ok: true };
  if (allowlist.some((entry) => same(entry, destination))) return { ok: true };
  return {
    ok: false,
    reason:
      `Destination ${destination.chainKey}:${destination.address} is not in SODAX_ALLOWED_DESTINATIONS. ` +
      "Only the operator can add it (it is connector configuration, not an agent input).",
  };
}
