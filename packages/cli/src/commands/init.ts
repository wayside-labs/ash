import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { AGENT_RAILS_PROGRAM_ADDRESS } from "@agent-rails/client";
import {
  fromBaseUnits,
  MAX_SESSION_TTL_SECONDS,
  MIN_WINDOW_SECONDS,
  toBaseUnits,
} from "@agent-rails/contract";
import { findAssociatedTokenAddress, TOKEN_PROGRAM_ADDRESS } from "@agent-rails/sdk";
import { type Address, address, type KeyPairSigner } from "@solana/kit";
import { formatSol, LAMPORTS_PER_SOL, SOL_DECIMALS } from "../amounts.js";
import {
  type BootstrapLimits,
  buildStages,
  findEventAuthority,
  type MintPlan,
  type MockMintPlan,
  NATIVE_MINT_ADDRESS,
  planBootstrap,
  readStepState,
  type StepState,
} from "../bootstrap.js";
import { CliError } from "../errors.js";
import { type Manifest, manifestPath, readManifest, writeManifest } from "../manifest.js";
import { claudeDesktopConfigPath, claudeDesktopSupported, renderMcpConfig } from "../mcp-config.js";
import { encodeFixedName } from "../names.js";
import {
  assertProgramDeployed,
  connect,
  getBalance,
  type Rpc,
  SYSTEM_PROGRAM_ADDRESS,
  sendTransaction,
  tryAirdrop,
} from "../rpc.js";
import { mintRentLamports, readMint, tokenBalance } from "../token.js";
import type { Ui } from "../ui.js";
import { createAndSaveKeypair, expandPath, loadIfPresent, loadWallet } from "../wallet.js";

export type InitOptions = {
  rpc: string;
  wallet: string;
  out: string;
  name: string;
  destination?: string;
  perTx: bigint;
  daily: bigint;
  lifetime?: bigint;
  deposit: bigint;
  feeBudget: bigint;
  sessionTtlHours: number;
  /** An existing SPL / Token-2022 mint to accept alongside SOL. */
  mint?: string;
  /** Create a throwaway SPL mint and fund the vault with it. */
  mockMint: boolean;
  mockMintDecimals: number;
  /** Human-unit token limits, converted with the mint's own decimals. */
  tokenPerTx: string;
  tokenDaily: string;
  tokenLifetime?: string;
  tokenDeposit: string;
  airdrop: boolean;
  yes: boolean;
  json: boolean;
  force: boolean;
  dryRun: boolean;
  mcpEntry?: string;
};

/** Rent for one `IntentReceipt` (243 bytes, `tests/layout.rs`), paid by the fee payer. */
const RECEIPT_RENT_LAMPORTS = 2_408_880n;

/**
 * Rent allowance per account this bootstrap opens, plus its share of fees.
 *
 * Deliberately generous rather than exact: `Policy` is the largest at 546 bytes and the
 * real figure comes from the Rent sysvar, but this number only gates a "do you have enough
 * SOL" check. Over-estimating asks for a slightly larger airdrop; under-estimating lets the
 * run start and fail halfway, which is far worse.
 */
const PDA_RENT_ALLOWANCE_LAMPORTS = 5_000_000n;

/**
 * Bootstrap a working treasury, policy, allowlist, session, and MCP config in one command.
 *
 * The friction this removes is not any single instruction — it is that the five of them
 * only work in one order, with one set of PDAs, under a ceiling the policy has to fit
 * inside, signed by a key the program will reject if it is also the owner. Every one of
 * those is a rule a developer would otherwise learn by reading a spec and then failing a
 * transaction.
 */
