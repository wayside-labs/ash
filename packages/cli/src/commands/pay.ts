import { fetchMaybeAgentSession } from "@agent-rails/client";
import {
  AmountConversionError,
  deriveIntentId,
  intentIdToHex,
  toBaseUnits,
} from "@agent-rails/contract";
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import {
  buildPaymentIntent,
  executePayment,
  isAgentRailsError,
  loadDestinationIndex,
  resolveDestination,
} from "@agent-rails/sdk";
import { type Address, address } from "@solana/kit";
import { type MintCeilingView, readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext, type ResolvedContext } from "../context.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../parse.js";
import type { Ui } from "../ui.js";
import { loadWallet } from "../wallet.js";

/**
 * A payment made from the operator's own terminal, through the same instruction the agent
 * uses and with the same session key.
 *
 * This is deliberately not a privileged shortcut. It signs with the session keypair `init`
 * wrote, so every ceiling, window and allowlist entry applies exactly as it would to the
 * agent — which is what makes it usable as a demo and as a smoke test. An operator who
 * wants to move money outside the policy has `withdraw`, and that one is owner-only.
 *
 * The destination is a label by default for the same reason the MCP surface insists on one:
 * under an allowlist policy a raw address is refused on-chain, and finding that out after
 * paying a fee is worse than being told here.
 */

/** Default validity of the intent itself, not of the session. */
const DEFAULT_EXPIRY_SECONDS = 300;

export type PayOptions = GlobalCliOptions & {
  to: string;
  amount: string;
  mint?: string;
  reference: string;
  memo?: string;
  session?: string;
  sessionKeypair?: string;
  feePayerKeypair?: string;
  expiresIn?: number;
  allowRawAddress?: boolean;
  /** Overrides the SDK confirmation wait. `0` forces an `indeterminate` outcome after broadcast. */
  confirmTimeoutMs?: number;
};

/**
 * `SOL`, a name the operator gave a mint, or a mint address.
 *
 * `aliases` is what `init` recorded — the same `SYMBOL:address` map the MCP server is
 * handed, so a mint is addressable by the same name from the CLI and from the agent. The
 * chain itself stores no ticker: a symbol read off a ceiling is the first four characters
 * of the address, which is a rendering aid and not a name anybody chose.
 */
export function resolveMint(
  ceilings: MintCeilingView[],
  ref: string | undefined,
  aliases: Record<string, string> = {},
): MintCeilingView {
  const wanted = (ref ?? "SOL").trim();
  const native = ceilings.find((entry) => entry.mint === address(NATIVE_MINT));

  if (wanted.toUpperCase() === "SOL") {
    if (!native) throw new CliError("This treasury has no native SOL mint configured");
    return native;
  }

  const aliased = Object.entries(aliases).find(
    ([symbol]) => symbol.toUpperCase() === wanted.toUpperCase(),
  )?.[1];
  if (aliased) {
    const byAlias = ceilings.find((entry) => entry.mint === aliased);
    if (byAlias) return byAlias;
    throw new CliError(`${wanted} names ${aliased}, which this treasury does not accept`, {
      hint: "The manifest is from another treasury, or the mint was removed.",
    });
  }

  const bySymbol = ceilings.find((entry) => entry.symbol.toUpperCase() === wanted.toUpperCase());
  if (bySymbol) return bySymbol;

  const byAddress = ceilings.find((entry) => entry.mint === wanted);
  if (byAddress) return byAddress;

  throw new CliError(`${wanted} is not a mint this treasury accepts`, {
    hint: `Configured: ${ceilings.map((c) => `${c.symbol} (${c.mint})`).join(", ")}`,
  });
}

/**
 * The session to pay from: an explicit `--session`, else the one `init` recorded. Never
 * "the first live session on the treasury" — that would silently pick a different agent's
 * budget when a treasury has several.
 */
function resolveSession(ctx: ResolvedContext, override: string | undefined): Address {
  if (override) return parseAddress(override, "--session");
  const recorded = ctx.manifest?.session;
  if (!recorded) {
    throw new CliError("No session recorded for this cluster", {
      hint: "Pass --session <pda> --session-keypair <path>, or run `agent-rails init` first.",
    });
  }
  return address(recorded);
}

