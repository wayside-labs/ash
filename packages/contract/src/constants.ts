/** Sentinel mint for native SOL (spec §1). */
export const NATIVE_MINT = "So11111111111111111111111111111111111111112" as const;

export const PROGRAM_VERSION = 1;

export const MAX_GUARDIANS = 5;
export const MAX_MINTS = 4;
export const MAX_MEMO_LEN = 64;
export const MAX_NAME_LEN = 32;
export const INTENT_ID_LEN = 16;

export const MAX_INTENT_TTL_SECONDS = 3_600;
export const MIN_INTENT_TTL_SECONDS = 5;
export const RECEIPT_GRACE_SECONDS = 3_600;
export const MIN_WINDOW_SECONDS = 60;
export const MAX_SESSION_TTL_SECONDS = 31_536_000;

/** PDA seed literals (spec §2). */
export const SEED_TREASURY = "treasury";
export const SEED_SOL_VAULT = "sol_vault";
export const SEED_POLICY = "policy";
export const SEED_ALLOWLIST = "allow";
export const SEED_SESSION = "session";
export const SEED_RECEIPT = "receipt";

export const MINT_FLAG_IS_NATIVE = 1 << 0;
export const MINT_FLAG_HAS_TRANSFER_FEE = 1 << 1;
export const MINT_FLAG_HAS_PERMANENT_DELEGATE = 1 << 2;

export const AUTH_MODE_DIRECT_SIGNER = 0;
export const AUTH_MODE_SIGNED_INTENT = 1;

export const RECEIPT_STATUS_EXECUTED = 1;
