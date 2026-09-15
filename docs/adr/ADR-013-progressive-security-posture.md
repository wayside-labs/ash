# ADR-013: Progressive security posture with a fixed set of configurable guard-rails

**Status:** Accepted

## Context

The client established in ADR-012 refuses by default at every layer: registered labels only, hooks fail closed, an unresolved outcome stops the session, program logs never reach the caller. That is the right posture for a treasury and a poor one for a first five minutes — a developer pointing an agent at a devnet policy meets a series of denials whose reasons are all correct and none of which they asked for. The alternative people reach for is not a slightly looser Agent Rails; it is no guardrail at all.

So the framework needs a spectrum. The hazard is that configurable security is where this class of library usually goes wrong: the knob that reads as "relax a little" turns out to be the one holding the guarantee, and it is relaxed by someone who could not have known. A boolean called `strictMode` tells a caller nothing about what it costs to turn off.

The question is therefore not whether to make the posture configurable. It is **which properties may be configurable at all**, and on what test.

## Options considered

- A. Keep the single maximum-strictness posture. No new failure modes, and the adoption cost is real: the observable outcome is people forking the client or skipping it.
- B. Free-form configuration — every guard exposed as a flag. Maximum flexibility and no way to distinguish a safe relaxation from a dangerous one at the call site.
- C. Presets with no overrides. Legible, but nobody's review threshold is exactly the one we picked, so in practice it degrades to option A with extra steps.
- **D. Presets plus field-level overrides, over a fixed set of knobs admitted by a stated test, with everything else unreachable.**
- E. Put the posture on-chain. The right place for a spend threshold that must survive a compromised client — `MintLimit.approval_threshold` is already reserved for exactly that (ADR-005) — and the wrong place for hook behaviour, disclosure and polling, which would make every prototyping change a transaction.

## Decision

Option D, governed by an explicit admission test.

1. **The test.** A property may be configurable only if relaxing it leaves the mistake it prevents caught by something that does not depend on this client. In practice that means the program, which re-checks pause, session liveness, mint configuration, the ceiling, the destination allowlist, every limit, and the receipt on every payment.

2. **Six properties fail the test and are unreachable from any preset**, recorded in `IMMUTABLE_GUARANTEES`: derived `intent_id`s, strict tool arguments, startup binding of treasury/policy/session, integer amount conversion, server-authored `expires_at`, and never reporting an unknown outcome as a denial. Each has no backstop — a client that gets it wrong produces a result the program cannot distinguish from a correct one.

3. **The knobs, and what catches each if it is relaxed:**

   | Knob | Relaxing it means | What still catches the mistake |
   |---|---|---|
   | `destinations.policy` | Raw addresses reach the chain instead of being refused here | The program refuses an unregistered payee under an `Allowlist` policy |
   | `destinations.nearMissDistance` | A near miss reports as a plain miss | Nothing — but an exact miss is already a denial, so this only changes the reason code |
   | `value.bands` | No memo, dry run or review above a threshold | `per_tx_max` and the window and lifetime limits |
   | `hooks.onUnavailable` | A hook timeout permits the payment | Hooks are additive restrictions; losing one falls back to the on-chain limits |
   | `velocity.*` | More payments, more concurrency | The program evaluates each payment against committed counters, so a burst cannot exceed a window |
   | `outcomes.quiesceOnIndeterminate` | The session keeps paying after an unresolved outcome | The derived `intent_id`: a retry addresses the same receipt and is refused on-chain |
   | `disclosure.includeSimulationLogs` | Program logs return to the caller | Nothing (see Consequences) |

4. **`quiesceOnIndeterminate` is the worked example.** It looks like the most dangerous knob in the set and is one of the safest, for a reason that is entirely about ADR-012: because the id is derived, a retry of the same payment cannot become a second payment. Turning the quiesce off trades a stopped session for a wasted transaction, not for a duplicate disbursement. That is what the admission test is for — it separates guards that are load-bearing from guards that are belt to someone else's braces.

5. **Three presets.** `sandbox` for prototyping, `balanced` as the default, `strict` for treasury operations. `balanced` is the default because a default is what most deployments will run, so it has to be the posture that is right without thought.

6. **Split by serializability.** The declarative posture lives in `@agent-rails/contract` — loggable, snapshot-testable, and validated by the same Zod schema that documents it. Hooks and resolution live in `@agent-rails/sdk`, because a function cannot be serialized and should not pretend to be configuration. A posture is parsed at construction, so a typo is a startup failure rather than a guard silently left at its default.

7. **Incoherence is a warning, never an error.** A posture that relaxes something the chain refuses anyway is confusing rather than dangerous, and confusion is what makes people disable things. The server prints those warnings once at startup instead of letting a developer infer them one denial at a time. A client that refused to start because it was stricter than necessary would help nobody.

8. **The environment carries a preset and two dials**; anything richer is a config object, because value bands and hooks do not survive being flattened into strings.

9. **The posture is published** through `get_policy`. The limits are on-chain and discoverable; "above 500 a person approves it" is not, and an agent that can read the rule wastes fewer attempts against it.

## Consequences

- A relaxed preset cannot by itself become an incident. The worst a `sandbox` posture does is move refusals to the validator and stop explaining them early.
- The admission test is a real constraint on future work: "make X configurable" now requires naming what catches X when it is off. A knob that cannot answer belongs in `IMMUTABLE_GUARANTEES`.
- `disclosure.includeSimulationLogs` is the one knob with no backstop, and it is here on adoption grounds rather than security ones: a developer denied it will print the logs themselves, less carefully. It is off in two of three presets, warned about at startup, and documented as local development only.
- Preset *contents* are a compatibility surface. Changing what `balanced` means changes behaviour for every deployment that did not pin fields, so preset changes are semver-relevant in the same way the tool schemas are.
- `human-review` is a workflow control, not a security boundary: it runs in the mediation plane, so a compromised host skips it. The on-chain version is `MintLimit.approval_threshold`, reserved in ADR-005 and landing in v1.1, and it supersedes this requirement when it does.
- Value bands compare in base units against the mint's own `decimals`, so a band means the same thing across mints. A band comparing raw integers would fire at a hundredth of the intended amount on a 9-decimal mint.
- No new tools, so ADR-007's non-escalating surface is unchanged: the posture is chosen by whoever starts the server, never by the agent talking to it.
- The program is untouched. This does not supersede ADR-005; it gives that ADR's soft policies a declared shape and a default.
