import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { address, getAddressDecoder, isAddress, signature } from "@solana/kit";
import type {
  DepositIntentView,
  RailsConfig,
  WithdrawalDestinationKind,
  WithdrawalRequestView,
} from "@/lib/billing";
import { rpcFor } from "@/lib/server/solana";
import { storePath } from "@/lib/server/store-json";
import {
  type ParsedTransaction,
  type PayCluster,
  receivedBaseUnits,
  transferRequestUrl,
  USDC_MINTS,
} from "@/lib/solana-pay";
import { createAdminClient } from "@/lib/supabase/admin";
import { type BillingScope, ledgerFor } from "./ledger";

/**
 * Deposit and withdrawal rails for the assistant credit. The ledger (`ledger.ts`) stays the one
 * place money is counted; this file only decides *when* a `deposit` or `withdrawal` row may be
 * appended, and remembers the intents and requests that led to one.
 */

// ---------------------------------------------------------------------------------------------
// Config

export type SolanaPayConfig = {
  recipient: string;
  cluster: PayCluster;
  mint: string;
  rpcUrl: string | null;
};

/**
 * `SOLANA_PAY_RECIPIENT` is the operator's own wallet (its USDC account receives deposits).
 * Unset means the rail is off: the modal says so rather than showing a QR that pays no one.
 * `SOLANA_PAY_CLUSTER` defaults to mainnet, where USDC is real money; devnet is for trying it.
 */
export function solanaPayConfig(): SolanaPayConfig | null {
  const recipient = process.env.SOLANA_PAY_RECIPIENT?.trim();
  if (!recipient) return null;
  if (!isAddress(recipient)) {
    console.error("SOLANA_PAY_RECIPIENT is not a Solana address; the deposit rail is off");
    return null;
  }
  const cluster: PayCluster =
    process.env.SOLANA_PAY_CLUSTER?.trim() === "devnet" ? "devnet" : "mainnet-beta";
  return {
    recipient,
    cluster,
    mint: USDC_MINTS[cluster],
    rpcUrl: process.env.SOLANA_PAY_RPC_URL?.trim() || null,
  };
}

export function railsConfig(): RailsConfig {
  const pay = solanaPayConfig();
  return {
    solanaPay: { enabled: pay !== null, cluster: pay?.cluster ?? "mainnet-beta" },
    pix: { enabled: false },
  };
}

// ---------------------------------------------------------------------------------------------
// Storage

type IntentRecord = Omit<DepositIntentView, "url"> & {
  mint: string;
  createdAt: string;
};

type WithdrawalRecord = WithdrawalRequestView & { holdIdempotencyKey: string };

interface RailsStore {
  insertIntent(scope: BillingScope, intent: IntentRecord): Promise<void>;
  getIntent(scope: BillingScope, id: string): Promise<IntentRecord | null>;
  /** False when the signature already confirmed an intent (this one or another). */
  confirmIntent(scope: BillingScope, id: string, sig: string, credited: number): Promise<boolean>;
  insertWithdrawal(scope: BillingScope, request: WithdrawalRecord): Promise<void>;
  listWithdrawals(scope: BillingScope, limit: number): Promise<WithdrawalRequestView[]>;
}

function requireOrg(scope: BillingScope) {
  if (scope.kind !== "org") throw new Error("the Postgres rails store needs an org scope");
  return scope;
}

type IntentRow = {
  id: string;
  rail: "solana_pay_usdc";
  cluster: PayCluster;
  reference: string;
  recipient: string;
  mint: string;
  amount_micros: number | string;
  status: "pending" | "confirmed";
  signature: string | null;
  credited_micros: number | string | null;
  created_at: string;
};

function intentFromRow(row: IntentRow): IntentRecord {
  return {
    id: row.id,
    rail: row.rail,
    cluster: row.cluster,
    reference: row.reference,
    recipient: row.recipient,
    mint: row.mint,
    amountMicros: Number(row.amount_micros),
    status: row.status,
    createdAt: row.created_at,
    ...(row.signature ? { signature: row.signature } : {}),
    ...(row.credited_micros !== null ? { creditedMicros: Number(row.credited_micros) } : {}),
  };
}

