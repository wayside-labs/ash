#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from "commander";
import pc from "picocolors";
import { parsePositiveInt, parseSol } from "./amounts.js";
import { runInit } from "./commands/init.js";
import { CliError, isCliError } from "./errors.js";
import { Ui } from "./ui.js";
import { DEFAULT_WALLET_PATH } from "./wallet.js";

const DEFAULT_RPC = "https://api.devnet.solana.com";

/**
 * Commander wraps a thrown `InvalidArgumentError` with the flag name and the usage line,
 * which is strictly better output than anything this CLI would print by hand — so the
 * shared parsers throw `CliError` and it is translated here rather than duplicated.
 */
function argParser<T>(parse: (value: string) => T) {
  return (value: string): T => {
    try {
      return parse(value);
    } catch (error) {
      if (isCliError(error)) throw new InvalidArgumentError(error.message);
      throw error;
    }
  };
}

const program = new Command();

program
  .name("agent-rails")
  .description("Guardrails and treasury bootstrap for autonomous Solana payments")
  .version("0.0.0");

program
  .command("init")
  .description("Create a devnet treasury, policy, allowlist and session, then print an MCP config")
  .addOption(new Option("--rpc <url>", "RPC endpoint to bootstrap against").default(DEFAULT_RPC))
  .addOption(
    new Option("--wallet <path>", "Keypair that becomes owner, operator and payer").default(
      DEFAULT_WALLET_PATH,
    ),
  )
  .addOption(
    new Option("--out <dir>", "Where to write keys, the manifest and the MCP config").default(
      ".agent-rails",
    ),
  )
  .addOption(new Option("--name <name>", "Policy name, max 32 bytes").default("default"))
  .addOption(
    new Option("--destination <address>", "The one address the agent may pay").default(
      undefined,
      "a generated demo address",
    ),
  )
  // Every SOL amount carries an explicit default description. Commander renders a default
  // by JSON.stringify-ing it, which throws on a bigint - and lamports in help text would be
  // unreadable anyway, so the human figure is the better string regardless.
  .addOption(
    new Option("--per-tx <sol>", "Maximum SOL per payment")
      .argParser(argParser((v) => parseSol(v, "--per-tx")))
      .default(100_000_000n, "0.1 SOL"),
  )
  .addOption(
    new Option("--daily <sol>", "Maximum SOL per day")
      .argParser(argParser((v) => parseSol(v, "--daily")))
      .default(1_000_000_000n, "1 SOL"),
  )
  .addOption(
    new Option("--lifetime <sol>", "Maximum SOL ever")
      .argParser(argParser((v) => parseSol(v, "--lifetime")))
      .default(undefined, "30x --daily"),
  )
  .addOption(
    new Option("--deposit <sol>", "SOL to move into the vault")
      .argParser(argParser((v) => parseSol(v, "--deposit")))
      .default(500_000_000n, "0.5 SOL"),
  )
  .addOption(
    new Option("--fee-budget <sol>", "SOL for the agent fee payer")
      .argParser(argParser((v) => parseSol(v, "--fee-budget")))
      .default(50_000_000n, "0.05 SOL"),
  )
  .addOption(
    new Option("--session-ttl <hours>", "Session lifetime in hours")
      .argParser(argParser((v) => parsePositiveInt(v, "--session-ttl")))
      .default(24, "24"),
  )
  // ---- SPL / Token-2022 --------------------------------------------------------------
  // Token limits are human-unit strings, not lamports: they are scaled by the mint's own
  // decimals, which is only known once the mint has been read off the chain.
  .addOption(
    new Option("--mint <address>", "An existing SPL or Token-2022 mint to accept alongside SOL"),
  )
  .addOption(
    new Option("--mock-mint", "Create a throwaway SPL mint and fund the vault with it").default(
      false,
    ),
  )
  .addOption(
    new Option("--mock-mint-decimals <n>", "Decimals for the mock mint")
      .argParser(argParser((v) => parsePositiveInt(v, "--mock-mint-decimals")))
      .default(6, "6, matching USDC"),
  )
  .addOption(new Option("--token-per-tx <amount>", "Maximum token per payment").default("10"))
  .addOption(new Option("--token-daily <amount>", "Maximum token per day").default("100"))
  .addOption(
    new Option("--token-lifetime <amount>", "Maximum token ever").default(
      undefined,
      "30x --token-daily",
    ),
  )
  .addOption(
    new Option("--token-deposit <amount>", "Mock tokens to mint into the vault").default("1000"),
  )
  .addOption(new Option("--mcp-entry <path>", "Path to the built MCP server entry point"))
  .addOption(new Option("--no-airdrop", "Never ask the faucet, even when the wallet is short"))
  .addOption(new Option("-y, --yes", "Skip the confirmation prompt").default(false))
  .addOption(
    new Option("--json", "Emit the result as JSON on stdout and nothing else").default(false),
  )
  .addOption(
    new Option("--force", "Create a new treasury, ignoring any recorded one").default(false),
  )
  .addOption(
    new Option("--dry-run", "Resolve and print the plan without signing anything").default(false),
  )
  .addHelpText(
    "after",
    `
Examples:
  $ agent-rails init
  $ agent-rails init --rpc http://127.0.0.1:8899 --yes
  $ agent-rails init --per-tx 0.01 --daily 0.1 --destination <address>
  $ agent-rails init --dry-run
  $ agent-rails init --mock-mint                      # SOL + a token you can actually spend
  $ agent-rails init --mint <usdc-mint> --token-per-tx 5
`,
  )
  .action(async (options) => {
    const ui = new Ui({ quiet: options.json === true });
    const exitCode = await runInit(
      {
        rpc: options.rpc,
        wallet: options.wallet,
        out: options.out,
        name: options.name,
        destination: options.destination,
        perTx: options.perTx,
        daily: options.daily,
        lifetime: options.lifetime,
        deposit: options.deposit,
        feeBudget: options.feeBudget,
        sessionTtlHours: options.sessionTtl,
        airdrop: options.airdrop !== false,
        yes: options.yes === true,
        json: options.json === true,
        force: options.force === true,
        dryRun: options.dryRun === true,
        mcpEntry: options.mcpEntry,
        mint: options.mint,
        mockMint: options.mockMint === true,
        mockMintDecimals: options.mockMintDecimals,
        tokenPerTx: options.tokenPerTx,
        tokenDaily: options.tokenDaily,
        tokenLifetime: options.tokenLifetime,
        tokenDeposit: options.tokenDeposit,
      },
      ui,
    );
    process.exitCode = exitCode;
  });

/**
 * One error boundary for the whole CLI.
 *
 * An anticipated failure prints its message and its hint and exits; anything else prints a
 * stack trace. Collapsing the two would make a real bug in this package look like a
 * misconfigured cluster, which is the most expensive kind of wrong message to send a
 * developer at a hackathon.
 */
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const ui = new Ui();
    if (isCliError(error)) {
      ui.blank();
      ui.fail(error.message);
      if (error.hint) {
        for (const line of error.hint.split("\n")) {
          process.stderr.write(`  ${pc.dim(line)}\n`);
        }
      }
      process.exit(error.exitCode);
    }
    ui.blank();
    ui.fail("Unexpected error - this is a bug in agent-rails");
    console.error(error);
    process.exit(1);
  }
}

void main();

export { CliError };