export async function runInit(options: InitOptions, ui: Ui): Promise<number> {
  const outDir = expandPath(options.out);
  const rpcUrl = options.rpc;

  ui.heading("Agent Rails - devnet bootstrap");
  ui.blank();

  // ---- Preflight ------------------------------------------------------------------
  // Everything that can fail without spending anything fails here, in order of how likely
  // it is to be wrong on a first run.

  ui.start("Checking the cluster");
  const rpc = connect(rpcUrl);
  await assertProgramDeployed(rpc, AGENT_RAILS_PROGRAM_ADDRESS, rpcUrl);
  ui.succeed("Cluster reachable", `${rpcUrl} - program ${AGENT_RAILS_PROGRAM_ADDRESS}`);

  ui.start(`Loading wallet ${options.wallet}`);
  const wallet = await loadWallet(options.wallet);
  ui.succeed("Wallet loaded", wallet.address);

  const limits = resolveLimits(options);
  const sessionExpiresAt = resolveExpiry(options.sessionTtlHours);

  const policyName = encodeFixedName(options.name, "--name");
  const sessionLabel = encodeFixedName(`${options.name}-agent`, "--name");
  const destinationLabel = encodeFixedName("demo", "destination label");

  // ---- Keys -----------------------------------------------------------------------
  // Three keys with three different jobs. Conflating any two of them is the mistake the
  // program is built to make impossible, so the CLI does not offer the option.

  await mkdir(outDir, { recursive: true });
  const sessionKeypairPath = join(outDir, "session-keypair.json");
  const feePayerKeypairPath = join(outDir, "fee-payer-keypair.json");

  const sessionKey = await reuseOrCreate(sessionKeypairPath, ui, "session key");
  const feePayer = await reuseOrCreate(feePayerKeypairPath, ui, "fee payer");

  if (sessionKey.address === wallet.address || feePayer.address === wallet.address) {
    throw new CliError("The session key must not be the treasury owner", {
      hint:
        "`create_session` rejects a privileged key as a session key: a compromised agent " +
        "must be boxed in, not able to raise its own limits.",
    });
  }

  const destination = await resolveDestination(options, outDir, ui);

  // ---- Resume ---------------------------------------------------------------------

  const manifestFile = manifestPath(outDir, rpcUrl);
  const previous = options.force ? undefined : await readManifest(manifestFile);
  if (previous && previous.rpcUrl !== rpcUrl) {
    ui.warn(`Ignoring a manifest recorded against ${previous.rpcUrl}`);
  }

  const existingTreasury =
    previous && previous.rpcUrl === rpcUrl ? address(previous.treasury) : undefined;

  const plan = await planBootstrap({
    rpc,
    sessionKey: sessionKey.address,
    destination,
    policyName,
    ...(existingTreasury ? { existingTreasury } : {}),
  });

  ui.start("Reading what already exists on-chain");
  const state = await readStepState(rpc, plan);
  ui.succeed("Chain state read", describeState(state));

  // ---- Mints ------------------------------------------------------------------------

  const { mints, mockMint, tokenSummary } = await resolveMints(
    options,
    rpc,
    plan.treasury,
    destination,
    outDir,
    ui,
  );

  const mintCount = mints.length;

  // ---- Funding --------------------------------------------------------------------

  // Funding is expressed as a shortfall against a target, never as an unconditional
  // transfer. `init` is re-run constantly - after a faucet refusal, after a dropped
  // confirmation, after a session expires - and a blind transfer would top the vault up
  // again on every one of those. The invariant this command establishes is "the vault holds
  // --deposit and the fee payer holds --fee-budget", which stays true however often it runs.
  const [vaultBalance, feePayerBalance] = await Promise.all([
    getBalance(rpc, plan.solVault),
    getBalance(rpc, feePayer.address),
  ]);
  const depositShortfall = shortfall(options.deposit, vaultBalance);
  const feeBudgetShortfall = shortfall(options.feeBudget, feePayerBalance);

  // Rent for the PDAs still to be opened, plus signature fees, plus a margin. Computed from
  // what this run will actually do rather than from the targets, so a resume that only needs
  // to mint a session is not blocked on a balance a full bootstrap would have needed.
  const setupCost = BigInt(stagesRemaining(state, mintCount)) * PDA_RENT_ALLOWANCE_LAMPORTS;
  const required = depositShortfall + feeBudgetShortfall + setupCost;
  let balance = await getBalance(rpc, wallet.address);

  if (balance < required && options.airdrop) {
    ui.start(`Requesting an airdrop (balance ${formatSol(balance)})`);
    const wanted = maxBigInt(required - balance, LAMPORTS_PER_SOL * 2n);
    const result = await tryAirdrop(rpcUrl, wallet.address, wanted);
    if (result.ok) {
      balance = await getBalance(rpc, wallet.address);
      ui.succeed("Airdrop confirmed", formatSol(balance));
    } else {
      // Not fatal on its own: the wallet may already hold enough, and devnet refuses far
      // more airdrops than it grants. The balance check below is the one that decides.
      ui.warn(`Airdrop declined: ${result.reason}`);
    }
  }

  if (balance < required) {
    throw new CliError(
      `Wallet holds ${formatSol(balance)}; this run needs about ${formatSol(required)}`,
      {
        hint:
          `Fund ${wallet.address} at https://faucet.solana.com (devnet), then re-run - ` +
          "init resumes from whatever already exists. Or lower --deposit / --fee-budget.",
      },
    );
  }

  // ---- Plan ------------------------------------------------------------------------

  const eventAuthority = await findEventAuthority();
  const stages = buildStages(
    {
      rpc,
      wallet,
      sessionKey,
      feePayer,
      destination,
      policyName,
      sessionLabel,
      destinationLabel,
      mints,
      ...(mockMint ? { mockMint } : {}),
      sessionExpiresAt,
      depositLamports: depositShortfall,
      feeBudgetLamports: feeBudgetShortfall,
      eventAuthority,
      ...(existingTreasury ? { existingTreasury } : {}),
    },
    plan,
    state,
  );

  ui.blank();
  ui.heading("Plan");
  ui.field("Treasury", plan.treasury);
  ui.field("SOL vault", plan.solVault);
  ui.field("Policy", plan.policy);
  ui.field("Session", plan.session);
  ui.field("Session key", sessionKey.address);
  ui.field("Fee payer", feePayer.address);
  ui.field("Destination", destination);
  ui.blank();
  ui.field("SOL per payment", `<= ${formatSol(limits.perTxMax)}`);
  ui.field("SOL per day", `<= ${formatSol(limits.longWindowMax)}`);
  ui.field("SOL lifetime", `<= ${formatSol(limits.lifetimeMax)}`);
  if (tokenSummary) {
    ui.field(`${tokenSummary.symbol} mint`, tokenSummary.mint);
    ui.field(`${tokenSummary.symbol} vault ATA`, tokenSummary.vaultAta);
    ui.field(`${tokenSummary.symbol} per payment`, `<= ${tokenSummary.perTx}`);
    ui.field(`${tokenSummary.symbol} per day`, `<= ${tokenSummary.daily}`);
    ui.field(`${tokenSummary.symbol} lifetime`, `<= ${tokenSummary.lifetime}`);
  }
  ui.field("Vault", fundingLine(options.deposit, vaultBalance, depositShortfall));
  ui.field(
    "Fee budget",
    `${fundingLine(options.feeBudget, feePayerBalance, feeBudgetShortfall)} - ~${feeBudgetPayments(options.feeBudget)} payments`,
  );
  ui.field("Session expires", new Date(Number(sessionExpiresAt) * 1000).toISOString());
  ui.blank();

  if (options.dryRun) {
    ui.info(ui.dim(`Dry run: ${stages.length} transaction(s) would be sent. Nothing signed.`));
    return 0;
  }

  if (stages.length === 0) {
    ui.succeed("Everything already exists on-chain - nothing to do");
  } else {
    if (!options.yes && !options.json) {
      const confirmed = await confirm(
        `Send ${stages.length} transaction(s) and move ${formatSol(depositShortfall + feeBudgetShortfall)}?`,
      );
      if (!confirmed) {
        ui.fail("Aborted");
        return 130;
      }
      ui.blank();
    }

    for (const [index, stage] of stages.entries()) {
      ui.start(`[${index + 1}/${stages.length}] ${stage.label}`);
      const signature = await sendTransaction(rpc, wallet, stage.instructions, {
        label: stage.label,
      });
      ui.succeed(`[${index + 1}/${stages.length}] ${stage.label}`, signature);
    }
  }

  // ---- Record and report ------------------------------------------------------------

  const manifest: Manifest = {
    version: 1,
    rpcUrl,
    programId: AGENT_RAILS_PROGRAM_ADDRESS,
    treasury: plan.treasury,
    solVault: plan.solVault,
    policy: plan.policy,
    policyName: options.name,
    session: plan.session,
    sessionKey: sessionKey.address,
    sessionKeypairPath,
    sessionExpiresAt: new Date(Number(sessionExpiresAt) * 1000).toISOString(),
    feePayer: feePayer.address,
    feePayerKeypairPath,
    destination,
    destinationLabel: "demo",
    ...(tokenSummary
      ? {
          tokenMint: tokenSummary.mint,
          tokenSymbol: tokenSummary.symbol,
          tokenDecimals: tokenSummary.decimals,
          tokenVaultAta: tokenSummary.vaultAta,
        }
      : {}),
    owner: wallet.address,
    createdAt: new Date().toISOString(),
  };
  await writeManifest(manifestFile, manifest);

  const serverEntry = resolveMcpEntry(options.mcpEntry, ui);
  const sinkPath = join(outDir, "payments.jsonl");
  const configJson = renderMcpConfig({
    serverEntry,
    rpcUrl,
    session: plan.session,
    signerKeypairPath: sessionKeypairPath,
    feePayerKeypairPath,
    sinkPath,
    // Declared so the agent can say `mint_ref: "USDC"` rather than a base58 address.
    ...(tokenSummary ? { mintAliases: { [tokenSummary.symbol]: tokenSummary.mint } } : {}),
  });

  const snippetPath = join(outDir, "claude_desktop_config.snippet.json");
  await writeFile(snippetPath, configJson, "utf8");

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ manifest, mcpConfigPath: snippetPath, mcpConfig: JSON.parse(configJson) }, null, 2)}\n`,
    );
    return 0;
  }

  ui.blank();
  ui.heading("Ready. Paste this into claude_desktop_config.json");
  ui.blank();
  ui.code(configJson.trimEnd());
  ui.blank();
  ui.field("Saved to", snippetPath);
  ui.field("Manifest", manifestFile);
  if (claudeDesktopSupported()) {
    ui.field("Config file", claudeDesktopConfigPath());
  } else {
    ui.field(
      "Config file",
      ui.dim("Claude Desktop has no Linux build - use Cursor or an MCP client"),
    );
  }
  ui.blank();
  ui.info(ui.bold("The agent can now pay, and can do nothing else."));
  const perPayment = tokenSummary
    ? `${formatSol(limits.perTxMax)} or ${tokenSummary.perTx}`
    : formatSol(limits.perTxMax);
  ui.info(
    ui.dim(
      `It may send at most ${perPayment} per payment, only to ${shorten(destination)}, ` +
        "and cannot raise a limit, add a destination, or unpause.",
    ),
  );

  return 0;
}

/**
 * Reuse a key from a previous run rather than rotating it.
 *
 * Re-running `init` after a failed transaction must not mint a second session key: the
 * first one may already be referenced by a session PDA on-chain, and rotating would leave
 * that session unusable and its rent stranded.
 */
async function reuseOrCreate(path: string, ui: Ui, what: string): Promise<KeyPairSigner> {
  const existing = await loadIfPresent(path);
  if (existing) {
    ui.skip(`Reusing ${what}`, existing.address);
    return existing;
  }
  const created = await createAndSaveKeypair(path);
  ui.succeed(`Generated ${what}`, `${created.address} -> ${path}`);
  return created;
}

/**
 * The destination the agent is allowed to pay.
 *
 * Defaulting to a generated key rather than requiring one is a deliberate TTFV call: the
 * point of the first run is to watch a guarded payment succeed, and demanding a counterparty
 * address before that is a question the developer cannot answer yet. The keypair is written
 * to disk so the payment can be verified as received.
 */
async function resolveDestination(options: InitOptions, outDir: string, ui: Ui): Promise<Address> {
  if (options.destination) {
    return parseAddress(options.destination, "--destination");
  }
  const path = join(outDir, "demo-destination-keypair.json");
  const existing = await loadIfPresent(path);
  if (existing) {
    ui.skip("Reusing demo destination", existing.address);
    return existing.address;
  }
  const created = await createAndSaveKeypair(path);
  ui.succeed("Generated demo destination", created.address);
  return created.address;
}

export type TokenSummary = {
  symbol: string;
  decimals: number;
  mint: string;
  vaultAta: string;
  perTx: string;
  daily: string;
  lifetime: string;
  /** Base units still to be minted into the vault, for a mock mint. */
  mintShortfall: bigint;
};

/**
 * Decide which mints this treasury will hold.
 *
 * Native SOL is always first and always present: it needs no token account, no ATA and no
 * counterparty, so it is the one path guaranteed to work on a cluster the developer has
 * just met. An SPL mint is added on top of it, never instead of it.
 *
 * The two token flags are deliberately different tools. `--mint` accepts a mint that
 * already exists — devnet USDC, or anything a team already issues — and cannot fund the
 * vault, because nobody but that mint's authority can. `--mock-mint` creates one this
 * wallet controls, which is the only way a fresh cluster gets a spendable token balance
 * without a faucet that does not exist.
 */
async function resolveMints(
  options: InitOptions,
  rpc: Rpc,
  treasury: Address,
  destination: Address,
  outDir: string,
  ui: Ui,
): Promise<{ mints: MintPlan[]; mockMint?: MockMintPlan; tokenSummary?: TokenSummary }> {
  const solLimits = resolveLimits(options);
  const sol: MintPlan = {
    mint: NATIVE_MINT_ADDRESS,
    decimals: SOL_DECIMALS,
    tokenProgram: SYSTEM_PROGRAM_ADDRESS,
    limits: solLimits,
    symbol: "SOL",
  };

  if (options.mint && options.mockMint) {
    throw new CliError("--mint and --mock-mint are mutually exclusive", {
      hint: "--mint accepts an existing mint; --mock-mint creates a new one.",
    });
  }
  if (!options.mint && !options.mockMint) {
    return { mints: [sol] };
  }

  let tokenMint: Address;
  let mockMint: MockMintPlan | undefined;
  let symbol: string;

  if (options.mockMint) {
    // Persisted like the session key: a re-run after a failed transaction must reuse the
    // same mint, or the treasury ends up with two ceilings for two tokens the developer
    // never asked for and only one of which the policy covers.
    const path = join(outDir, "mock-mint-keypair.json");
    const existing = await loadIfPresent(path);
    const keypair = existing ?? (await createAndSaveKeypair(path));
    ui[existing ? "skip" : "succeed"](
      existing ? "Reusing mock mint" : "Generated mock mint",
      keypair.address,
    );
    tokenMint = keypair.address;
    symbol = "MOCK";
    mockMint = {
      keypair,
      decimals: options.mockMintDecimals,
      rentLamports: await mintRentLamports(rpc),
      supply: 0n,
    };
  } else {
    tokenMint = parseAddress(options.mint as string, "--mint");
    symbol = "TOKEN";
  }

  // A mint this run is about to create has no account yet, so its decimals and token
  // program come from the plan rather than from a read that would fail.
  const info = mockMint
    ? {
        mint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS as Address,
        decimals: mockMint.decimals,
        vaultAta: (
          await findAssociatedTokenAddress({
            owner: treasury,
            mint: tokenMint,
            tokenProgram: TOKEN_PROGRAM_ADDRESS as Address,
          })
        )[0],
      }
    : await readMint(rpc, tokenMint, treasury);

  const tokenLimits = resolveTokenLimits(options, info.decimals);
  const [destinationAta] = await findAssociatedTokenAddress({
    owner: destination,
    mint: info.mint,
    tokenProgram: info.tokenProgram,
  });
  const token: MintPlan = {
    mint: info.mint,
    decimals: info.decimals,
    tokenProgram: info.tokenProgram,
    vaultAta: info.vaultAta,
    destinationAta,
    limits: tokenLimits,
    symbol,
  };

  let mintShortfall = 0n;
  if (mockMint) {
    // Shortfall, not a fixed amount, for the same reason the SOL deposit is: re-running
    // must leave the vault holding --token-deposit, not a multiple of it.
    const target = toBaseUnits(options.tokenDeposit, info.decimals);
    const held = await tokenBalance(rpc, info.vaultAta);
    mintShortfall = held >= target ? 0n : target - held;
    mockMint.supply = mintShortfall;
  }

  return {
    mints: [sol, token],
    ...(mockMint ? { mockMint } : {}),
    tokenSummary: {
      symbol,
      decimals: info.decimals,
      mint: info.mint,
      vaultAta: info.vaultAta,
      perTx: `${fromBaseUnits(tokenLimits.perTxMax, info.decimals)} ${symbol}`,
      daily: `${fromBaseUnits(tokenLimits.longWindowMax, info.decimals)} ${symbol}`,
      lifetime: `${fromBaseUnits(tokenLimits.lifetimeMax, info.decimals)} ${symbol}`,
      mintShortfall,
    },
  };
}

/** Token limits, parsed in human units and scaled by the mint's own decimals. */
function resolveTokenLimits(options: InitOptions, decimals: number): BootstrapLimits {
  const perTxMax = toBaseUnits(options.tokenPerTx, decimals);
  const daily = toBaseUnits(options.tokenDaily, decimals);
  const lifetimeMax = options.tokenLifetime
    ? toBaseUnits(options.tokenLifetime, decimals)
    : daily * 30n;

  if (perTxMax <= 0n || daily <= 0n) {
    throw new CliError("--token-per-tx and --token-daily must be greater than zero", {
      hint: "The policy engine rejects a zero limit as InvalidLimit.",
    });
  }
  if (perTxMax > daily) {
    throw new CliError("--token-per-tx exceeds --token-daily", {
      hint: "A per-payment cap above the daily cap cannot ever be reached.",
    });
  }
  if (lifetimeMax < daily) {
    throw new CliError("--token-lifetime must be at least --token-daily");
  }

  return {
    perTxMax,
    shortWindowMax: daily,
    shortWindowSeconds: 3_600,
    longWindowMax: daily,
    longWindowSeconds: 86_400,
    lifetimeMax,
  };
}

function parseAddress(value: string, flag: string): Address {
  try {
    return address(value);
  } catch (error) {
    throw new CliError(`${flag} is not a valid Solana address: ${value}`, { cause: error });
  }
}

function resolveLimits(options: InitOptions): BootstrapLimits {
  if (options.perTx > options.daily) {
    throw new CliError(
      `--per-tx (${formatSol(options.perTx)}) exceeds --daily (${formatSol(options.daily)})`,
      { hint: "A per-payment cap above the daily cap cannot ever be reached." },
    );
  }
  const lifetime = options.lifetime ?? options.daily * 30n;
  if (lifetime < options.daily) {
    throw new CliError("--lifetime must be at least --daily");
  }
  return {
    perTxMax: options.perTx,
    // An hour and a day, which is the shortest pair the program accepts alongside a
    // meaningful long window: `validate_limit` requires both >= MIN_WINDOW_SECONDS and
    // short <= long.
    shortWindowMax: options.daily,
    shortWindowSeconds: 3_600,
    longWindowMax: options.daily,
    longWindowSeconds: 86_400,
    lifetimeMax: lifetime,
  };
}

function resolveExpiry(hours: number): bigint {
  const seconds = hours * 3_600;
  if (seconds > MAX_SESSION_TTL_SECONDS) {
    throw new CliError(
      `--session-ttl of ${hours}h exceeds the program's maximum of ` +
        `${MAX_SESSION_TTL_SECONDS / 3_600}h`,
    );
  }
  if (seconds < MIN_WINDOW_SECONDS) {
    throw new CliError(`--session-ttl must be at least ${MIN_WINDOW_SECONDS} seconds`);
  }
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

