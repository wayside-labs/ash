import { MAX_NAME_LEN } from "@agent-rails/contract";
import { SolanaRequestError } from "@/lib/server/solana";

/** Encode a session label as the program's fixed 32-byte, NUL-padded field. */
export function encodeFixedName(value: string): Uint8Array {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new SolanaRequestError("api.error.labelRequired");
  }
  if (trimmed.includes("\0")) {
    throw new SolanaRequestError("api.error.labelInvalid");
  }

  const encoder = new TextEncoder();
  const full = encoder.encode(trimmed);
  if (full.length > MAX_NAME_LEN) {
    throw new SolanaRequestError("api.error.labelTooLong");
  }

  const buffer = new Uint8Array(MAX_NAME_LEN);
  buffer.set(full);
  return buffer;
}
