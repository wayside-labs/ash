import { afterEach, describe, expect, it } from "vitest";
import { acquireSlot, checkFixedWindow, resetLimits } from "./rate-limit";

afterEach(resetLimits);

describe("checkFixedWindow", () => {
  it("allows up to the limit and then answers 429 with a retry-after", () => {
    expect(checkFixedWindow("k", 2)).toBeNull();
    expect(checkFixedWindow("k", 2)).toBeNull();
    const denied = checkFixedWindow("k", 2);
    expect(denied?.status).toBe(429);
    expect(denied?.headers.get("retry-after")).toBeTruthy();
  });

  it("opens a new window once the old one has elapsed", async () => {
    expect(checkFixedWindow("k", 1, 1)).toBeNull();
    expect(checkFixedWindow("k", 1, 1)?.status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 3));
    expect(checkFixedWindow("k", 1, 1)).toBeNull();
  });

  it("counts each key separately", () => {
    expect(checkFixedWindow("a", 1)).toBeNull();
    expect(checkFixedWindow("b", 1)).toBeNull();
  });
});

describe("acquireSlot", () => {
  it("refuses the second holder and admits it again after release", () => {
    const first = acquireSlot("chat");
    expect(first).not.toBeInstanceOf(Response);
    expect(acquireSlot("chat")).toBeInstanceOf(Response);

    (first as { release: () => void }).release();
    expect(acquireSlot("chat")).not.toBeInstanceOf(Response);
  });

  it("ignores a double release, so a stream that settles twice cannot free a slot it lost", () => {
    const slot = acquireSlot("chat") as { release: () => void };
    slot.release();
    slot.release();
    expect(acquireSlot("chat")).not.toBeInstanceOf(Response);
    expect(acquireSlot("chat")).toBeInstanceOf(Response);
  });
});