function describeState(state: StepState): string {
  const done = [
    state.treasuryExists && "treasury",
    state.configuredMints.length > 0 && `${state.configuredMints.length} mint(s)`,
    state.policyExists && "policy",
    state.entryExists && "allowlist",
    state.sessionExists && "session",
  ].filter((value): value is string => typeof value === "string");
  return done.length === 0 ? "nothing yet - full bootstrap" : `already present: ${done.join(", ")}`;
}

/**
 * Accounts still to be opened, each of which costs the wallet rent.
 *
 * Counts mints rather than assuming one: a run that adds USDC to an existing treasury opens
 * a vault token account, and one that creates a mock mint opens the mint account too.
 */
function stagesRemaining(state: StepState, mintCount: number): number {
  const missingMints = Math.max(0, mintCount - state.configuredMints.length);
  return (
    [state.treasuryExists, state.policyExists, state.entryExists, state.sessionExists].filter(
      (done) => !done,
    ).length + missingMints
  );
}

/** How much must move for `held` to reach `target`. Never negative. */
function shortfall(target: bigint, held: bigint): bigint {
  return held >= target ? 0n : target - held;
}

function fundingLine(target: bigint, held: bigint, moving: bigint): string {
  if (moving === 0n) return `${formatSol(held)} (already at or above ${formatSol(target)})`;
  return `${formatSol(held)} -> ${formatSol(target)} (sending ${formatSol(moving)})`;
}

