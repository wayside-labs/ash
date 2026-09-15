import type { PolicyHook } from "@agent-rails/sdk";
import type { BoundContext } from "./bound-context.js";
import type { McpRuntime } from "./config.js";
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
  /** Soft policy hooks, run before signing (ADR-005 section 6). */
  hooks?: PolicyHook[];
};
