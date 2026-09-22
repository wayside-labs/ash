/**
 * Only the two branches that must never reach the chain are covered here. The sending path
 * needs a validator and belongs to the litesvm/e2e layers — what matters at this layer is
 * that `--dry-run` and a declined prompt both return without signing, because a CLI that
 * signs on a dry run is worse than one that never had the flag.
 */
import type { Instruction, TransactionSigner } from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ui } from "../ui.js";
import { sendPlan } from "./send.js";

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock("../confirm.js", () => ({ confirm: confirmMock }));

const sendTransactionMock = vi.hoisted(() => vi.fn());
vi.mock("../rpc.js", () => ({ sendTransaction: sendTransactionMock }));

function fakeUi() {
  return {
    info: vi.fn(),
    dim: vi.fn((text: string) => text),
    fail: vi.fn(),
    blank: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
  };
}

const plan = { label: "Set policy", instructions: [{} as Instruction, {} as Instruction] };
const feePayer = { address: "11111111111111111111111111111111" } as unknown as TransactionSigner;

beforeEach(() => {
  confirmMock.mockReset();
  sendTransactionMock.mockReset();
});

describe("sendPlan", () => {
  it("signs nothing on a dry run and never prompts", async () => {
    const ui = fakeUi();
    const result = await sendPlan({
      rpc: undefined as never,
      feePayer,
      plan,
      ui: ui as unknown as Ui,
      yes: false,
      json: false,
      dryRun: true,
    });

    expect(result).toEqual({ sent: false });
    expect(sendTransactionMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    // The instruction count is in the line: it is the only thing distinguishing a plan
    // that would do the expected work from one that quietly resolved to nothing.
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("(2 ix)"));
  });

  it("aborts without sending when the prompt is declined", async () => {
    confirmMock.mockResolvedValue(false);
    const ui = fakeUi();
    const result = await sendPlan({
      rpc: undefined as never,
      feePayer,
      plan,
      ui: ui as unknown as Ui,
      yes: false,
      json: false,
      dryRun: false,
    });

    expect(result).toEqual({ sent: false });
    expect(sendTransactionMock).not.toHaveBeenCalled();
    expect(ui.fail).toHaveBeenCalledWith("Aborted");
  });

  it("uses the supplied confirmation message over the default", async () => {
    confirmMock.mockResolvedValue(false);
    const ui = fakeUi();
    await sendPlan({
      rpc: undefined as never,
      feePayer,
      plan,
      ui: ui as unknown as Ui,
      yes: false,
      json: false,
      dryRun: false,
      confirmMessage: "Withdraw 1 SOL to the owner?",
    });
    expect(confirmMock).toHaveBeenCalledWith("Withdraw 1 SOL to the owner?");
  });

  it("falls back to a prompt naming the plan", async () => {
    confirmMock.mockResolvedValue(false);
    await sendPlan({
      rpc: undefined as never,
      feePayer,
      plan,
      ui: fakeUi() as unknown as Ui,
      yes: false,
      json: false,
      dryRun: false,
    });
    expect(confirmMock).toHaveBeenCalledWith('Send "Set policy"?');
  });

  // `--json` keeps stdout a clean pipe, so there is nobody to answer a prompt; `--yes` is
  // the explicit opt-out. Either one must skip the prompt rather than block a script.
  it.each([
    ["--yes", { yes: true, json: false }],
    ["--json", { yes: false, json: true }],
  ])("skips the prompt under %s", async (_label, flags) => {
    sendTransactionMock.mockResolvedValue("sig");
    const ui = fakeUi();
    const result = await sendPlan({
      rpc: undefined as never,
      feePayer,
      plan,
      ui: ui as unknown as Ui,
      dryRun: false,
      ...flags,
    });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(sendTransactionMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ signature: "sig", sent: true });
    expect(ui.succeed).toHaveBeenCalledWith("Set policy", "sig");
  });

  // A dry run outranks --yes: the flag that says "do not ask" must not become "do it".
  it("stays a dry run even with --yes", async () => {
    const result = await sendPlan({
      rpc: undefined as never,
      feePayer,
      plan,
      ui: fakeUi() as unknown as Ui,
      yes: true,
      json: false,
      dryRun: true,
    });
    expect(result).toEqual({ sent: false });
    expect(sendTransactionMock).not.toHaveBeenCalled();
  });
});
