import {
  ASH_ERROR__ALREADY_REVOKED,
  ASH_ERROR__AMOUNT_ZERO,
  ASH_ERROR__DESTINATION_ATA_CREATION_DISABLED,
  ASH_ERROR__DESTINATION_NOT_ALLOWED,
  ASH_ERROR__DUPLICATE_GUARDIAN,
  ASH_ERROR__DUPLICATE_MINT,
  ASH_ERROR__EXCEEDS_LIFETIME,
  ASH_ERROR__EXCEEDS_LONG_WINDOW,
  ASH_ERROR__EXCEEDS_PER_TX_MAX,
  ASH_ERROR__EXCEEDS_SHORT_WINDOW,
  ASH_ERROR__GUARDIAN_NOT_FOUND,
  ASH_ERROR__GUARDIANS_FULL,
  ASH_ERROR__INSUFFICIENT_VAULT_BALANCE,
  ASH_ERROR__INTENT_EXPIRED,
  ASH_ERROR__INTENT_TTL_TOO_LONG,
  ASH_ERROR__INVALID_AUTH_MODE,
  ASH_ERROR__INVALID_EXPIRY,
  ASH_ERROR__INVALID_LIMIT,
  ASH_ERROR__INVALID_NAME,
  ASH_ERROR__INVALID_WINDOW,
  ASH_ERROR__MATH_OVERFLOW,
  ASH_ERROR__MEMO_REQUIRED,
  ASH_ERROR__MEMO_TOO_LONG,
  ASH_ERROR__MINT_NOT_CONFIGURED,
  ASH_ERROR__MINT_NOT_IN_POLICY,
  ASH_ERROR__MINT_NOT_IN_SESSION,
  ASH_ERROR__MINT_SLOTS_FULL,
  ASH_ERROR__PAUSED,
  ASH_ERROR__POLICY_EXCEEDS_CEILING,
  ASH_ERROR__POLICY_IN_USE,
  ASH_ERROR__PRIVILEGED_KEY_AS_SESSION,
  ASH_ERROR__RECEIPT_NOT_EXPIRED,
  ASH_ERROR__RESERVED_FIELD_NON_ZERO,
  ASH_ERROR__SELF_PAYMENT_FORBIDDEN,
  ASH_ERROR__SESSION_EXPIRED,
  ASH_ERROR__SESSION_REVOKED,
  ASH_ERROR__SESSION_STILL_ACTIVE,
  ASH_ERROR__TOKEN_PROGRAM_MISMATCH,
  ASH_ERROR__TREASURY_NOT_EMPTY,
  ASH_ERROR__UNAUTHORIZED,
  ASH_ERROR__UNSUPPORTED_MINT_EXTENSION,
  ASH_ERROR__WRONG_PAYMENT_PATH,
  getAshErrorMessage,
} from "@ash/client";
import { type AnyReasonCode, reasonCodeFromAnchor, SDK_REASON_CODES } from "@ash/contract";
import { isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM } from "@solana/kit";
import { AshError } from "./errors.js";