const postgresRails: RailsStore = {
  async insertIntent(scope, intent) {
    const { orgId, accountId } = requireOrg(scope);
    const { error } = await createAdminClient().from("credit_deposit_intents").insert({
      id: intent.id,
      org_id: orgId,
      account_id: accountId,
      rail: intent.rail,
      cluster: intent.cluster,
      reference: intent.reference,
      recipient: intent.recipient,
      mint: intent.mint,
      amount_micros: intent.amountMicros,
    });
    if (error) throw error;
  },

  async getIntent(scope, id) {
    const { orgId } = requireOrg(scope);
    const { data, error } = await createAdminClient()
      .from("credit_deposit_intents")
      .select(
        "id, rail, cluster, reference, recipient, mint, amount_micros, status, signature, credited_micros, created_at",
      )
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? intentFromRow(data as IntentRow) : null;
  },

  async confirmIntent(scope, id, sig, credited) {
    const { orgId } = requireOrg(scope);
    const { error } = await createAdminClient()
      .from("credit_deposit_intents")
      .update({
        status: "confirmed",
        signature: sig,
        credited_micros: credited,
        confirmed_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("status", "pending");
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  },

  async insertWithdrawal(scope, request) {
    const { orgId, accountId } = requireOrg(scope);
    const { error } = await createAdminClient().from("credit_withdrawal_requests").insert({
      id: request.id,
      org_id: orgId,
      account_id: accountId,
      amount_micros: request.amountMicros,
      destination_kind: request.destinationKind,
      destination: request.destination,
      hold_idempotency_key: request.holdIdempotencyKey,
    });
    if (error) throw error;
  },

  async listWithdrawals(scope, limit) {
    const { orgId } = requireOrg(scope);
    const { data, error } = await createAdminClient()
      .from("credit_withdrawal_requests")
      .select("id, amount_micros, destination_kind, destination, status, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (
      data as {
        id: string;
        amount_micros: number | string;
        destination_kind: WithdrawalDestinationKind;
        destination: string;
        status: WithdrawalRequestView["status"];
        created_at: string;
      }[]
    ).map((row) => ({
      id: row.id,
      amountMicros: Number(row.amount_micros),
      destinationKind: row.destination_kind,
      destination: row.destination,
      status: row.status,
      createdAt: row.created_at,
    }));
  },
};

type JsonRails = { intents: IntentRecord[]; withdrawals: WithdrawalRecord[] };

function railsPath(): string {
  return join(dirname(storePath()), "billing-rails.json");
}

async function readRails(): Promise<JsonRails> {
  try {
    return JSON.parse(await readFile(railsPath(), "utf8")) as JsonRails;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { intents: [], withdrawals: [] };
    throw error;
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

function mutateRails<T>(fn: (rails: JsonRails) => T): Promise<T> {
  const run = async () => {
    const rails = await readRails();
    const result = fn(rails);
    const path = railsPath();
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rails, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
    return result;
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

/** Local development only, mirroring `jsonLedger`: one server, no tenants. */
const jsonRails: RailsStore = {
  async insertIntent(_scope, intent) {
    await mutateRails((rails) => {
      rails.intents.push(intent);
    });
  },
  async getIntent(_scope, id) {
    return (await readRails()).intents.find((i) => i.id === id) ?? null;
  },
  async confirmIntent(_scope, id, sig, credited) {
    return mutateRails((rails) => {
      if (rails.intents.some((i) => i.signature === sig)) return false;
      const intent = rails.intents.find((i) => i.id === id && i.status === "pending");
      if (!intent) return false;
      Object.assign(intent, { status: "confirmed", signature: sig, creditedMicros: credited });
      return true;
    });
  },
  async insertWithdrawal(_scope, request) {
    await mutateRails((rails) => {
      rails.withdrawals.push(request);
    });
  },
  async listWithdrawals(_scope, limit) {
    return (await readRails()).withdrawals
      .slice(-limit)
      .reverse()
      .map(({ holdIdempotencyKey: _, ...view }) => view);
  },
};

function railsFor(scope: BillingScope): RailsStore {
  return scope.kind === "org" ? postgresRails : jsonRails;
}

// ---------------------------------------------------------------------------------------------
// Deposits

function toView(intent: IntentRecord): DepositIntentView {
  const { mint, createdAt: _, ...rest } = intent;
  return {
    ...rest,
    url: transferRequestUrl({
      recipient: intent.recipient,
      amountMicros: intent.amountMicros,
      mint,
      reference: intent.reference,
      label: "Agent Rails",
      message: "Assistant credit",
    }),
  };
}

/** A fresh keypair's public half would do; 32 random bytes are the same thing without the key. */
function newReference(): string {
  return getAddressDecoder().decode(randomBytes(32));
}

export async function createDepositIntent(
  scope: BillingScope,
  config: SolanaPayConfig,
  amountMicros: number,
): Promise<DepositIntentView> {
  const intent: IntentRecord = {
    id: randomUUID(),
    rail: "solana_pay_usdc",
    cluster: config.cluster,
    reference: newReference(),
    recipient: config.recipient,
    mint: config.mint,
    amountMicros,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await railsFor(scope).insertIntent(scope, intent);
  return toView(intent);
}

/**
 * Looks for the transfer and credits it once. Finalized only: a deposit is money, and a
 * confirmed-but-dropped fork would be credit nobody paid for.
 *
 * Whatever reached the recipient is credited, even short of the amount asked: a wallet that
 * rounded or a payer who edited the amount still paid that much. The signature is the ledger's
 * idempotency key, so a replay, a second poll or a second tab cannot credit it twice.
 */
export async function checkDepositIntent(
  scope: BillingScope,
  config: SolanaPayConfig,
  id: string,
): Promise<DepositIntentView | null> {
  const store = railsFor(scope);
  const intent = await store.getIntent(scope, id);
  if (!intent) return null;
  if (intent.status === "confirmed") return toView(intent);

  const rpc = rpcFor(intent.cluster, config.rpcUrl);
  const found = await rpc
    .getSignaturesForAddress(address(intent.reference), { limit: 20, commitment: "finalized" })
    .send();

  for (const entry of found) {
    if (entry.err) continue;
    const tx = await rpc
      .getTransaction(signature(entry.signature), {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      })
      .send();
    if (!tx) continue;
    const received = receivedBaseUnits(
      tx as unknown as ParsedTransaction,
      intent.recipient,
      intent.mint,
    );
    if (received === 0n) continue;
    if (received > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("deposit out of range");
    const credited = Number(received);

    await ledgerFor(scope).append(scope, {
      kind: "deposit",
      amountMicros: credited,
      idempotencyKey: `solana-pay:${entry.signature}`,
      note: `Solana Pay USDC ${entry.signature}`,
    });
    await store.confirmIntent(scope, intent.id, entry.signature, credited);
    return toView({
      ...intent,
      status: "confirmed",
      signature: entry.signature,
      creditedMicros: credited,
    });
  }
  return toView(intent);
}

// ---------------------------------------------------------------------------------------------
// Withdrawals

export const MIN_WITHDRAWAL_MICROS = 1_000_000;

export function validDestination(kind: WithdrawalDestinationKind, raw: string): string | null {
  const value = raw.trim();
  if (kind === "solana_usdc") return isAddress(value) ? value : null;
  return value.length >= 1 && value.length <= 140 ? value : null;
}

// One request per scope at a time, so two tabs cannot both pass the balance check.
const inFlight = new Set<string>();

export type WithdrawalResult =
  | { ok: true; request: WithdrawalRequestView }
  | { ok: false; reason: "busy" | "insufficient" };

/**
 * Holds the amount with a `withdrawal` ledger row first, then records the request. A hold with
 * no request would be credit gone missing, so a failed insert refunds the hold.
 */
export async function requestWithdrawal(
  scope: BillingScope,
  balanceMicros: number,
  amountMicros: number,
  destinationKind: WithdrawalDestinationKind,
  destination: string,
): Promise<WithdrawalResult> {
  const key = scope.kind === "org" ? scope.orgId : "local";
  if (inFlight.has(key)) return { ok: false, reason: "busy" };
  inFlight.add(key);
  try {
    if (amountMicros > balanceMicros) return { ok: false, reason: "insufficient" };
    const id = randomUUID();
    const holdIdempotencyKey = `withdrawal:${id}`;
    const ledger = ledgerFor(scope);
    await ledger.append(scope, {
      kind: "withdrawal",
      amountMicros: -amountMicros,
      idempotencyKey: holdIdempotencyKey,
      note: `Withdrawal request ${id}`,
    });
    const request: WithdrawalRequestView = {
      id,
      amountMicros,
      destinationKind,
      destination,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    try {
      await railsFor(scope).insertWithdrawal(scope, { ...request, holdIdempotencyKey });
    } catch (error) {
      await ledger.append(scope, {
        kind: "adjustment",
        amountMicros,
        idempotencyKey: `withdrawal-refund:${id}`,
        note: `Refund: withdrawal request ${id} could not be recorded`,
      });
      throw error;
    }
    return { ok: true, request };
  } finally {
    inFlight.delete(key);
  }
}

export function listWithdrawals(scope: BillingScope, limit = 20) {
  return railsFor(scope).listWithdrawals(scope, limit);
}
