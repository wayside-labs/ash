# Privacy text — Privacy Sprint (Cloak + Zcash), English

A faithful translation of [`PRIVACY.md`](PRIVACY.md), which is the text that was written and
counted first. The meaning is the same sentence for sentence, including the claims that file
makes. Decimal commas became points; nothing was added or dropped.

## Text

<!-- text:start -->
**What stays hidden.** Today, when an AI agent pays suppliers or contributors with company money, every payment becomes public on Solana: who received it, how much and when. With Agent Rails' *Private payout desk* template, the operator asks in the chat: "pay 0.02 SOL to supplier A and 0.02 SOL in ZEC to contributor B". The money enters Cloak's pool and leaves to new addresses. Whoever looks at the chain sees a deposit and withdrawals from a shared pool, but not which became which. The private swap delivers ZEC (verified mint) to an address with no direct link to the wallet that funded it.

**From whom.** From chain observers: competitors and on-chain analysts who today map suppliers and payroll from a single address. It does not hide amounts or times at the edges; with little activity in the pool, a deposit and its withdrawals can be matched by amount and time. It hides nothing from Cloak: the relay authenticates the wallet and receives the viewing key, which for these notes rebuilds their keys; hence the caps. The delivered ZEC is an ordinary token until it is shielded in a Zcash wallet. We do not promise invisibility against a determined adversary.

**What you gain.** (1) Commercial confidentiality: suppliers and amounts stop being public. (2) Preserved auditability: the viewing key, derived from the wallet, produces in the browser a CSV that the accountant reconciles with `audit export`; they receive the CSV, never the key. (3) Control: the chat only proposes; nothing moves without the operator's approval in their own wallet, with a cap per run and full addresses on screen. The model never sees keys or notes; the keys come from the wallet and are not stored. The agent works quietly and the owner still sees everything.
<!-- text:end -->

Recount the words after any edit; the limit is 300.

## Count

**295 words**, checked on 2026-10-04 by script, counted the way `wc -w` counts: runs of
non-space characters across the three paragraphs between the markers above, bold labels and the
"(1)", "(2)", "(3)" markers included. To recount after an edit:

```bash
awk '/^<!-- text:start -->$/{f=1;next} /^<!-- text:end -->$/{f=0} f' \
  examples/templates/cloak-private-payout/PRIVACY.en.md | wc -w
```
