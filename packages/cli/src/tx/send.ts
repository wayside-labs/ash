import type { Instruction, TransactionSigner } from "@solana/kit";
import { confirm } from "../confirm.js";
import type { Rpc } from "../rpc.js";
import { sendTransaction } from "../rpc.js";
import type { Ui } from "../ui.js";

export type SendPlan = {
  label: string;
  instructions: Instruction[];
};

export async function sendPlan(input: {
  rpc: Rpc;
  feePayer: TransactionSigner;
  plan: SendPlan;
  ui: Ui;
  yes: boolean;
  json: boolean;
  dryRun: boolean;
  confirmMessage?: string;
}): Promise<{ signature?: string; sent: boolean }> {
  if (input.dryRun) {
    input.ui.info(
      input.ui.dim(
        `Dry run: would send "${input.plan.label}" (${input.plan.instructions.length} ix).`,
      ),
    );
    return { sent: false };
  }

  if (!input.yes && !input.json) {
    const confirmed = await confirm(input.confirmMessage ?? `Send "${input.plan.label}"?`);
    if (!confirmed) {
      input.ui.fail("Aborted");
      return { sent: false };
    }
    input.ui.blank();
  }

  input.ui.start(input.plan.label);
  const signature = await sendTransaction(input.rpc, input.feePayer, input.plan.instructions, {
    label: input.plan.label,
  });
  input.ui.succeed(input.plan.label, signature);
  return { signature, sent: true };
}
