import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchMaybeAgentSession, findSessionPda } from "@agent-rails/client";
import { MAX_SESSION_TTL_SECONDS, MIN_WINDOW_SECONDS } from "@agent-rails/contract";
import type { Address, KeyPairSigner } from "@solana/kit";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { type Manifest, writeManifest } from "../manifest.js";
import { renderMcpConfig } from "../mcp-config.js";
import { resolveMcpEntry } from "../mcp-entry.js";
import { decodeFixedName } from "../names.js";
import { parseAddress } from "../parse.js";
import { requireOperatorOrOwner } from "../roles.js";
import { sendPlan } from "../tx/send.js";
import {
  buildCloseSessionInstruction,
  buildCreateSessionInstruction,
  buildRevokeSessionInstruction,
} from "../tx/session.js";
import type { Ui } from "../ui.js";
import { createAndSaveKeypair, loadIfPresent } from "../wallet.js";

export type SessionCreateOptions = GlobalCliOptions & {
  label: string;
  sessionTtlHours: number;
};

function resolveExpiry(hours: number): bigint {
  const seconds = hours * 3_600;
  if (seconds > MAX_SESSION_TTL_SECONDS) {
    throw new CliError(`--session-ttl exceeds maximum ${MAX_SESSION_TTL_SECONDS / 3_600}h`);
  }
  if (seconds < MIN_WINDOW_SECONDS) {
    throw new CliError(`--session-ttl must be at least ${MIN_WINDOW_SECONDS} seconds`);
  }
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

function assertSessionKeySafe(
  sessionKey: Address,
  treasury: { owner: Address; operator: Address; guardians: Address[]; guardianCount: number },
): void {
  if (sessionKey === treasury.owner || sessionKey === treasury.operator) {
    throw new CliError("Session key must not be the owner or operator");
  }
  for (const g of treasury.guardians.slice(0, treasury.guardianCount)) {
    if (sessionKey === g) throw new CliError("Session key must not be a guardian");
  }
}

export async function runSessionCreate(options: SessionCreateOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "create sessions");

  const keyPath = join(ctx.outDir, `${options.label}-session-keypair.json`);
  const sessionKey: KeyPairSigner =
    (await loadIfPresent(keyPath)) ?? (await createAndSaveKeypair(keyPath));
  assertSessionKeySafe(sessionKey.address, snapshot.treasuryAccount);

  const expiresAt = resolveExpiry(options.sessionTtlHours);
  const [session] = await findSessionPda({
    treasury: ctx.treasury,
    sessionKey: sessionKey.address,
  });

  const existing = await fetchMaybeAgentSession(ctx.rpc, session, { commitment: "confirmed" });
  if (existing.exists && !existing.data.revoked) {
    ui.info("Session already exists on-chain — updating manifest and MCP snippet");
  } else {
    const instruction = await buildCreateSessionInstruction({
      operator: ctx.wallet,
      treasury: ctx.treasury,
      policy: ctx.policy,
      session,
      sessionKey: sessionKey.address,
      label: options.label,
      expiresAt,
    });
    const result = await sendPlan({
      rpc: ctx.rpc,
      feePayer: ctx.wallet,
      plan: { label: "Create session", instructions: [instruction] },
      ui,
      yes: options.yes,
      json: options.json,
      dryRun: options.dryRun,
    });
    if (!result.sent && !options.dryRun) return 130;
  }

  const { AGENT_RAILS_PROGRAM_ADDRESS } = await import("@agent-rails/client");
  const base = ctx.manifest ?? {
    version: 1 as const,
    rpcUrl: ctx.rpcUrl,
    programId: AGENT_RAILS_PROGRAM_ADDRESS,
    treasury: ctx.treasury,
    solVault: snapshot.solVault,
    policy: ctx.policy,
    policyName: ctx.policyName,
    feePayer: ctx.wallet.address,
    feePayerKeypairPath: join(ctx.outDir, "fee-payer-keypair.json"),
    destination: snapshot.destinations[0]?.owner ?? "",
    destinationLabel: snapshot.destinations[0]?.label ?? "demo",
    owner: snapshot.treasuryAccount.owner,
    createdAt: new Date().toISOString(),
  };
  const manifest: Manifest = {
    ...base,
    session,
    sessionKey: sessionKey.address,
    sessionKeypairPath: keyPath,
    sessionExpiresAt: new Date(Number(expiresAt) * 1000).toISOString(),
  };

  await writeManifest(ctx.manifestFile, manifest);

  const serverEntry = resolveMcpEntry(options.mcpEntry, ui);
  const configJson = renderMcpConfig({
    serverEntry,
    rpcUrl: ctx.rpcUrl,
    session,
    signerKeypairPath: keyPath,
    feePayerKeypairPath: manifest.feePayerKeypairPath,
    sinkPath: join(ctx.outDir, "payments.jsonl"),
    ...(manifest.tokenMint && manifest.tokenSymbol
      ? { mintAliases: { [manifest.tokenSymbol]: manifest.tokenMint } }
      : {}),
  });
  const snippetPath = join(ctx.outDir, "claude_desktop_config.snippet.json");
  await writeFile(snippetPath, configJson, "utf8");

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ session, sessionKey: sessionKey.address, mcpConfigPath: snippetPath }, null, 2)}\n`,
    );
    return 0;
  }

  ui.succeed("Session ready", session);
  ui.field("MCP snippet", snippetPath);
  return 0;
}

export async function runSessionLs(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(snapshot.sessions, null, 2)}\n`);
    return 0;
  }
  ui.heading("Sessions");
  for (const s of snapshot.sessions) {
    const state = s.revoked ? "revoked" : s.live ? "live" : "expired";
    ui.field(s.label, `${s.address} (${state})`);
  }
  return 0;
}