function feeBudgetPayments(feeBudget: bigint): number {
  // Each payment pays a signature fee plus rent for its own IntentReceipt PDA, which the
  // fee payer funds. Receipts are reclaimable later via `close_receipt`.
  const perPayment = RECEIPT_RENT_LAMPORTS + 10_000n;
  return Number(feeBudget / perPayment);
}

/**
 * Locate the built MCP server entry point.
 *
 * Worth searching for rather than assuming: the config names an absolute path, and if that
 * file does not exist Claude Desktop fails at startup with nothing in the UI to say why.
 * Catching it here turns a silent dead end into one line telling the developer to run
 * `pnpm --filter @agent-rails/mcp build`.
 *
 * Checked in order: next to this CLI inside the workspace, then relative to the working
 * directory for someone running from the repository root.
 */
function resolveMcpEntry(explicit: string | undefined, ui: Ui): string {
  if (explicit) return expandPath(explicit);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../mcp/dist/cli.js"),
    resolve(here, "../mcp/dist/cli.js"),
    resolve(process.cwd(), "packages/mcp/dist/cli.js"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  ui.warn("The MCP server is not built - the config below points at a file that does not exist");
  ui.info(
    ui.dim("  Build it with `pnpm --filter @agent-rails/mcp build`, or pass --mcp-entry <path>."),
  );
  return candidates[candidates.length - 1] as string;
}

function shorten(value: string): string {
  return `${value.slice(0, 4)}..${value.slice(-4)}`;
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [Y/n] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === "" || normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
