/**
 * Ceilings for the two costs a caller can impose on this process: requests per
 * window, and concurrent work in flight (#19).
 *
 * Both buckets are **global to the process, with no per-caller key**. With the
 * dev server bound to a loopback address every request arrives from
 * `127.0.0.1`, so keying by IP would be one bucket wearing a disguise — and the
 * disguise is worse than the limit, because it reads as isolation between
 * callers that does not exist. On a serverless deployment the same is true for a
 * different reason: each instance has its own memory, so this is a per-instance
 * ceiling and not a global one.
 */

const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 60;

type Window = { startedAt: number; count: number };

const windows = new Map<string, Window>();
const inFlight = new Map<string, number>();

/** Test seam: these are module-level counters by design, so tests must reset them. */
export function resetLimits(): void {
  windows.clear();
  inFlight.clear();
}

function tooMany(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "too many requests" },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

/**
 * Fixed window, not a rolling one: same reason the on-chain policy uses fixed
 * epoch buckets (ARCHITECTURE.md §6) — a ring buffer costs more than the limit
 * is worth here.
 */
export function checkFixedWindow(
  key: string,
  limit = WINDOW_LIMIT,
  windowMs = WINDOW_MS,
): Response | null {
  const now = Date.now();
  const current = windows.get(key);
  if (current === undefined || now - current.startedAt >= windowMs) {
    windows.set(key, { startedAt: now, count: 1 });
    return null;
  }
  if (current.count >= limit) {
    return tooMany(Math.ceil((current.startedAt + windowMs - now) / 1000));
  }
  current.count += 1;
  return null;
}

/**
 * Returns a release function, or a 429 when the ceiling is already taken.
 *
 * This is the half that matters for `/api/chat`: the route declares
 * `maxDuration = 120`, so a window limit alone still permits N simultaneous
 * two-minute LLM calls. The caller must release in a `finally`.
 */
export function acquireSlot(key: string, limit = 1): { release: () => void } | Response {
  const held = inFlight.get(key) ?? 0;
  if (held >= limit) {
    return tooMany(5);
  }
  inFlight.set(key, held + 1);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      inFlight.set(key, Math.max(0, (inFlight.get(key) ?? 1) - 1));
    },
  };
}
