import { MAX_NAME_LEN } from "@agent-rails/contract";
import { CliError } from "./errors.js";

/**
 * Encode a policy name or session label as the program's fixed 32-byte, NUL-padded field.
 *
 * The truncation is by code point, not by byte. `validate_padded_name` requires the
 * non-NUL prefix to be valid UTF-8, so slicing a multi-byte character in half produces an
 * `InvalidName` from the chain rather than a shortened label — a failure that would look
 * like a program bug and only ever reproduce for people whose names are not ASCII.
 */
export function encodeFixedName(value: string, flag: string): Uint8Array {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CliError(`${flag} must not be empty`);
  }
  if (trimmed.includes("\0")) {
    throw new CliError(`${flag} must not contain a NUL byte`);
  }

  const encoder = new TextEncoder();
  const full = encoder.encode(trimmed);
  if (full.length > MAX_NAME_LEN) {
    throw new CliError(
      `${flag} is ${full.length} bytes encoded; the program's limit is ${MAX_NAME_LEN}`,
      { hint: `Shorten "${trimmed}" — multi-byte characters count for more than one byte.` },
    );
  }

  const buffer = new Uint8Array(MAX_NAME_LEN);
  buffer.set(full);
  return buffer;
}

/** The inverse, for printing a name read back off the chain. */
export function decodeFixedName(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(bytes.subarray(0, end === -1 ? bytes.length : end));
}