export async function runPay(options: PayOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);

  if (snapshot.treasuryAccount.paused) {
    throw new CliError("This treasury is paused", {
      hint: "Agents cannot pay while paused. `agent-rails unpause` is owner-only.",
    });
  }

  const session = resolveSession(ctx, options.session);
  const sessionAccount = await fetchMaybeAgentSession(ctx.rpc, session, {
    commitment: "confirmed",
  });
  if (!sessionAccount.exists) throw new CliError(`No session account at ${session}`);
  if (sessionAccount.data.revoked) {
    throw new CliError(`Session ${session} is revoked`, {
      hint: "Create a new one: agent-rails session create --label <name>",
    });
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(sessionAccount.data.expiresAt) <= now) {
    throw new CliError(`Session ${session} expired`, {
      hint: `Expired at ${new Date(Number(sessionAccount.data.expiresAt) * 1000).toISOString()}`,
    });
  }

  // The session key is the signer the program checks; the fee payer only pays for the
  // transaction. They are separate keys on purpose — a fee payer that ran dry must not be
  // able to make the session key unusable, and vice versa.
  const sessionKeypairPath = options.sessionKeypair ?? ctx.manifest?.sessionKeypairPath;
  if (!sessionKeypairPath) {
    throw new CliError("No session keypair path", { hint: "Pass --session-keypair <path>." });
  }
  const sessionKey = await loadWallet(sessionKeypairPath);
  if (sessionKey.address !== sessionAccount.data.sessionKey) {
    throw new CliError("The session keypair does not match the session account", {
      hint: `Account expects ${sessionAccount.data.sessionKey}, the file holds ${sessionKey.address}.`,
    });
  }
  const feePayerPath = options.feePayerKeypair ?? ctx.manifest?.feePayerKeypairPath;
  const feePayer = feePayerPath ? await loadWallet(feePayerPath) : sessionKey;

  const aliases =
    ctx.manifest?.tokenSymbol && ctx.manifest.tokenMint
      ? { [ctx.manifest.tokenSymbol]: ctx.manifest.tokenMint }
      : {};
  const mint = resolveMint(snapshot.ceilings, options.mint, aliases);

  let amount: bigint;
  try {
    amount = toBaseUnits(options.amount.trim(), mint.decimals);
  } catch (error) {
    if (error instanceof AmountConversionError) {
      throw new CliError(error.message, {
        hint: `${mint.symbol} holds ${mint.decimals} decimal places.`,
        cause: error,
      });
    }
    throw error;
  }
  if (amount <= 0n) throw new CliError("--amount must be greater than zero");

  const index = await loadDestinationIndex({
    rpc: ctx.rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy: ctx.policy,
  });
  const destination = resolveDestination({
    index,
    ref: options.to,
    allowRawAddress: options.allowRawAddress ?? false,
  });

  // Derived, never drawn: two runs of the same payment collide on the same receipt PDA and
  // the second is refused on-chain instead of paying twice (ADR-004).
  const intentId = deriveIntentId({
    session: String(session),
    destination: String(destination.owner),
    mint: String(mint.mint),
    amount,
    reference: options.reference,
  });
  const intentIdHex = intentIdToHex(intentId);

  ui.heading("Payment");
  ui.field(
    "To",
    destination.label ? `${destination.label} (${destination.owner})` : destination.owner,
  );
  ui.field("Amount", `${options.amount} ${mint.symbol}`);
  ui.field("Reference", options.reference);
  ui.field("Intent id", intentIdHex);
  ui.field("Session", String(session));

  if (options.dryRun) {
    ui.info(ui.dim("Dry run: nothing was sent."));
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          outcome: "dry-run",
          intent_id: intentIdHex,
          destination: destination.owner,
          mint: mint.mint,
          amount: amount.toString(),
        })}\n`,
      );
    }
    return 0;
  }

  const {
    value: { blockhash, lastValidBlockHeight },
  } = await ctx.rpc.getLatestBlockhash().send();

  const payment = await buildPaymentIntent({
    intent_id: intentIdHex,
    mint: String(mint.mint),
    destination: String(destination.owner),
    amount,
    expires_at: now + (options.expiresIn ?? DEFAULT_EXPIRY_SECONDS),
    ...(options.memo ? { memo: options.memo } : {}),
    treasury: String(ctx.treasury),
    policy: String(ctx.policy),
    session: String(session),
    ...(destination.entry ? { allowlistEntry: String(destination.entry) } : {}),
    feePayer,
    sessionKey,
    recentBlockhash: { blockhash, lastValidBlockHeight },
  });

  ui.start("Sending payment");
  try {
    const executed = await executePayment({
      rpc: ctx.rpc as Parameters<typeof executePayment>[0]["rpc"],
      transactionMessage: payment.transactionMessage,
      lastValidBlockHeight,
      session,
      intentId,
      ...(options.confirmTimeoutMs !== undefined
        ? {
            confirmTimeoutMs: options.confirmTimeoutMs,
            // A zero timeout is for demos: surface `indeterminate` instead of resolving
            // the receipt and reporting `settled`.
            ...(options.confirmTimeoutMs === 0 ? { resolveAttempts: 0 } : {}),
          }
        : {}),
    });
    ui.succeed("Payment settled", executed.signature);

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          outcome: "settled",
          intent_id: intentIdHex,
          receipt: executed.receipt,
          signature: executed.signature,
          destination: destination.owner,
          mint: mint.mint,
          amount: amount.toString(),
        })}\n`,
      );
    }
    return 0;
  } catch (error) {
    if (!isAgentRailsError(error)) throw error;
    ui.fail(error.message);

    // An indeterminate outcome is not a failure to retry. The transfer may already exist,
    // and the correct next move is to look the intent up rather than send it again.
    const indeterminate = error.outcome === "indeterminate";
    if (indeterminate) {
      ui.info(
        ui.dim(
          `Look it up before retrying: agent-rails audit export --session ${session} | grep ${intentIdHex}`,
        ),
      );
    }
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          outcome: error.outcome,
          reason_code: error.reasonCode,
          intent_id: intentIdHex,
          message: error.message,
          ...(error.signature ? { signature: error.signature } : {}),
        })}\n`,
      );
    }
    return indeterminate ? 75 : 1;
  }
}
