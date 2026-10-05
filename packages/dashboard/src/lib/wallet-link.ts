/**
 * The statement a wallet signs to be linked to an account (ADR-024).
 *
 * Stateless on purpose: there is no nonce table. The message names the account it links to,
 * so a signature captured from one user cannot link their wallet to anyone else's account,
 * and replaying your own signature links the same wallet to the same account again, which is
 * a no-op. The timestamp bounds how long a signature lying around in a log stays usable.
 *
 * One line, for the same reason as the sign-in statement in `use-auth.ts`: some wallets
 * refuse to display a multi-line message.
 */
const PREFIX = "Link this wallet to ASH account ";
const ISSUED = ". Issued ";
const SUFFIX = ". This moves no funds.";

export const LINK_MESSAGE_MAX_AGE_MS = 5 * 60_000;

export function linkMessage(accountId: string, issuedAt: Date): string {
  return `${PREFIX}${accountId}${ISSUED}${issuedAt.toISOString()}${SUFFIX}`;
}

export function parseLinkMessage(message: string): { accountId: string; issuedAt: Date } | null {
  if (!message.startsWith(PREFIX) || !message.endsWith(SUFFIX)) return null;
  const body = message.slice(PREFIX.length, -SUFFIX.length);
  const split = body.indexOf(ISSUED);
  if (split === -1) return null;
  const accountId = body.slice(0, split);
  const issuedAt = new Date(body.slice(split + ISSUED.length));
  if (!accountId || Number.isNaN(issuedAt.getTime())) return null;
  // Round-trip, so a message with extra text wedged in cannot parse as a valid one.
  if (linkMessage(accountId, issuedAt) !== message) return null;
  return { accountId, issuedAt };
}
