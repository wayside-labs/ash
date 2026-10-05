/**
 * The commitment half of the proof of existence for the Privacy Sprint text (commit, then reveal).
 *
 * A SHA-256 of the canonical text is written on mainnet, in a transaction of its own that carries
 * one SPL Memo instruction, before the text is submitted. The submission is the reveal, and
 * `examples/templates/cloak-private-payout/verify-hash.ts` is how a judge checks the two against
 * each other with nothing installed. That script is self-contained on purpose (it imports only
 * Node's own modules), so the constants below are repeated there; `commitment.test.ts` fails if
 * they drift apart, and if the hash here stops matching the text it stands for.
 *
 * Browser-safe: no Node import, because the runner that sends the memo runs in the browser.
 */

/**
 * The SPL Memo program, v2. Checked on mainnet: it exists, it is executable, loader v2 owns it.
 * Not a value to retype from memory: a string one character off still looks like an address, and
 * `commitment.test.ts` pins this one.
 */
export const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/**
 * What the memo starts with; the SHA-256 in lowercase hex follows. The prefix is part of the
 * commitment already on mainnet (the Privacy Sprint's first run wrote `agent-rails/...`), so it
 * must not follow a rename: a verifier reads the memo as it was written.
 */
export const COMMITMENT_MEMO_PREFIX = "agent-rails/privacy-text/v1 sha256=";

/**
 * SHA-256 of the canonical text of `examples/templates/cloak-private-payout/PRIVACY.md` (Portuguese,
 * the text that is submitted). After any edit to that text, recompute it with
 * `pnpm verify-hash`, paste the new value here, and commit it on-chain again: a hash written
 * before the edit no longer vouches for the text.
 */
export const PRIVACY_TEXT_SHA256 =
  "331f0b7a354c8f18dfbbc71d25d5d3f99d23c74797fde752446a23e0c0313148";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The memo for a hash: what the commitment transaction carries. */
export function commitmentMemo(sha256Hex: string): string {
  if (!SHA256_HEX.test(sha256Hex)) throw new Error("not a SHA-256 in lowercase hex");
  return `${COMMITMENT_MEMO_PREFIX}${sha256Hex}`;
}

/** The hash a memo commits to, or `null` when the memo is anything else. */
export function parseCommitmentMemo(memo: string): string | null {
  if (!memo.startsWith(COMMITMENT_MEMO_PREFIX)) return null;
  const hash = memo.slice(COMMITMENT_MEMO_PREFIX.length);
  return SHA256_HEX.test(hash) ? hash : null;
}

/** The memo the runner writes after the deposit. */
export const COMMITMENT_MEMO = commitmentMemo(PRIVACY_TEXT_SHA256);
