import { describe, expect, it } from "vitest";
import { AGENT_RAILS_PROGRAM_ADDRESS, AgentRailsInstruction } from "./index.js";

const EXPECTED_INSTRUCTIONS = [
  "AddAllowlistEntry",
  "AddGuardian",
  "AddMint",
  "ClosePolicy",
  "CloseReceipt",
  "CloseSession",
  "CloseTreasury",
  "CreatePolicy",
  "CreateSession",
  "CreateTreasury",
  "EnableNativeAllowance",
  "ExecutePayment",
  "ExecutePaymentSol",
  "Pause",
  "RemoveAllowlistEntry",
  "RemoveGuardian",
  "RemoveMint",
  "RevokeSession",
  "SetCeiling",
  "SetRoles",
  "Unpause",
  "UpdatePolicy",
  "Withdraw",
] as const;

describe("@agent-rails/client", () => {
  it("exports the program address constant", () => {
    expect(AGENT_RAILS_PROGRAM_ADDRESS).toBe("4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS");
  });

  it("exports exactly the instruction discriminators the IDL declares", () => {
    const instructionNames = Object.values(AgentRailsInstruction).filter(
      (value) => typeof value === "string",
    );
    expect(instructionNames).toHaveLength(EXPECTED_INSTRUCTIONS.length);
    expect(instructionNames.sort()).toEqual([...EXPECTED_INSTRUCTIONS].sort());
  });
});
