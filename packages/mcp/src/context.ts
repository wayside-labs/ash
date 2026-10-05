import type { ResolvedSecurity } from "@ash/sdk";
import type { BoundContext } from "./bound-context.js";
import type { McpRuntime } from "./config.js";
import type { DryRunLedger } from "./dry-runs.js";
import type { PaymentGovernor } from "./governor.js";
import type { SessionSigners } from "./session.js";
import type { PaymentSink } from "./sink.js";

/** Everything a handler is allowed to reach. Assembled once at startup. */
export type ServerContext = {
  runtime: McpRuntime;
  signers: SessionSigners;
  bound: BoundContext;
  governor: PaymentGovernor;
  sink: PaymentSink;
  /** The off-chain guard-rail posture, resolved from a preset plus overrides. */
  security: ResolvedSecurity;
  /** Which intents have been dry-run, for the `dry-run-first` requirement. */
  dryRuns: DryRunLedger;
};
