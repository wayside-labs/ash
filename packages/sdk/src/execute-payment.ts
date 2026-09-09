import type {
  Commitment,
  GetBlockHeightApi,
  GetSignatureStatusesApi,
  Rpc,
  SendTransactionApi,
  SolanaRpcApi,
  TransactionMessage,
} from "@solana/kit";
import { simulatePayment, type SimulatePaymentResult } from "./simulate.js";
import { sendPayment, type SendPaymentResult } from "./send-payment.js";

export type ExecutePaymentRpc = Rpc<
  SolanaRpcApi & SendTransactionApi & GetSignatureStatusesApi & GetBlockHeightApi
>;

export type ExecutePaymentInput = {
  rpc: ExecutePaymentRpc;
  transactionMessage: TransactionMessage;
  lastValidBlockHeight: bigint;
  commitment?: Commitment;
  confirmTimeoutMs?: number;
};

export type ExecutePaymentResult = SendPaymentResult & {
  simulation: SimulatePaymentResult;
};

/** Simulate, then sign, send, and confirm a payment transaction. */
export async function executePayment(input: ExecutePaymentInput): Promise<ExecutePaymentResult> {
  const simulation = await simulatePayment({
    rpc: input.rpc,
    transactionMessage: input.transactionMessage,
    commitment: input.commitment,
  });

  const sendResult = await sendPayment({
    rpc: input.rpc,
    transactionMessage: input.transactionMessage,
    lastValidBlockHeight: input.lastValidBlockHeight,
    commitment: input.commitment,
    confirmTimeoutMs: input.confirmTimeoutMs,
    skipPreflight: true,
  });

  return {
    ...sendResult,
    simulation,
  };
}
