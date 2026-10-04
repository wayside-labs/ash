/**
 * One private payout at a time per wallet in this browser, across cards and across tabs. The
 * deposit and every payout are separate transactions on one set of keys: two runs interleaving
 * would each spend the notes the other is counting on, and each would shield its own deposit.
 *
 * `navigator.locks` is shared by every tab of the origin and is released if a tab dies, which a
 * flag in memory is not. Where it is missing (an old browser, an insecure origin) the set below
 * still covers the cards of one tab.
 */

const held = new Set<string>();

export type LockResult<T> = { held: true; value: T } | { held: false };

export async function withWalletRunLock<T>(
  wallet: string,
  work: () => Promise<T>,
): Promise<LockResult<T>> {
  const name = `agent-rails.cloak.run:${wallet}`;
  if (held.has(name)) return { held: false };
  held.add(name);
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) return { held: true, value: await work() };
    return await locks.request(
      name,
      { ifAvailable: true },
      async (lock): Promise<LockResult<T>> => {
        if (!lock) return { held: false };
        return { held: true, value: await work() };
      },
    );
  } finally {
    held.delete(name);
  }
}
