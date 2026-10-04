import { payoutDigest, type RunLog } from "@agent-rails/cloak";
import type { CloakPayoutProposal } from "@agent-rails/contract/template-run";

/**
 * What the browser remembers about a private payout: signatures and a key fingerprint. Both are
 * public, which is the point. The notes, the viewing key and the wallet signature the keys come
 * from are never stored: they are derived again from the wallet when needed (ADR-027), and
 * ADR-017 says no secret is persisted until the passkey vault exists.
 *
 * Every access is guarded: storage can be absent or throw (private windows, blocked site data),
 * and the run must still work without it, only without resuming.
 */

const PREFIX = "agent-rails.cloak";
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * The same payout for the same wallet is the same key, so a retry finds its own log, however the
 * amounts were spelled and whatever the payees were called. A digest, not the payout itself: the
 * addresses are not something to leave readable in a storage key.
 */
export function runStorageKey(funder: string, proposal: CloakPayoutProposal): string {
  return `${PREFIX}.run:${funder}:${payoutDigest(proposal)}`;
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRunLog(value: unknown): value is RunLog {
  if (!value || typeof value !== "object") return false;
  const { shieldSignature, shieldUncertain, commitSignature, payoutSignatures } = value as Record<
    string,
    unknown
  >;
  if (
    shieldSignature !== undefined &&
    !(typeof shieldSignature === "string" && SIGNATURE.test(shieldSignature))
  ) {
    return false;
  }
  if (shieldUncertain !== undefined && typeof shieldUncertain !== "boolean") return false;
  if (
    commitSignature !== undefined &&
    !(typeof commitSignature === "string" && SIGNATURE.test(commitSignature))
  ) {
    return false;
  }
  if (
    !payoutSignatures ||
    typeof payoutSignatures !== "object" ||
    Array.isArray(payoutSignatures)
  ) {
    return false;
  }
  return Object.entries(payoutSignatures).every(
    ([index, signature]) =>
      /^\d$/.test(index) && typeof signature === "string" && SIGNATURE.test(signature),
  );
}

export function readRunLog(key: string): RunLog | null {
  try {
    const raw = store()?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRunLog(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRunLog(key: string, log: RunLog): void {
  try {
    store()?.setItem(key, JSON.stringify(log));
  } catch {
    // Nothing to do: the run goes on, it just cannot be resumed from here.
  }
}

export function clearRunLog(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Same as above.
  }
}

const fingerprintKey = (address: string) => `${PREFIX}.fingerprint:${address}`;

export function readFingerprint(address: string): string | undefined {
  try {
    const value = store()?.getItem(fingerprintKey(address));
    return value && /^[0-9a-f]{16}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeFingerprint(address: string, fingerprint: string): void {
  try {
    store()?.setItem(fingerprintKey(address), fingerprint);
  } catch {
    // Without it the next run signs twice instead of once; nothing else changes.
  }
}
