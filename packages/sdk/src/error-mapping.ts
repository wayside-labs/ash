import {
  AGENT_RAILS_ERROR__ALREADY_REVOKED,
  AGENT_RAILS_ERROR__AMOUNT_ZERO,
  AGENT_RAILS_ERROR__DESTINATION_ATA_CREATION_DISABLED,
  AGENT_RAILS_ERROR__DESTINATION_NOT_ALLOWED,
  AGENT_RAILS_ERROR__DUPLICATE_GUARDIAN,
  AGENT_RAILS_ERROR__DUPLICATE_MINT,
  AGENT_RAILS_ERROR__EXCEEDS_LIFETIME,
  AGENT_RAILS_ERROR__EXCEEDS_LONG_WINDOW,
  AGENT_RAILS_ERROR__EXCEEDS_PER_TX_MAX,
  AGENT_RAILS_ERROR__EXCEEDS_SHORT_WINDOW,
  AGENT_RAILS_ERROR__GUARDIAN_NOT_FOUND,
  AGENT_RAILS_ERROR__GUARDIANS_FULL,
  AGENT_RAILS_ERROR__INSUFFICIENT_VAULT_BALANCE,
  AGENT_RAILS_ERROR__INTENT_EXPIRED,
  AGENT_RAILS_ERROR__INTENT_TTL_TOO_LONG,
  AGENT_RAILS_ERROR__INVALID_AUTH_MODE,
  AGENT_RAILS_ERROR__INVALID_EXPIRY,
  AGENT_RAILS_ERROR__INVALID_LIMIT,
  AGENT_RAILS_ERROR__INVALID_NAME,
  AGENT_RAILS_ERROR__INVALID_WINDOW,
  AGENT_RAILS_ERROR__MATH_OVERFLOW,
  AGENT_RAILS_ERROR__MEMO_REQUIRED,
  AGENT_RAILS_ERROR__MEMO_TOO_LONG,
  AGENT_RAILS_ERROR__MINT_NOT_CONFIGURED,
  AGENT_RAILS_ERROR__MINT_NOT_IN_POLICY,
  AGENT_RAILS_ERROR__MINT_NOT_IN_SESSION,
  AGENT_RAILS_ERROR__MINT_SLOTS_FULL,
  AGENT_RAILS_ERROR__PAUSED,
  AGENT_RAILS_ERROR__POLICY_EXCEEDS_CEILING,
  AGENT_RAILS_ERROR__POLICY_IN_USE,
  AGENT_RAILS_ERROR__PRIVILEGED_KEY_AS_SESSION,
  AGENT_RAILS_ERROR__RECEIPT_NOT_EXPIRED,
  AGENT_RAILS_ERROR__RESERVED_FIELD_NON_ZERO,
  AGENT_RAILS_ERROR__SELF_PAYMENT_FORBIDDEN,
  AGENT_RAILS_ERROR__SESSION_EXPIRED,
  AGENT_RAILS_ERROR__SESSION_REVOKED,
  AGENT_RAILS_ERROR__SESSION_STILL_ACTIVE,
  AGENT_RAILS_ERROR__TOKEN_PROGRAM_MISMATCH,
  AGENT_RAILS_ERROR__TREASURY_NOT_EMPTY,
  AGENT_RAILS_ERROR__UNAUTHORIZED,
  AGENT_RAILS_ERROR__UNSUPPORTED_MINT_EXTENSION,
  AGENT_RAILS_ERROR__WRONG_PAYMENT_PATH,
  getAgentRailsErrorMessage,
} from "@agent-rails/client";
import { type AnyReasonCode, reasonCodeFromAnchor, SDK_REASON_CODES } from "@agent-rails/contract";
import { isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM } from "@solana/kit";
import { AgentRailsError } from "./errors.js";

