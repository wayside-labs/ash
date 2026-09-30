import type { Intent } from "@sodax/sdk";

/** MCP payloads are JSON: bigints become decimal strings, byte arrays become 0x-hex. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (inner !== undefined) out[key] = toJsonSafe(inner);
    }
    return out;
  }
  return value;
}

const INTENT_BIGINT_FIELDS = [
  "intentId",
  "inputAmount",
  "minOutputAmount",
  "deadline",
  "srcChain",
  "dstChain",
  "feeAmount",
] as const;

/**
 * Restores an `Intent` that went out through `toJsonSafe`. The intent must round-trip exactly:
 * its hash is its on-chain id, so submit-tx and cancel fail on any altered field.
 */
export function parseIntent(raw: Record<string, unknown>): Intent {
  const intent: Record<string, unknown> = { ...raw };
  for (const field of INTENT_BIGINT_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
      throw new Error(`intent.${field} must be a decimal string`);
    }
    intent[field] = BigInt(value);
  }
  return intent as unknown as Intent;
}

export function parseAmount(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be a base-unit integer string`);
  return BigInt(value);
}
