import { type Command, InvalidArgumentError, Option } from "commander";
import { parseSol } from "./amounts.js";
import { isCliError } from "./errors.js";
import { DEFAULT_WALLET_PATH } from "./wallet.js";

export const DEFAULT_RPC = "https://api.devnet.solana.com";

export type GlobalCliOptions = {
  rpc: string;
  wallet: string;
  out: string;
  treasury?: string;
  policy?: string;
  policyName?: string;
  yes: boolean;
  json: boolean;
  dryRun: boolean;
  mcpEntry?: string;
};

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

/** Shared flags every day-2 command accepts. */
export function addGlobalOptions(command: Command): Command {
  return command
    .addOption(new Option("--rpc <url>", "RPC endpoint").default(DEFAULT_RPC))
    .addOption(
      new Option("--wallet <path>", "Operator or owner keypair").default(DEFAULT_WALLET_PATH),
    )
    .addOption(new Option("--out <dir>", "Manifest and key directory").default(".agent-rails"))
    .addOption(new Option("--treasury <address>", "Treasury PDA (default: manifest)"))
    .addOption(new Option("--policy <address>", "Policy PDA (default: manifest)"))
    .addOption(
      new Option("--policy-name <name>", "Policy name for PDA lookup (default: manifest name)"),
    )
    .addOption(new Option("--mcp-entry <path>", "Path to the built MCP server entry point"))
    .addOption(new Option("-y, --yes", "Skip confirmation prompts").default(false))
    .addOption(new Option("--json", "Emit JSON on stdout only").default(false))
    .addOption(new Option("--dry-run", "Print the plan without signing").default(false));
}

export function parseGlobalOptions(options: Record<string, unknown>): GlobalCliOptions {
  const parsed: GlobalCliOptions = {
    rpc: options.rpc as string,
    wallet: options.wallet as string,
    out: options.out as string,
    yes: options.yes === true,
    json: options.json === true,
    dryRun: options.dryRun === true,
  };
  if (typeof options.treasury === "string") parsed.treasury = options.treasury;
  if (typeof options.policy === "string") parsed.policy = options.policy;
  if (typeof options.policyName === "string") parsed.policyName = options.policyName;
  if (typeof options.mcpEntry === "string") parsed.mcpEntry = options.mcpEntry;
  return parsed;
}

export { argParser, parseSol };
