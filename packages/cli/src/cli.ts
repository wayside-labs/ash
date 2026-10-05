#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError, Option } from "commander";
import pc from "picocolors";
import { parseNonNegativeInt, parsePositiveInt, parseSol } from "./amounts.js";
import { addGlobalOptions, argParser, DEFAULT_RPC, parseGlobalOptions } from "./cli-options.js";
import {
  runGuardianAdd,
  runGuardianLs,
  runGuardianRm,
  runMintRm,
  runRolesSet,
} from "./commands/admin.js";
import { runAuditExport } from "./commands/audit.js";
import { runCeilingSet } from "./commands/ceiling.js";
import { runClosePolicy, runCloseReceipt, runCloseTreasury } from "./commands/close.js";
import { runDeposit } from "./commands/deposit.js";
import { runDestAdd, runDestLs, runDestRm } from "./commands/dest.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runMcpEmit } from "./commands/mcp.js";
import { runPause, runUnpause } from "./commands/pause.js";
import { runPay } from "./commands/pay.js";
import { runPolicySet, runPolicyShow } from "./commands/policy.js";
import {
  runSessionClose,
  runSessionCreate,
  runSessionLs,
  runSessionRevoke,
  runSessionShow,
} from "./commands/session.js";
import { runStatus } from "./commands/status.js";
import { runWithdraw } from "./commands/withdraw.js";
import { CliError, isCliError } from "./errors.js";
import { Ui } from "./ui.js";
import { DEFAULT_WALLET_PATH } from "./wallet.js";

const program = new Command();

program
  .name("ash")
  .description("Guardrails and treasury operations for autonomous Solana payments")
  // Read from the manifest: a literal here went stale the first time the package was
  // versioned, and `--version` is the one output a user checks against a changelog.
  .version(
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string,
  );

program
  .command("init")
  .description("Create a treasury, policy, allowlist and session, then print an MCP config")
  .addOption(new Option("--rpc <url>", "RPC endpoint to bootstrap against").default(DEFAULT_RPC))
  .addOption(
    new Option("--wallet <path>", "Keypair that becomes owner, operator and payer").default(
      DEFAULT_WALLET_PATH,
    ),
  )
  .addOption(
    new Option("--out <dir>", "Where to write keys, the manifest and the MCP config").default(
      ".ash",
    ),
  )
  .addOption(new Option("--name <name>", "Policy name, max 32 bytes").default("default"))
  .addOption(
    new Option("--destination <address>", "The one address the agent may pay").default(
      undefined,
      "a generated demo address",
    ),
  )
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
  $ ash init
  $ ash init --rpc http://127.0.0.1:8899 --yes