export type SessionShowOptions = GlobalCliOptions & { session?: string };

export async function runSessionShow(options: SessionShowOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const sessionAddr = options.session
    ? parseAddress(options.session, "--session")
    : ctx.manifest
      ? parseAddress(ctx.manifest.session, "manifest session")
      : undefined;
  if (!sessionAddr) throw new CliError("Pass --session or run from an initialized manifest");

  const account = await fetchMaybeAgentSession(ctx.rpc, sessionAddr, { commitment: "confirmed" });
  if (!account.exists) throw new CliError(`No session at ${sessionAddr}`);

  const view = {
    address: sessionAddr,
    label: decodeFixedName(account.data.label),
    sessionKey: account.data.sessionKey,
    policy: account.data.policy,
    expiresAt: Number(account.data.expiresAt),
    revoked: account.data.revoked,
    seq: account.data.seq.toString(),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    return 0;
  }
  ui.heading("Session");
  for (const [k, v] of Object.entries(view)) ui.field(k, String(v));
  return 0;
}

export type SessionRevokeOptions = GlobalCliOptions & { session: string };

export async function runSessionRevoke(options: SessionRevokeOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "revoke sessions");

  const session = parseAddress(options.session, "--session");
  const account = await fetchMaybeAgentSession(ctx.rpc, session, { commitment: "confirmed" });
  if (!account.exists) throw new CliError(`No session at ${session}`);

  const instruction = await buildRevokeSessionInstruction({
    authority: ctx.wallet,
    treasury: ctx.treasury,
    policy: account.data.policy,
    session,
  });

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Revoke session", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ revoked: session, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export type SessionCloseOptions = GlobalCliOptions & { session: string };

export async function runSessionClose(options: SessionCloseOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "close sessions");

  const session = parseAddress(options.session, "--session");
  const account = await fetchMaybeAgentSession(ctx.rpc, session, { commitment: "confirmed" });
  if (!account.exists) throw new CliError(`No session at ${session}`);

  const now = Math.floor(Date.now() / 1000);
  const closable = account.data.revoked || Number(account.data.expiresAt) <= now;
  if (!closable) {
    throw new CliError("Session must be revoked or expired before close", {
      hint: "agent-rails session revoke --session <pda>",
    });
  }

  const instruction = await buildCloseSessionInstruction({
    operator: ctx.wallet,
    treasury: ctx.treasury,
    policy: account.data.policy,
    session,
    rentDestination: ctx.wallet.address,
  });

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Close session", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ closed: session, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}