const PROGRAM_ERROR_TO_REASON = new Map<number, AnyReasonCode>([
  [AGENT_RAILS_ERROR__PAUSED, "TREASURY_PAUSED"],
  [AGENT_RAILS_ERROR__UNAUTHORIZED, "UNAUTHORIZED"],
  [AGENT_RAILS_ERROR__SESSION_REVOKED, "SESSION_REVOKED"],
  [AGENT_RAILS_ERROR__SESSION_EXPIRED, "SESSION_EXPIRED"],
  [AGENT_RAILS_ERROR__INVALID_AUTH_MODE, "INVALID_AUTH_MODE"],
  [AGENT_RAILS_ERROR__INTENT_EXPIRED, "INTENT_EXPIRED"],
  [AGENT_RAILS_ERROR__INTENT_TTL_TOO_LONG, "INTENT_TTL_TOO_LONG"],
  [AGENT_RAILS_ERROR__AMOUNT_ZERO, "AMOUNT_ZERO"],
  [AGENT_RAILS_ERROR__MEMO_TOO_LONG, "MEMO_TOO_LONG"],
  [AGENT_RAILS_ERROR__MEMO_REQUIRED, "MEMO_REQUIRED"],
  [AGENT_RAILS_ERROR__MINT_NOT_CONFIGURED, "MINT_NOT_CONFIGURED"],
  [AGENT_RAILS_ERROR__MINT_NOT_IN_POLICY, "MINT_NOT_IN_POLICY"],
  [AGENT_RAILS_ERROR__MINT_NOT_IN_SESSION, "MINT_NOT_IN_SESSION"],
  [AGENT_RAILS_ERROR__TOKEN_PROGRAM_MISMATCH, "TOKEN_PROGRAM_MISMATCH"],
  [AGENT_RAILS_ERROR__WRONG_PAYMENT_PATH, "WRONG_PAYMENT_PATH"],
  [AGENT_RAILS_ERROR__DESTINATION_NOT_ALLOWED, "DESTINATION_NOT_ALLOWED"],
  [AGENT_RAILS_ERROR__DESTINATION_ATA_CREATION_DISABLED, "DESTINATION_ATA_MISSING"],
  [AGENT_RAILS_ERROR__SELF_PAYMENT_FORBIDDEN, "SELF_PAYMENT_FORBIDDEN"],
  [AGENT_RAILS_ERROR__EXCEEDS_PER_TX_MAX, "EXCEEDS_PER_TX_MAX"],
  [AGENT_RAILS_ERROR__EXCEEDS_SHORT_WINDOW, "EXCEEDS_SHORT_WINDOW"],
  [AGENT_RAILS_ERROR__EXCEEDS_LONG_WINDOW, "EXCEEDS_LONG_WINDOW"],
  [AGENT_RAILS_ERROR__EXCEEDS_LIFETIME, "EXCEEDS_LIFETIME"],
  [AGENT_RAILS_ERROR__INSUFFICIENT_VAULT_BALANCE, "INSUFFICIENT_VAULT_BALANCE"],
  [AGENT_RAILS_ERROR__POLICY_EXCEEDS_CEILING, "POLICY_EXCEEDS_CEILING"],
  [AGENT_RAILS_ERROR__INVALID_WINDOW, "INVALID_WINDOW"],
  [AGENT_RAILS_ERROR__INVALID_LIMIT, "INVALID_LIMIT"],
  [AGENT_RAILS_ERROR__INVALID_NAME, "INVALID_NAME"],
  [AGENT_RAILS_ERROR__MINT_SLOTS_FULL, "MINT_SLOTS_FULL"],
  [AGENT_RAILS_ERROR__DUPLICATE_MINT, "DUPLICATE_MINT"],
  [AGENT_RAILS_ERROR__UNSUPPORTED_MINT_EXTENSION, "UNSUPPORTED_MINT_EXTENSION"],
  [AGENT_RAILS_ERROR__GUARDIANS_FULL, "GUARDIANS_FULL"],
  [AGENT_RAILS_ERROR__GUARDIAN_NOT_FOUND, "GUARDIAN_NOT_FOUND"],
  [AGENT_RAILS_ERROR__DUPLICATE_GUARDIAN, "DUPLICATE_GUARDIAN"],
  [AGENT_RAILS_ERROR__PRIVILEGED_KEY_AS_SESSION, "PRIVILEGED_KEY_AS_SESSION"],
  [AGENT_RAILS_ERROR__INVALID_EXPIRY, "INVALID_EXPIRY"],
  [AGENT_RAILS_ERROR__POLICY_IN_USE, "POLICY_IN_USE"],
  [AGENT_RAILS_ERROR__SESSION_STILL_ACTIVE, "SESSION_STILL_ACTIVE"],
  [AGENT_RAILS_ERROR__TREASURY_NOT_EMPTY, "TREASURY_NOT_EMPTY"],
  [AGENT_RAILS_ERROR__RECEIPT_NOT_EXPIRED, "RECEIPT_NOT_EXPIRED"],
  [AGENT_RAILS_ERROR__ALREADY_REVOKED, "ALREADY_REVOKED"],
  [AGENT_RAILS_ERROR__MATH_OVERFLOW, "MATH_OVERFLOW"],
  [AGENT_RAILS_ERROR__RESERVED_FIELD_NON_ZERO, "RESERVED_FIELD_NON_ZERO"],
]);

/**
 * A program error means the transaction executed and reverted: nothing moved, nothing was
 * written, and the answer will not change for these parameters. That is a denial, and it is
 * the only class of failure a caller may safely respond to by changing something and trying
 * again.
 */
export function agentRailsErrorFromCode(code: number, cause?: unknown): AgentRailsError {
  const reasonCode = reasonCodeFromProgramError(code);
  const message = getAgentRailsErrorMessage(code as never) ?? reasonCode;
  return new AgentRailsError({
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

function extractCustomProgramErrorCode(error: unknown): number | undefined {
  if (
    isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
    typeof error.context.code === "number"
  ) {
    return error.context.code;
  }
  return undefined;
}

/** Map Anchor custom errors (and Kit RPC failures) to `AgentRailsError`. */
export function toAgentRailsError(error: unknown): AgentRailsError {
  if (error instanceof AgentRailsError) {
    return error;
  }

  const programCode = extractCustomProgramErrorCode(error);
  if (programCode !== undefined) {
    return agentRailsErrorFromCode(programCode, error);
  }

  // Not a program decision, so it carries no information about whether funds moved. This
  // path is only reached from simulation and from build-time failures, neither of which has
  // broadcast anything; a caller that has already sent must classify the failure itself.
  if (error instanceof Error) {
    return new AgentRailsError({
      reasonCode: "UNKNOWN_PROGRAM_ERROR",
      message: error.message,
      outcome: "denied",
      source: "simulation",
      cause: error,
    });
  }

  return new AgentRailsError({
    reasonCode: "UNKNOWN_PROGRAM_ERROR",
    message: "Payment simulation failed",
    outcome: "denied",
    source: "simulation",
    cause: error,
  });
}
