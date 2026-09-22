/** How much must move for `held` to reach `target`. Never negative. */
export function shortfall(target: bigint, held: bigint): bigint {
  return held >= target ? 0n : target - held;
}

export function fundingLine(
  target: bigint,
  held: bigint,
  moving: bigint,
  format: (value: bigint) => string,
): string {
  if (moving === 0n) return `${format(held)} (already at or above ${format(target)})`;
  return `${format(held)} -> ${format(target)} (sending ${format(moving)})`;
}
