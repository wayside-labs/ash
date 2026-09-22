import type { Treasury } from "@agent-rails/client";
import type { Address } from "@solana/kit";
import { CliError } from "./errors.js";

export type WalletRole = "owner" | "operator" | "guardian";

export function walletRoles(wallet: Address, treasury: Treasury): WalletRole[] {
  const roles: WalletRole[] = [];
  if (wallet === treasury.owner) roles.push("owner");
  if (wallet === treasury.operator) roles.push("operator");
  for (const guardian of treasury.guardians.slice(0, treasury.guardianCount)) {
    if (wallet === guardian) roles.push("guardian");
  }
  return roles;
}

export function hasRole(wallet: Address, treasury: Treasury, role: WalletRole): boolean {
  return walletRoles(wallet, treasury).includes(role);
}

export function requireOwner(wallet: Address, treasury: Treasury, action: string): void {
  if (!hasRole(wallet, treasury, "owner")) {
    throw new CliError(`Only the treasury owner may ${action}`, {
      hint: `Owner is ${treasury.owner}. Your wallet is ${wallet}.`,
    });
  }
}

export function requireOperatorOrOwner(wallet: Address, treasury: Treasury, action: string): void {
  const roles = walletRoles(wallet, treasury);
  if (!roles.includes("owner") && !roles.includes("operator")) {
    throw new CliError(`Only the owner or operator may ${action}`, {
      hint: `Operator is ${treasury.operator}. Your wallet is ${wallet}.`,
    });
  }
}

export function requirePauseAuthority(wallet: Address, treasury: Treasury): void {
  const roles = walletRoles(wallet, treasury);
  if (!roles.includes("owner") && !roles.includes("guardian")) {
    throw new CliError("Only the owner or a guardian may pause the treasury", {
      hint: `Owner is ${treasury.owner}. Your wallet is ${wallet}.`,
    });
  }
}
