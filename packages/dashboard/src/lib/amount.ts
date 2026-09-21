/** Parse a human decimal string into base units for the given mint decimals. */
export function parseAmountToBaseUnits(raw: string, decimals: number): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length > 2) return null;
  const whole = parts[0] ?? "";
  const frac = parts[1] ?? "";
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null;
  if (frac.length > decimals) return null;
  const paddedFrac = frac.padEnd(decimals, "0");
  const combined = `${whole || "0"}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(combined)) return null;
  try {
    return BigInt(combined);
  } catch {
    return null;
  }
}

export function localDateTimeToUnixSeconds(value: string): bigint | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return BigInt(Math.floor(ms / 1000));
}
