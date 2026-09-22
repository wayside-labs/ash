import { afterEach, describe, expect, it, vi } from "vitest";
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

  // Fake timers rather than a real sleep: the window is read off Date.now(), so a
  // millisecond-wide window races the two calls that are meant to share it.
  it("opens a new window once the old one has elapsed", () => {
    vi.useFakeTimers();
    try {
      expect(checkFixedWindow("k", 1, 1000)).toBeNull();
      expect(checkFixedWindow("k", 1, 1000)?.status).toBe(429);
      vi.advanceTimersByTime(1001);
      expect(checkFixedWindow("k", 1, 1000)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
