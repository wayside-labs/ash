import { toBaseUnits } from "@ash/contract";
import { CliError } from "./errors.js";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const SOL_DECIMALS = 9;

/**
 * Parse a CLI-supplied amount in human units into base units of a mint with `decimals`.
 *
 * `toBaseUnits` from the contract package does the conversion rather than `Number(x) * 10**d`,
 * which is the whole reason it exists: floating point turns `0.1` into 100000000.00000001
 * and a policy limit is not a place to discover that. The contract package is also what the
 * SDK and MCP server parse amounts with, so a limit written here and an amount paid there
 * round identically.
 *
 * The decimals are the mint's, never assumed: a limit parsed at SOL's 9 on a 6-decimal mint
 * is a thousand times what the operator typed.
 */
export function parseHumanAmount(value: string, decimals: number, flag: string, unit = ""): bigint {
  const of = unit ? ` of ${unit}` : "";
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new CliError(`${flag} must be a positive decimal number${of}, got "${value}"`);
  }
  let base: bigint;
  try {
    base = toBaseUnits(trimmed, decimals);
  } catch (error) {
    throw new CliError(`${flag} is not a valid amount${of}: ${value}`, { cause: error });
  }
  if (base <= 0n) {
    throw new CliError(`${flag} must be greater than zero, got "${value}"`);
  }
  return base;
}

/** Parse a CLI-supplied SOL amount into lamports. */
export function parseSol(value: string, flag: string): bigint {
  return parseHumanAmount(value, SOL_DECIMALS, flag, "SOL");
}

export function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${flag} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function parseNonNegativeInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`${flag} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

/** Lamports as SOL, trimmed of trailing zeros — for display only, never for arithmetic. */
export function formatSol(base: bigint): string {
  const whole = base / LAMPORTS_PER_SOL;
  const fraction = base % LAMPORTS_PER_SOL;
  if (fraction === 0n) return `${whole} SOL`;
  const padded = fraction.toString().padStart(SOL_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${padded} SOL`;
}
