/**
 * Fixtures for unit tests. Excluded from coverage in `vitest.config.ts` — it is test
 * scaffolding, and counting it would inflate the denominator with code no gate protects.
 *
 * These build in-memory `Treasury`/`MintConfig` values rather than decoding real account
 * bytes: the decoders are the generated client's responsibility, and `layout.rs` is what
 * pins the byte layout. What these serve is the CLI's own decision logic.
 */
import type { MintCeiling, MintConfig, Treasury } from "@ash/client";
import { FundingMode } from "@ash/client";
import { type Address, address } from "@solana/kit";

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export function makeCeiling(overrides: Partial<MintCeiling> = {}): MintCeiling {
  return {
    maxPerTx: 100n,
    maxShortWindow: 1_000n,
    maxLongWindow: 1_000n,
    maxLifetime: 10_000n,
    minShortWindowSeconds: 3_600,
    minLongWindowSeconds: 86_400,
    ...overrides,
  };
}

export function makeMintConfig(mint: Address, overrides: Partial<MintConfig> = {}): MintConfig {
  return {
    mint,
    tokenProgram: TOKEN_PROGRAM,
    decimals: 6,
    flags: 0,
    fundingMode: FundingMode.IsolatedVault,
    pad: new Uint8Array(3),
    ceiling: makeCeiling(),
    ...overrides,
  };
}

export function makeTreasury(overrides: Partial<Treasury> = {}): Treasury {
  const guardians = [
    SYSTEM_PROGRAM,
    SYSTEM_PROGRAM,
    SYSTEM_PROGRAM,
    SYSTEM_PROGRAM,
    SYSTEM_PROGRAM,
  ];
  return {
    discriminator: new Uint8Array(8),
    version: 1,
    bump: 255,
    solVaultBump: 254,
    createKey: SYSTEM_PROGRAM,
    owner: SYSTEM_PROGRAM,
    operator: SYSTEM_PROGRAM,
    guardians,
    guardianCount: 0,
    paused: false,
    pausedAt: 0n,
    pausedBy: SYSTEM_PROGRAM,
    allowAnyDestination: false,
    allowCreateDestinationAta: false,
    timelockSeconds: 0n,
    recoveryDestination: SYSTEM_PROGRAM,
    mints: [],
    mintCount: 0,
    activeSessions: 0,
    policyCount: 0,
    createdAt: 0n,
    reserved: new Uint8Array(64),
    ...overrides,
  };
}
