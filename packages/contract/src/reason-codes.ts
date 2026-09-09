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

/** SDK-mapped pseudo-codes not emitted as Anchor custom errors. */
export const SDK_REASON_CODES = {
  DUPLICATE_INTENT: "DUPLICATE_INTENT",
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