const PROGRAM_ERROR_TO_REASON = new Map<number, AnyReasonCode>([
  [ASH_ERROR__PAUSED, "TREASURY_PAUSED"],
  [ASH_ERROR__UNAUTHORIZED, "UNAUTHORIZED"],
  [ASH_ERROR__SESSION_REVOKED, "SESSION_REVOKED"],
  [ASH_ERROR__SESSION_EXPIRED, "SESSION_EXPIRED"],
  [ASH_ERROR__INVALID_AUTH_MODE, "INVALID_AUTH_MODE"],
  [ASH_ERROR__INTENT_EXPIRED, "INTENT_EXPIRED"],
  [ASH_ERROR__INTENT_TTL_TOO_LONG, "INTENT_TTL_TOO_LONG"],
  [ASH_ERROR__AMOUNT_ZERO, "AMOUNT_ZERO"],
  [ASH_ERROR__MEMO_TOO_LONG, "MEMO_TOO_LONG"],
  [ASH_ERROR__MEMO_REQUIRED, "MEMO_REQUIRED"],
  [ASH_ERROR__MINT_NOT_CONFIGURED, "MINT_NOT_CONFIGURED"],
  [ASH_ERROR__MINT_NOT_IN_POLICY, "MINT_NOT_IN_POLICY"],
  [ASH_ERROR__MINT_NOT_IN_SESSION, "MINT_NOT_IN_SESSION"],
  [ASH_ERROR__TOKEN_PROGRAM_MISMATCH, "TOKEN_PROGRAM_MISMATCH"],
  [ASH_ERROR__WRONG_PAYMENT_PATH, "WRONG_PAYMENT_PATH"],
  [ASH_ERROR__DESTINATION_NOT_ALLOWED, "DESTINATION_NOT_ALLOWED"],
  [ASH_ERROR__DESTINATION_ATA_CREATION_DISABLED, "DESTINATION_ATA_MISSING"],
  [ASH_ERROR__SELF_PAYMENT_FORBIDDEN, "SELF_PAYMENT_FORBIDDEN"],
  [ASH_ERROR__EXCEEDS_PER_TX_MAX, "EXCEEDS_PER_TX_MAX"],
  [ASH_ERROR__EXCEEDS_SHORT_WINDOW, "EXCEEDS_SHORT_WINDOW"],
  [ASH_ERROR__EXCEEDS_LONG_WINDOW, "EXCEEDS_LONG_WINDOW"],
  [ASH_ERROR__EXCEEDS_LIFETIME, "EXCEEDS_LIFETIME"],
  [ASH_ERROR__INSUFFICIENT_VAULT_BALANCE, "INSUFFICIENT_VAULT_BALANCE"],
  [ASH_ERROR__POLICY_EXCEEDS_CEILING, "POLICY_EXCEEDS_CEILING"],
  [ASH_ERROR__INVALID_WINDOW, "INVALID_WINDOW"],
  [ASH_ERROR__INVALID_LIMIT, "INVALID_LIMIT"],
  [ASH_ERROR__INVALID_NAME, "INVALID_NAME"],
  [ASH_ERROR__MINT_SLOTS_FULL, "MINT_SLOTS_FULL"],
  [ASH_ERROR__DUPLICATE_MINT, "DUPLICATE_MINT"],
  [ASH_ERROR__UNSUPPORTED_MINT_EXTENSION, "UNSUPPORTED_MINT_EXTENSION"],
  [ASH_ERROR__GUARDIANS_FULL, "GUARDIANS_FULL"],
  [ASH_ERROR__GUARDIAN_NOT_FOUND, "GUARDIAN_NOT_FOUND"],
  [ASH_ERROR__DUPLICATE_GUARDIAN, "DUPLICATE_GUARDIAN"],
  [ASH_ERROR__PRIVILEGED_KEY_AS_SESSION, "PRIVILEGED_KEY_AS_SESSION"],
  [ASH_ERROR__INVALID_EXPIRY, "INVALID_EXPIRY"],
  [ASH_ERROR__POLICY_IN_USE, "POLICY_IN_USE"],
  [ASH_ERROR__SESSION_STILL_ACTIVE, "SESSION_STILL_ACTIVE"],
  [ASH_ERROR__TREASURY_NOT_EMPTY, "TREASURY_NOT_EMPTY"],
  [ASH_ERROR__RECEIPT_NOT_EXPIRED, "RECEIPT_NOT_EXPIRED"],
  [ASH_ERROR__ALREADY_REVOKED, "ALREADY_REVOKED"],
  [ASH_ERROR__MATH_OVERFLOW, "MATH_OVERFLOW"],
  [ASH_ERROR__RESERVED_FIELD_NON_ZERO, "RESERVED_FIELD_NON_ZERO"],
]);

/**
 * A program error means the transaction executed and reverted: nothing moved, nothing was
 * written, and the answer will not change for these parameters. That is a denial, and it is
 * the only class of failure a caller may safely respond to by changing something and trying
 * again.
 */
export function ashErrorFromCode(code: number, cause?: unknown): AshError {
  const reasonCode = reasonCodeFromProgramError(code);
  const message = getAshErrorMessage(code as never) ?? reasonCode;
  return new AshError({
    reasonCode,
    message,
    outcome: "denied",
    source: "program",
    cause,
  });
}

