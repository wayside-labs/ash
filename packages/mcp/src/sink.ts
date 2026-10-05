import { appendFile } from "node:fs/promises";
import type { PaymentRecord } from "@ash/contract";

/**
 * The operator's record of every payment attempt (ARCHITECTURE section 8).
 *
 * This is where the detail the agent-facing response deliberately omits goes: simulation
 * logs, raw error text, the resolved destination. Those are useful to a human and are an
 * injection carrier on the way back into a model context (blueprint I-5), so they travel
 * out of band.
 *
 * Non-blocking by design. A telemetry outage must not stop payments; that would hand anyone
 * who can reach the disk a denial-of-service. This is the opposite of the provenance ledger
 * in the blueprint, which gates payments precisely because a payment nobody can explain is
 * worse than one that did not happen — that ledger belongs to the mediation service, not to
 * this file.
 */

export type PaymentSink = {
  record(entry: PaymentRecord): void;
  /** Entries dropped because the sink could not be written. Surface this in monitoring. */
  readonly dropped: number;
};

export function createPaymentSink(path: string | undefined): PaymentSink {
  let dropped = 0;
  let queue: Promise<void> = Promise.resolve();

  return {
    get dropped() {
      return dropped;
    },
    record(entry: PaymentRecord) {
      if (!path) return;
      // Serialized through one promise chain so concurrent writes cannot interleave a line.
      queue = queue.then(async () => {
        try {
          await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
        } catch {
          dropped += 1;
        }
      });
    },
  };
}
