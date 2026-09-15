/** Stable reason codes surfaced by the SDK, MCP tools, and adapters (spec §9). */
export const REASON_CODES = {
  6000: "TREASURY_PAUSED",
  6001: "UNAUTHORIZED",
  6002: "SESSION_REVOKED",
  6003: "SESSION_EXPIRED",
  6004: "INVALID_AUTH_MODE",
  6005: "INTENT_EXPIRED",
  6006: "INTENT_TTL_TOO_LONG",
  6007: "AMOUNT_ZERO",
  6008: "MEMO_TOO_LONG",
  6009: "MEMO_REQUIRED",
  6010: "MINT_NOT_CONFIGURED",
  6011: "MINT_NOT_IN_POLICY",
  6012: "MINT_NOT_IN_SESSION",
  6013: "TOKEN_PROGRAM_MISMATCH",
  6014: "WRONG_PAYMENT_PATH",
  6015: "DESTINATION_NOT_ALLOWED",
  6016: "DESTINATION_ATA_MISSING",
  6017: "SELF_PAYMENT_FORBIDDEN",
  6018: "EXCEEDS_PER_TX_MAX",
  6019: "EXCEEDS_SHORT_WINDOW",
  6020: "EXCEEDS_LONG_WINDOW",
  6021: "EXCEEDS_LIFETIME",
  6022: "INSUFFICIENT_VAULT_BALANCE",
  6023: "POLICY_EXCEEDS_CEILING",
  6024: "INVALID_WINDOW",
  6025: "INVALID_LIMIT",
  6026: "INVALID_NAME",
  6027: "MINT_SLOTS_FULL",
  6028: "DUPLICATE_MINT",
  6029: "UNSUPPORTED_MINT_EXTENSION",
  6030: "GUARDIANS_FULL",
  6031: "GUARDIAN_NOT_FOUND",
  6032: "DUPLICATE_GUARDIAN",
  6033: "PRIVILEGED_KEY_AS_SESSION",
  6034: "INVALID_EXPIRY",
  6035: "POLICY_IN_USE",
  6036: "SESSION_STILL_ACTIVE",
  6037: "TREASURY_NOT_EMPTY",
  6038: "RECEIPT_NOT_EXPIRED",
  6039: "ALREADY_REVOKED",
  6040: "MATH_OVERFLOW",
  6041: "RESERVED_FIELD_NON_ZERO",
} as const satisfies Record<number, string>;

export type AnchorErrorCode = keyof typeof REASON_CODES;
export type ReasonCode = (typeof REASON_CODES)[AnchorErrorCode];

/**
 * Codes the off-chain layers raise themselves. They are not Anchor custom errors, so they
 * never collide with the 6000 range above, and the MCP surface treats both alike: one
 * stable string per reason, whatever decided it.
 */
export const SDK_REASON_CODES = {
  /** A receipt already exists for this intent. The payment settled, possibly earlier. */
  DUPLICATE_INTENT: "DUPLICATE_INTENT",
  /** Broadcast, unconfirmed, and resolution did not complete. Never a denial. */
  UNRESOLVED_OUTCOME: "UNRESOLVED_OUTCOME",
  /** Chain state could not be read, so liveness could not be established. */
  STATE_UNAVAILABLE: "STATE_UNAVAILABLE",
  /** Tool arguments failed the schema, including unknown keys. */
  INVALID_REQUEST: "INVALID_REQUEST",
  /** No `AllowlistEntry` carries this label under the bound policy. */
  UNKNOWN_DESTINATION: "UNKNOWN_DESTINATION",
  /** Two allowlist entries normalize to the same label: possible impersonation. */
  AMBIGUOUS_DESTINATION: "AMBIGUOUS_DESTINATION",
  /** A raw address was supplied where only a registered label is accepted. */
  LITERAL_NOT_PERMITTED: "LITERAL_NOT_PERMITTED",
  /** The mint symbol or address is not configured on the treasury. */
  UNKNOWN_MINT: "UNKNOWN_MINT",
  /** More decimal places than the mint can represent. Never rounded. */
  PRECISION_EXCEEDS_MINT: "PRECISION_EXCEEDS_MINT",
  /** Malformed decimal amount. */
  MALFORMED_AMOUNT: "MALFORMED_AMOUNT",
  /** A payment is already in flight for this session. */
  SESSION_BUSY: "SESSION_BUSY",
  /** Call rate exceeded the local governor budget. */
  RATE_LIMITED: "RATE_LIMITED",
  /** An unresolved payment is outstanding; the session pays nothing until it is settled. */
  SESSION_QUIESCED: "SESSION_QUIESCED",
  /** A soft policy hook refused the payment. */
  HOOK_DENIED: "HOOK_DENIED",
  /** A soft policy hook timed out or threw. Denies by default (ADR-005 section 6). */
  HOOK_UNAVAILABLE: "HOOK_UNAVAILABLE",
  /**
   * A program error this client does not recognize. These previously fell through to
   * `DUPLICATE_INTENT`, which now means "already settled" - the most dangerous possible
   * default for an error nobody understands.
   */
  UNKNOWN_PROGRAM_ERROR: "UNKNOWN_PROGRAM_ERROR",
} as const;

export type SdkReasonCode = (typeof SDK_REASON_CODES)[keyof typeof SDK_REASON_CODES];

export const ALL_REASON_CODES = [
  ...Object.values(REASON_CODES),
  ...Object.values(SDK_REASON_CODES),
] as const;

export type AnyReasonCode = ReasonCode | SdkReasonCode;

export function reasonCodeFromAnchor(code: number): ReasonCode | undefined {
  return REASON_CODES[code as AnchorErrorCode];
}