/**
 * Unknown codes map to `UNKNOWN_PROGRAM_ERROR`, never to `DUPLICATE_INTENT`.
 *
 * The old fallback was harmless while reason codes were only labels. It is not harmless now
 * that `DUPLICATE_INTENT` means "a receipt exists, the payment settled": an error this
 * client happens not to recognize — a newer program version, a code added after this client
 * shipped — would be reported as a completed payment.
 */
export function reasonCodeFromProgramError(code: number): AnyReasonCode {
  return (
    PROGRAM_ERROR_TO_REASON.get(code) ??
    reasonCodeFromAnchor(code) ??
    SDK_REASON_CODES.UNKNOWN_PROGRAM_ERROR
  );
}

/** Anchor error codes are `u32`; anything outside that range is not one. */
const MAX_PROGRAM_ERROR_CODE = 4_294_967_295n;

/**
 * Normalise an error code that may arrive as either a `number` or a `bigint`.
 *
 * Kit upcasts every integer in an RPC response to `bigint` unless the field is on its
 * numeric allowlist, and `InstructionError` is not on it — a real denial arrives as
 * `{ InstructionError: [0n, { Custom: 101n }] }`. A `typeof === "number"` guard therefore
 * rejects every genuine program error, and the caller falls through to
 * `UNKNOWN_PROGRAM_ERROR`. Accepting both is not defensive coding; one of the two is what
 * the network actually sends.
 */
function toProgramErrorCode(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "bigint") {
    return value >= 0n && value <= MAX_PROGRAM_ERROR_CODE ? Number(value) : undefined;
  }
  return undefined;
}

/**
 * Read an Anchor custom error code out of a raw RPC transaction error.
 *
 * Handles the `err` payload of both `simulateTransaction` and `getSignatureStatuses`,
 * which share the shape `{ InstructionError: [index, { Custom: code }] }`. Returns
 * `undefined` for anything else so the caller can report the raw failure rather than
 * inventing a reason code for it.
 */
export function customCodeFromTransactionError(err: unknown): number | undefined {
  if (!err || typeof err !== "object" || !("InstructionError" in err)) {
    return undefined;
  }
  const instructionError = (err as { InstructionError: unknown }).InstructionError;
  if (!Array.isArray(instructionError) || instructionError.length < 2) {
    return undefined;
  }
  const detail: unknown = instructionError[1];
  if (!detail || typeof detail !== "object" || !("Custom" in detail)) {
    return undefined;
  }
  return toProgramErrorCode((detail as { Custom: unknown }).Custom);
}

/**
 * `JSON.stringify` for an RPC error payload, which always contains bigints.
 *
 * Plain `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` on
 * every one of these objects. Thrown while building an error message, that replaces the
 * actual denial with a serialisation complaint — the failure is reported, but as the wrong
 * failure, which is worse than not reporting it.
 */
export function stringifyRpcError(err: unknown): string {
  try {
    return (
      JSON.stringify(err, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ) ?? String(err)
    );
  } catch {
    return String(err);
  }
}

function extractCustomProgramErrorCode(error: unknown): number | undefined {
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
    // Kit builds this context itself and types `code` as a number, but it is normalised
    // through the same helper so a reason code can never be lost to a type mismatch.
    return toProgramErrorCode(error.context.code);
  }
  return undefined;
}

/** Map Anchor custom errors (and Kit RPC failures) to `AshError`. */
export function toAshError(error: unknown): AshError {
  if (error instanceof AshError) {
    return error;
  }

  const programCode = extractCustomProgramErrorCode(error);
  if (programCode !== undefined) {
    return ashErrorFromCode(programCode, error);
  }

  // Not a program decision, so it carries no information about whether funds moved. This
  // path is only reached from simulation and from build-time failures, neither of which has
  // broadcast anything; a caller that has already sent must classify the failure itself.
  if (error instanceof Error) {
    return new AshError({
      reasonCode: "UNKNOWN_PROGRAM_ERROR",
      message: error.message,
      outcome: "denied",
      source: "simulation",
      cause: error,
    });
  }

  return new AshError({
    reasonCode: "UNKNOWN_PROGRAM_ERROR",
    message: "Payment simulation failed",
    outcome: "denied",
    source: "simulation",
    cause: error,
  });
}
