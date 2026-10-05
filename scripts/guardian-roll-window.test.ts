import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rollWindow } from "./guardian-roll-window.ts";

/** Same cases as `roll_window` / `rollover` in `ash-policy` (engine.rs, proofs.rs). */
describe("rollWindow", () => {
  it("leaves spend unchanged while now is inside the bucket", () => {
    const start = 1_000n;
    const spent = 500n;
    const window = 3_600;
    const now = 1_500n;
    assert.deepEqual(rollWindow(start, spent, window, now), [start, spent]);
  });

  it("zeros spend and advances bucket start when now is past the window end", () => {
    const start = 1_000n;
    const spent = 2_500_000_000n;
    const window = 3_600;
    const now = 5_000n;
    const [newStart, newSpent] = rollWindow(start, spent, window, now);
    assert.equal(newSpent, 0n);
    // now - ((now - start) % window) === 4600 for these inputs
    assert.equal(newStart, 4_600n);
    assert.ok(newStart <= now);
    assert.ok(now < newStart + BigInt(window));
  });

  it("is idempotent within the same bucket after rollover", () => {
    const limit = { window: 3_600, start: 1_000n, spent: 999n };
    const now = 8_000n;
    const once = rollWindow(limit.start, limit.spent, limit.window, now);
    const twice = rollWindow(once[0], once[1], limit.window, now);
    assert.deepEqual(twice, once);
  });

  it("returns unchanged counters when window_seconds is zero", () => {
    assert.deepEqual(rollWindow(100n, 50n, 0, 200n), [100n, 50n]);
  });

  it("refuses to roll when start + window overflows i64 (corrupted start)", () => {
    const i64Max = (1n << 63n) - 1n;
    const start = i64Max - 100n;
    const spent = 1n;
    const window = 3_600;
    const now = i64Max;
    assert.deepEqual(rollWindow(start, spent, window, now), [start, spent]);
  });
});
