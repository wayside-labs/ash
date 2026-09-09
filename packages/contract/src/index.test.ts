import { describe, expect, it } from "vitest";
import { AGENT_RAILS_PROGRAM_ID, NATIVE_MINT, REASON_CODES } from "./index.js";

describe("@agent-rails/contract", () => {
  it("exports program id and native mint", () => {
    expect(AGENT_RAILS_PROGRAM_ID).toBe("4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS");
    expect(NATIVE_MINT).toBe("So11111111111111111111111111111111111111112");
  });

  it("maps anchor error 6000 to TREASURY_PAUSED", () => {
    expect(REASON_CODES[6000]).toBe("TREASURY_PAUSED");
    expect(REASON_CODES[6041]).toBe("RESERVED_FIELD_NON_ZERO");
  });
});
