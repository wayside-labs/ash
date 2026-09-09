import { describe, expect, it } from "vitest";
import { AGENT_RAILS_PROGRAM_ADDRESS } from "./index.js";

describe("@agent-rails/client", () => {
  it("exports the program address constant", () => {
    expect(AGENT_RAILS_PROGRAM_ADDRESS).toBe("4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS");
  });
});
