import { fetchMaybeAgentSession } from "@agent-rails/client";
import {
  auditHeadToHex,
  loadReceipts,
  type ReceiptRecord,
  verifyAuditChain,
} from "@agent-rails/sdk";
import { type Address, address } from "@solana/kit";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../parse.js";
import type { Ui } from "../ui.js";

/**
 * Export a session's payment history and check it against the chain's own head.
 *
 * The rows come from `IntentReceipt` accounts, which the program wrote — not from an
 * indexer we run. That matters for the only question this command exists to answer: an
 * auditor is being asked to trust the operator, and a history the operator's own service
 * assembled is not evidence. Replaying the hash chain against `AgentSession.audit_head`
 * makes omission and reordering detectable without trusting either of us.
 *
 * The limit of that guarantee is `close_receipt`: rent reclamation deletes the receipt, and
 * with it the link. A chain with a reclaimed prefix cannot be replayed from genesis, and
 * the command says so rather than reporting a mismatch as if something were wrong.
 */

export type AuditExportOptions = GlobalCliOptions & {
  session?: string;
  format: "json" | "jsonl" | "csv";
  verify: boolean;
};

const CSV_COLUMNS = [
  "seq",
  "intent_id",
  "timestamp",
  "slot",
  "mint",
  "destination_owner",
  "amount",
  "receipt",
  "memo_hash",
] as const;

/** RFC 4180: quote everything, double the quotes inside. No field here can contain one. */
function csvRow(values: readonly string[]): string {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

function rowOf(record: ReceiptRecord): string[] {
  return [
    record.seq.toString(),
    record.intentIdHex,
    new Date(Number(record.timestamp) * 1000).toISOString(),
    record.slot.toString(),
    String(record.mint),
    String(record.destinationOwner),
    record.amount.toString(),
    String(record.receipt),
    record.memoHash,
  ];
}

function jsonOf(record: ReceiptRecord) {
  return {
    seq: record.seq.toString(),
    intent_id: record.intentIdHex,
    timestamp: new Date(Number(record.timestamp) * 1000).toISOString(),
    slot: record.slot.toString(),
    mint: String(record.mint),
    destination_owner: String(record.destinationOwner),
    // A decimal string, not a number: a u64 above 2^53 does not survive `JSON.parse`, and
    // an export that silently rounds an amount is worse than no export.
    amount: record.amount.toString(),
    receipt: String(record.receipt),
    memo_hash: record.memoHash,
  };
}

export async function runAuditExport(options: AuditExportOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);

  const session: Address = options.session
    ? parseAddress(options.session, "--session")
    : ctx.manifest?.session
      ? address(ctx.manifest.session)
      : (() => {
          throw new CliError("No session recorded for this cluster", {
            hint: "Pass --session <pda>, or run `agent-rails init` first.",
          });
        })();

  const account = await fetchMaybeAgentSession(ctx.rpc, session, { commitment: "confirmed" });
  if (!account.exists) throw new CliError(`No session account at ${session}`);

  const receipts = await loadReceipts({
    rpc: ctx.rpc as Parameters<typeof loadReceipts>[0]["rpc"],
    session,
  });

  const expectedHead = Uint8Array.from(account.data.auditHead);
  const verification = options.verify
    ? verifyAuditChain({
        session,
        links: receipts,
        expectedHead,
      })
    : undefined;

  // `seq` counts every payment the session ever made; receipts only survive until someone
  // reclaims their rent. The difference is the part of the history that is gone, and it is
  // the honest explanation for a chain that will not replay.
  const reclaimed = Number(account.data.seq) - receipts.length;

  if (options.json || options.format !== "csv") {
    const payload = {
      session: String(session),
      label: undefined as string | undefined,
      seq: account.data.seq.toString(),
      audit_head: auditHeadToHex(expectedHead),
      receipts_found: receipts.length,
      receipts_reclaimed: reclaimed,
      ...(verification ? { verification } : {}),
      payments: receipts.map(jsonOf),
    };
    if (options.format === "jsonl") {
      for (const record of receipts) process.stdout.write(`${JSON.stringify(jsonOf(record))}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
      );
    }
  } else {
    process.stdout.write(`${csvRow(CSV_COLUMNS)}\n`);
    for (const record of receipts) process.stdout.write(`${csvRow(rowOf(record))}\n`);
  }

  // Human output on stderr, so `--format csv > payments.csv` stays a clean pipe.
  ui.heading("Audit chain");
  ui.field("Session", String(session));
  ui.field("Payments on chain", account.data.seq.toString());
  ui.field("Receipts still present", String(receipts.length));
  if (reclaimed > 0) {
    ui.info(
      ui.dim(`${reclaimed} receipt(s) were closed for rent; those links cannot be replayed.`),
    );
  }
  ui.field("Audit head", auditHeadToHex(expectedHead));

  if (!verification) return 0;
  if (verification.ok) {
    ui.succeed(`Chain verified: ${verification.links} payment(s) replay to the on-chain head`);
    return 0;
  }
  if (reclaimed > 0 && verification.reason === "head-mismatch") {
    ui.info(
      ui.dim(
        "The head does not match, and reclaimed receipts alone explain that — " +
          "a replay needs every link from the first payment.",
      ),
    );
    return 0;
  }
  ui.fail(
    verification.reason === "sequence-gap"
      ? `Chain broken at seq ${verification.brokenAt}`
      : `Chain does not replay to the on-chain head (computed ${verification.head})`,
  );
  return 1;
}
