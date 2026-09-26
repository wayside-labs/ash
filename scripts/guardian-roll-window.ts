/**
 * Port of `roll_window` in `crates/agent-rails-policy/src/engine.rs`.
 * Shared by `alert-watch.ts` and guardian-watch (P1-01).
 */

const I64_MAX = (1n << 63n) - 1n;
const I64_MIN = -(1n << 63n);

function i64CheckedAdd(a: bigint, b: bigint): bigint | null {
  const sum = a + b;
  if (sum > I64_MAX || sum < I64_MIN) return null;
  return sum;
}

function i64CheckedSub(a: bigint, b: bigint): bigint | null {
  const diff = a - b;
  if (diff > I64_MAX || diff < I64_MIN) return null;
  return diff;
}

export function rollWindow(
  start: bigint,
  spent: bigint,
  windowSeconds: number,
  now: bigint,
): [bigint, bigint] {
  const window = BigInt(windowSeconds);
  if (window <= 0n) {
    return [start, spent];
  }
  const end = i64CheckedAdd(start, window);
  if (end === null) {
    return [start, spent];
  }
  if (now < end) {
    return [start, spent];
  }
  const elapsed = i64CheckedSub(now, start);
  if (elapsed === null) {
    return [start, spent];
  }
  const offset = elapsed % window;
  const newStart = i64CheckedSub(now, offset);
  if (newStart === null) {
    return [start, spent];
  }
  return [newStart, 0n];
}