`,
  )
  .action(async (options) => {
    const ui = new Ui({ quiet: options.json === true });
    process.exitCode = await runInit(
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
  });

function globalAction(
  runner: (opts: ReturnType<typeof parseGlobalOptions>, ui: Ui) => Promise<number>,
) {
  return async (options: Record<string, unknown>) => {
    const parsed = parseGlobalOptions(options);
    const ui = new Ui({ quiet: parsed.json });
    process.exitCode = await runner(parsed, ui);
  };
}

addGlobalOptions(
  program
    .command("status")
    .description("Show treasury ceilings, policy limits, sessions, balances, and pause state")
    .action(globalAction(runStatus)),
);

addGlobalOptions(
  program
    .command("doctor")
    .description("Preflight checks before demos: program, roles, session, allowlist, MCP")
    .action(globalAction(runDoctor)),
);

const mcp = program.command("mcp").description("MCP configuration helpers");
addGlobalOptions(
  mcp
    .command("emit")
    .description("Reprint claude_desktop_config.snippet.json from manifest + on-chain session")
    .action(globalAction(runMcpEmit)),
);

addGlobalOptions(
  program
    .command("deposit")
    .description("Top up the SOL vault to a target (shortfall semantics, same as init)")
    .addOption(
      new Option("--amount <sol>", "Target vault balance")
        .argParser(argParser((v) => parseSol(v, "--amount")))
        .makeOptionMandatory(),
    )
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runDeposit({ ...parsed, amount: options.amount as bigint }, ui);
    }),
);

addGlobalOptions(
  program
    .command("withdraw")
    .description("Owner withdraws SOL or SPL from the treasury vault")
    .addOption(new Option("--amount <amount>", "Human-unit amount").makeOptionMandatory())
    .addOption(new Option("--to <address>", "Destination wallet").makeOptionMandatory())
    .addOption(new Option("--mint <mint>", "Mint address or SOL (default: SOL)"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runWithdraw(
        {
          ...parsed,
          amount: options.amount as string,
          to: options.to as string,
          ...(typeof options.mint === "string" ? { mint: options.mint } : {}),
        },
        ui,
      );
    }),
);

addGlobalOptions(
  program
    .command("pause")
    .description("Pause the treasury (owner or guardian)")
    .action(globalAction(runPause)),
);

addGlobalOptions(
  program
    .command("unpause")
    .description("Unpause the treasury (owner only)")
    .action(globalAction(runUnpause)),
);

const ceiling = program.command("ceiling").description("Owner ceiling controls");
addGlobalOptions(
  ceiling
    .command("set")
    .description("Raise or lower the owner ceiling for a mint")
    .addOption(new Option("--mint <mint>", "Mint address or SOL").default("SOL"))
    .addOption(
      new Option(
        "--per-tx <amount>",
        "Max per payment in human units for the mint",
      ).makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--daily <amount>",
        "Max per day in human units for the mint",
      ).makeOptionMandatory(),
    )
    .addOption(new Option("--lifetime <amount>", "Max lifetime in human units for the mint"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runCeilingSet(
        {
          ...parsed,
          mint: options.mint as string,
          perTx: options.perTx as string,
          daily: options.daily as string,
          ...(typeof options.lifetime === "string" ? { lifetime: options.lifetime } : {}),
        },
        ui,
      );
    }),
);

const policy = program.command("policy").description("Operator policy controls");
addGlobalOptions(
  policy
    .command("show")
    .description("Show human-readable policy limits")
    .action(globalAction(runPolicyShow)),
);
addGlobalOptions(
  policy
    .command("set")
    .description("Rewrite the full PolicyInput (never per-field patch on-chain)")
    .addOption(new Option("--per-tx <amount>", "Per-payment cap in human units for --mint"))
    .addOption(new Option("--daily <amount>", "Daily cap in human units for --mint"))
    .addOption(new Option("--lifetime <amount>", "Lifetime cap in human units for --mint"))
    .addOption(new Option("--mint <mint>", "Mint to update (default: SOL)"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runPolicySet(
        {
          ...parsed,
          ...(typeof options.perTx === "string" ? { perTx: options.perTx } : {}),
          ...(typeof options.daily === "string" ? { daily: options.daily } : {}),
          ...(typeof options.lifetime === "string" ? { lifetime: options.lifetime } : {}),
          ...(typeof options.mint === "string" ? { mint: options.mint } : {}),
        },
        ui,
      );
    }),
);

const dest = program.command("dest").description("Allowlist destinations by label");
addGlobalOptions(
  dest
    .command("add")
    .description("Add a labeled destination owner")
    .addOption(new Option("--label <label>", "NFKC-normalized label").makeOptionMandatory())
    .addOption(new Option("--owner <address>", "Destination wallet owner").makeOptionMandatory())
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runDestAdd(
        { ...parsed, label: options.label as string, owner: options.owner as string },
        ui,
      );
    }),
);
addGlobalOptions(
  dest
    .command("rm")
    .description("Remove a destination by label")
    .addOption(new Option("--label <label>", "Label to remove").makeOptionMandatory())
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runDestRm({ ...parsed, label: options.label as string }, ui);
    }),
);
addGlobalOptions(
  dest.command("ls").description("List allowlisted destinations").action(globalAction(runDestLs)),
);

const session = program.command("session").description("Agent session lifecycle");
addGlobalOptions(
  session
    .command("create")
    .description("Create a session with a new 0600 keypair")
    .addOption(new Option("--label <label>", "Session label").makeOptionMandatory())
    .addOption(
      new Option("--session-ttl <hours>", "Session lifetime")
        .argParser(argParser((v) => parsePositiveInt(v, "--session-ttl")))
        .default(24),
    )
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runSessionCreate(
        {
          ...parsed,
          label: options.label as string,
          sessionTtlHours: options.sessionTtl as number,
        },
        ui,
      );
    }),
);
addGlobalOptions(
  session.command("ls").description("List sessions").action(globalAction(runSessionLs)),
);
addGlobalOptions(
  session
    .command("show")
    .description("Show one session")
    .addOption(new Option("--session <address>", "Session PDA (default: manifest)"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runSessionShow(
        {
          ...parsed,
          ...(typeof options.session === "string" ? { session: options.session } : {}),
        },
        ui,
      );
    }),
);
addGlobalOptions(
  session
    .command("revoke")
    .description("Revoke a session (operator or owner)")
    .addOption(new Option("--session <address>", "Session PDA").makeOptionMandatory())
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runSessionRevoke(
        { ...parsed, session: options.session as string },
        ui,
      );
    }),
);
addGlobalOptions(
  session
    .command("close")
    .description("Close a revoked or expired session")
    .addOption(new Option("--session <address>", "Session PDA").makeOptionMandatory())
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runSessionClose(
        { ...parsed, session: options.session as string },
        ui,
      );
    }),
);

const guardian = program
  .command("guardian")
  .description("Guardians may pause the treasury; only the owner may unpause");
addGlobalOptions(
  guardian
    .command("add")
    .description("Let an address pause this treasury (owner only)")
    .argument("<address>", "Guardian wallet")
    .action(async (guardianAddress: string, options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runGuardianAdd({ ...parsed, address: guardianAddress }, ui);
    }),
);
addGlobalOptions(
  guardian
    .command("rm")
    .description("Remove a guardian (owner only)")
    .argument("<address>", "Guardian wallet")
    .action(async (guardianAddress: string, options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runGuardianRm({ ...parsed, address: guardianAddress }, ui);
    }),
);
addGlobalOptions(
  guardian
    .command("ls")
    .description("List guardians")
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runGuardianLs(parsed, ui);
    }),
);

const roles = program.command("roles").description("Owner and operator assignment");
addGlobalOptions(
  roles
    .command("set")
    .description("Hand over ownership, the operator role, or both (owner only)")
    .addOption(new Option("--owner <address>", "New owner — this is irreversible from here"))
    .addOption(new Option("--operator <address>", "New operator"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runRolesSet(
        {
          ...parsed,
          ...(options.owner ? { owner: options.owner as string } : {}),
          ...(options.operator ? { operator: options.operator as string } : {}),
        },
        ui,
      );
    }),
);

const mint = program.command("mint").description("Mints the treasury accepts");
addGlobalOptions(
  mint
    .command("rm")
    .description("Delist a mint whose vault is empty (owner only)")
    .argument("<mint>", "Mint address")
    .action(async (mintAddress: string, options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runMintRm({ ...parsed, mint: mintAddress }, ui);
    }),
);

const close = program.command("close").description("Reclaim rent from finished accounts");
addGlobalOptions(
  close
    .command("policy")
    .description("Close a policy with no live sessions")
    .addOption(new Option("--rent-to <address>", "Where the rent goes; defaults to your wallet"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runClosePolicy(
        { ...parsed, ...(options.rentTo ? { rentTo: options.rentTo as string } : {}) },
        ui,
      );
    }),
);
addGlobalOptions(
  close
    .command("treasury")
    .description("Close an empty treasury with no policies or sessions (owner only)")
    .addOption(new Option("--rent-to <address>", "Where the rent goes; defaults to your wallet"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runCloseTreasury(
        { ...parsed, ...(options.rentTo ? { rentTo: options.rentTo as string } : {}) },
        ui,
      );
    }),
);
addGlobalOptions(
  close
    .command("receipt")
    .description("Close an expired receipt; the rent returns to whoever paid for it")
    .addOption(new Option("--receipt <address>", "Receipt PDA").makeOptionMandatory())
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runCloseReceipt(
        { ...parsed, receipt: options.receipt as string },
        ui,
      );
    }),
);

addGlobalOptions(
  program
    .command("pay")
    .description("Pay a registered destination with the session key, under the live policy")
    .addOption(
      new Option("--to <label>", "Destination label from the allowlist").makeOptionMandatory(),
    )
    .addOption(
      new Option("--amount <amount>", "Amount in human units, e.g. 12.50").makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--reference <text>",
        "What this settles — an invoice number, a task id",
      ).makeOptionMandatory(),
    )
    .addOption(
      new Option("--mint <ref>", "SOL, a configured symbol, or a mint address").default("SOL"),
    )
    .addOption(new Option("--memo <text>", "Memo, max 64 bytes"))
    .addOption(new Option("--session <address>", "Session PDA; defaults to the manifest's"))
    .addOption(new Option("--session-keypair <path>", "Signer for the session"))
    .addOption(new Option("--fee-payer-keypair <path>", "Pays the transaction fee"))
    .addOption(
      new Option("--expires-in <seconds>", "Validity of the intent")
        .argParser(argParser((v) => parsePositiveInt(v, "--expires-in")))
        .default(300, "300"),
    )
    .addOption(
      new Option(
        "--allow-raw-address",
        "Accept a raw address for --to; refused on-chain under an allowlist policy",
      ).default(false),
    )
    .addOption(
      new Option(
        "--confirm-timeout <ms>",
        "How long to wait for confirmation; 0 reports indeterminate after broadcast",
      ).argParser(argParser((v) => parseNonNegativeInt(v, "--confirm-timeout"))),
    )
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runPay(
        {
          ...parsed,
          to: options.to as string,
          amount: options.amount as string,
          reference: options.reference as string,
          mint: options.mint as string,
          ...(options.memo ? { memo: options.memo as string } : {}),
          ...(options.session ? { session: options.session as string } : {}),
          ...(options.sessionKeypair ? { sessionKeypair: options.sessionKeypair as string } : {}),
          ...(options.feePayerKeypair
            ? { feePayerKeypair: options.feePayerKeypair as string }
            : {}),
          expiresIn: options.expiresIn as number,
          allowRawAddress: options.allowRawAddress as boolean,
          ...(options.confirmTimeout !== undefined
            ? { confirmTimeoutMs: options.confirmTimeout as number }
            : {}),
        },
        ui,
      );
    }),
);

const audit = program.command("audit").description("The session's payment history");
addGlobalOptions(
  audit
    .command("export")
    .description("Export receipts and replay the hash chain against the on-chain head")
    .addOption(new Option("--session <address>", "Session PDA; defaults to the manifest's"))
    .addOption(
      new Option("--format <format>", "Output format")
        .choices(["json", "jsonl", "csv"])
        .default("json"),
    )
    .addOption(new Option("--no-verify", "Skip the chain replay and just export"))
    .action(async (options) => {
      const parsed = parseGlobalOptions(options);
      const ui = new Ui({ quiet: parsed.json });
      process.exitCode = await runAuditExport(
        {
          ...parsed,
          ...(options.session ? { session: options.session as string } : {}),
          format: options.format as "json" | "jsonl" | "csv",
          verify: options.verify as boolean,
        },
        ui,
      );
    }),
);

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
    if (error instanceof InvalidArgumentError) {
      ui.blank();
      ui.fail(error.message);
      process.exit(1);
    }
    ui.blank();
    ui.fail("Unexpected error - this is a bug in ash");
    console.error(error);
    process.exit(1);
  }
}

void main();

export { CliError };
