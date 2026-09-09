import type {
  AgentSession,
  IntentReceipt,
  MintLimit,
  Policy,
  SpendCounter,
} from "@agent-rails/client";
import type { ReadonlyUint8Array } from "@solana/kit";

export function bytesToHex(bytes: ReadonlyUint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodePaddedUtf8(bytes: ReadonlyUint8Array): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  return new TextDecoder().decode(slice);
}

function bigintField(value: bigint): string {
  return value.toString();
}

export function serializeSpendCounter(counter: SpendCounter) {
  return {
    mint: counter.mint,
    short_window_start: bigintField(counter.shortWindowStart),
    short_spent: bigintField(counter.shortSpent),
    long_window_start: bigintField(counter.longWindowStart),
    long_spent: bigintField(counter.longSpent),
    lifetime_spent: bigintField(counter.lifetimeSpent),
    last_payment_at: bigintField(counter.lastPaymentAt),
  };
}

export function serializeMintLimit(limit: MintLimit) {
  return {
    mint: limit.mint,
    per_tx_max: bigintField(limit.perTxMax),
    short_window_max: bigintField(limit.shortWindowMax),
    short_window_seconds: limit.shortWindowSeconds,
    long_window_max: bigintField(limit.longWindowMax),
    long_window_seconds: limit.longWindowSeconds,
    lifetime_max: bigintField(limit.lifetimeMax),
    approval_threshold: bigintField(limit.approvalThreshold),
    cooldown_seconds: limit.cooldownSeconds,
  };
}

const DESTINATION_MODE_LABELS: Record<number, string> = {
  0: "any",
  1: "allowlist",
};

export function destinationModeLabel(mode: number): string {
  return DESTINATION_MODE_LABELS[mode] ?? `unknown(${mode})`;
}

export function serializeAgentSession(address: string, session: AgentSession) {
  return {
    found: true,
    address,
    version: session.version,
    treasury: session.treasury,
    policy: session.policy,
    session_key: session.sessionKey,
    auth_mode: session.authMode,
    label: decodePaddedUtf8(session.label),
    created_at: bigintField(session.createdAt),
    expires_at: bigintField(session.expiresAt),
    revoked: session.revoked,
    revoked_at: bigintField(session.revokedAt),
    seq: bigintField(session.seq),
    audit_head: bytesToHex(session.auditHead),
    spend: session.spend.map(serializeSpendCounter),
  };
}

export function serializePolicy(address: string, policy: Policy) {
  const activeMintLimits = policy.mintLimits.slice(0, policy.mintCount);
  return {
    found: true,
    address,
    version: policy.version,
    treasury: policy.treasury,
    name: decodePaddedUtf8(policy.name),
    mint_limits: activeMintLimits.map(serializeMintLimit),
    mint_count: policy.mintCount,
    destination_mode: policy.destinationMode,
    destination_mode_label: destinationModeLabel(policy.destinationMode),
    require_memo: policy.requireMemo,
    create_destination_ata: policy.createDestinationAta,
    active_sessions: policy.activeSessions,
    created_at: bigintField(policy.createdAt),
    updated_at: bigintField(policy.updatedAt),
  };
}

export function serializeIntentReceipt(receipt: IntentReceipt) {
  return {
    version: receipt.version,
    session: receipt.session,
    intent_id: bytesToHex(receipt.intentId),
    mint: receipt.mint,
    destination_owner: receipt.destinationOwner,
    amount: bigintField(receipt.amount),
    seq: bigintField(receipt.seq),
    slot: bigintField(receipt.slot),
    timestamp: bigintField(receipt.timestamp),
    expires_at: bigintField(receipt.expiresAt),
    status: receipt.status,
    fee_payer: receipt.feePayer,
    memo_hash: bytesToHex(receipt.memoHash),
  };
}
