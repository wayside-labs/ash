// The official pitch, source language. /pitch and /investor both render these slides, so editing
// this file updates both — never copy a slide into a page. Same rules as copy.en.ts (no prices, no
// "non-custodial", no audit promises, no round terms) plus no TODO: an unconfirmed number or name
// stays off the slide. Sources, all in the agent-rails repo (main at 2bbe70d, read 2026-10-01):
// tools = packages/contract/src/mcp-tools.ts AGENT_TOOL_NAMES (7; the seventh only asks a human);
// proofs = policy crate src/proofs.rs (13 #[kani::proof]); coverage = CLAUDE.md; no test count
// is quoted (nobody re-ran the suites); ADRs = docs/adr (more than twenty on record);
// limits are per agent session and per token, pause is per vault, a receipt can be closed about
// an hour after the payment; phases = README "Trust phases";
// x402 = TRM Labs 2026-09-09 (not the frozen x402.org counter);
// market + competitors = agenttokenfy/.aios/research/2026-09-30-mercado-e-concorrentes-pitch.md; revenue lines = docs/strategy/briefing-negocio.md.
export const pitchEn = {
  meta: {
    pitchTitle: "Ash — the pitch",
    investorTitle: "Ash — for investors",
    description: "Spend authority for AI agents on Solana, in eighteen screens and three minutes.",
  },
  deck: {
    prev: "Previous slide",
    next: "Next slide",
    present: "Present",
    stop: "Stop",
    notes: "Notes",
    hint: "← → to move · P to present · N for notes",
    slide: "Slide",
  },
  slides: [
    {
      id: "hook", kind: "hook", dur: 10, kicker: "Ash",
      line: "Would you hand an AI your company card?",
      support: ["The rails for agents to pay are live. The question is who lets them."],
      notes: "Agents can now pay for APIs, compute and services on their own. The rails are live. The open question is a simple one: would you hand one your company card?",
    },
    {
      id: "problem", kind: "list", dur: 12, kicker: "The problem",
      line: "A wallet in an agent’s hands is a blank cheque.",
      support: ["One injected prompt: “withdraw everything.”", "One timed-out retry: paid twice.", "One leaked key: gone."],
      notes: "Give an agent a wallet and you give it everything the key can reach. One injected prompt, one retry after a timeout, one leaked key — and the whole balance is at risk.",
    },
    {
      id: "dilemma", kind: "versus", dur: 10, kicker: "The problem",
      line: "Three options today. None of them scales.",
      support: ["Hand over the keys — the worst case is the whole balance.", "Approve every payment by hand — the autonomy is gone.", "A small wallet topped up by hand — fine for one agent and cents, not for four agents and a real vendor."],
      notes: "There are three options today. Hand over the keys and accept the whole balance as the worst case. Approve every payment by hand and lose the autonomy. Or keep a small wallet and top it up by hand, which works for one agent and a few cents and stops there.",
    },
    {
      id: "answer", kind: "answer", dur: 12, kicker: "The solution",
      line: "Unleash your agents on Solana. Full autonomy, on your terms.",
      support: ["Turn prompts into payments: spend authority for AI agents, enforced by an on-chain program."],
      notes: "Ash turns prompts into payments. Each agent pays on its own, with full autonomy inside the budget and the destinations you set. Anything else is refused by an on-chain program, not by our servers.",
    },
    {
      id: "flow", kind: "flow", dur: 14, kicker: "The solution · simulated",
      line: "One vault, four agents, a budget for each.",
      support: ["Green: cleared. Red: over the limit. Dashed amber: revoked — it cannot move a cent."],
      notes: "Here it is running. One vault funds four agents, each with its own budget. Payments inside the budget clear; the one over its limit is refused on the spot; the agent whose session was revoked cannot move anything.",
    },
    {
      id: "pay", kind: "pillar", dur: 10, kicker: "01 · Agents that pay",
      line: "It pays on its own — and can’t raise its own limit.",
      support: ["A session key signs each payment within policy", "7 agent tools · none withdraws or raises a limit", "A retry of the same payment is refused on-chain"],
      notes: "One: agents that pay. No human approves each payment. The agent sees seven tools; six read or pay, the seventh only asks a human, and none withdraws or raises a limit. A retry of the same payment is refused on-chain while its receipt exists.",
    },
    {
      id: "rules", kind: "pillar", dur: 12, kicker: "02 · Rules that hold",
      line: "No policy exceeds the owner’s ceiling.",
      support: ["Owner — funds, sets the ceiling, withdraws alone", "Operator — runs policy under the ceiling", "Guardian — can only pause", "Agent — pays within policy"],
      notes: "Two: rules that hold. A corporate card for four people. Owner, operator, guardian, agent. No policy exceeds the owner’s ceiling, no agent changes its own policy, and the owner always withdraws alone.",
    },
    {
      id: "cards", kind: "cards", dur: 10, kicker: "02 · Rules that hold · simulated",
      line: "Every agent gets its own budget.",
      support: ["Three agents, three outcomes: paid, refused, revoked."],
      notes: "Every agent carries its own budget. One paid a vendor. One tried a payment over its limit and was refused. One had its session revoked by the operator and cannot pay until it gets a new one.",
    },
    {
      id: "proof", kind: "pillar", dur: 10, kicker: "03 · A record on-chain",
      line: "A record no one can quietly edit.",
      support: ["Every payment extends an on-chain hash chain", "13 Kani proofs over the policy core · 99.2% line coverage on the policy engine", "The program is on public devnet; the on-chain program itself is not audited yet"],
      notes: "Three: the record. Every payment extends a hash chain whose head lives on-chain, so with the full history in hand anyone can confirm nothing was left out. Thirteen Kani proofs cover the policy core. The program runs on devnet and is not audited yet.",
    },
    {
      id: "compete", kind: "matrix", dur: 12, kicker: "Competition",
      line: "Several enforce on-chain. Few combine roles, limits and a record.",
      support: ["Our reading of public documentation, September 2026. * vendor claim, not verified."],
      axes: { x: ["Rule enforced by a vendor", "Rule enforced on-chain"], y: ["One cap", "Roles, several limits, a record"] },
      points: [
        { n: "Visa · Mastercard agent tokens", x: 0.1, y: 0.5 },
        { n: "Ramp agent cards + x402", x: 0.22, y: 0.64 },
        { n: "Nekuda mandates", x: 0.12, y: 0.34 },
        { n: "Privy (Stripe)", x: 0.3, y: 0.44 },
        { n: "Coinbase Agentic Wallets", x: 0.4, y: 0.28 },
        { n: "Crossmint*", x: 0.68, y: 0.42 },
        { n: "Squads spending limits", x: 0.86, y: 0.5 },
        { n: "Solana native allowances", x: 0.9, y: 0.16 },
        { n: "Ash", x: 0.9, y: 0.88, you: true },
      ],
      notes: "Card networks, Ramp, Privy and Coinbase all control agent spend — on their own servers. Solana’s native allowances enforce one cap on-chain; Squads adds destinations and a time window. Ash is on-chain with roles, several limits at once and a record — and it builds on the native allowance instead of replacing it.",
    },
    {
      id: "edge", kind: "list", dur: 12, kicker: "Why Ash",
      line: "What one cap cannot do.",
      support: ["Per-payment, per-window and lifetime limits at once, with destination and token allowlists", "Roles where loosening only flows downhill", "A pause key separate from the owner", "A hash chain that lets you prove nothing was omitted", "An agent surface that cannot escalate · Apache-2.0, no protocol fee today"],
      notes: "What one cap cannot do: several limits at once with allowlists, roles where limits only tighten downhill, a pause separate from the owner, a history that lets you prove omission, and an agent that cannot escalate.",
    },
    {
      id: "now", kind: "stat", dur: 10, kicker: "Why now",
      line: "The rails to pay arrived before the agents.",
      support: ["x402: 52.7 million dollars settled since May 2025; about 25.6 million look like commerce, and 0.6% to 7.5% of that looks like AI agents (TRM Labs, Sep 2026)", "40 organizations have joined the x402 Foundation since April (Linux Foundation, Jul 2026)", "The rails are being standardized. What an agent may spend is not part of them"],
      notes: "Why now: the rails are live before the demand. TRM Labs counted fifty-two point seven million dollars in x402 settlements, and only a sliver of it looks like real agents. Forty organizations joined the x402 Foundation. The rails are being standardized; the control over what an agent may spend is not part of them.",
    },
    {
      id: "market", kind: "market", dur: 12, kicker: "Market",
      line: "A market still being built. This is what can be measured.",
      stats: [
        { v: "0.6–7.5%", l: "share of screened x402 commerce that looks like AI agents (TRM Labs, Sep 2026)" },
        { v: "93%", l: "drop in x402 daily settlement volume, year to date (Helios data via CCN, Aug 2026)" },
        { v: "40", l: "organizations in the x402 Foundation since April (Linux Foundation, Jul 2026)" },
        { v: "0", l: "paying customers of ours — early, and we know it" },
      ],
      support: ["We sell the control layer, not a toll, to the people building agents on Solana that need to pay. We do not know yet how many there are."],
      notes: "The market, honestly: it is still being built. Agent payments on-chain are a sliver of x402, and x402 volume fell this year, while forty organizations joined its foundation. We sell the control layer to the people building agents on Solana that need to pay. We are early, on purpose, and we do not know yet how many of them there are.",
    },
    {
      id: "model", kind: "list", dur: 8, kicker: "Business model",
      line: "Apache-2.0 protocol. Paid operations.",
      support: ["No protocol fee today · Apache-2.0", "Guardian as a service, priced by the balance it protects", "Hosted console · cost per agent · compliance attestation", "Not yet validated with buyers"],
      notes: "The protocol is Apache-2.0 licensed, with no protocol fee today. We charge for operations: a guardian service priced by the balance it protects, a hosted console, cost per agent and attestation. Not yet validated with buyers.",
    },
    {
      id: "today", kind: "list", dur: 8, kicker: "Where we are",
      line: "Built, tested, running on devnet.",
      support: ["On-chain program · CLI · MCP server · Vercel AI SDK adapter", "Operator console live at console.ash.app.br", "More than twenty architecture decisions on record · 0 paying customers yet"],
      notes: "Where we are: program on devnet, CLI, MCP server, SDK adapter and an operator console already live. More than twenty architecture decisions on record. No paying customers yet — that is the work now.",
    },
    {
      id: "team", kind: "list", dur: 6, kicker: "Team",
      line: "Three people, based in Brazil.",
      support: ["Protocol, SDK and CLI", "Product, console and go-to-market", "Business and partnerships"],
      notes: "We are three people in Brazil: one on the protocol, SDK and CLI; one on product, console and go-to-market; one on business and partnerships.",
    },
    {
      id: "ask", kind: "close", dur: 8, kicker: "The ask",
      line: "First, three teams on devnet. Then the audit that opens mainnet.",
      support: ["The first teams running agents on devnet", "A professional audit — the gate to mainnet", "Hosted console and indexer — the base of every paid line", "Plan: 0.x today · 3-of-5 multisig at 1.0-beta · renounced at 1.0"],
      notes: "What comes next, in order: the first teams running agents on devnet; then a professional audit, which is the gate to mainnet; and the hosted console and indexer every paid line depends on. Trust comes in phases, and that is the plan, not what exists today.",
    },
    {
      id: "thanks", kind: "thanks", dur: 4, kicker: "Ash",
      line: "Thank you.",
      support: ["ash.app.br"],
      notes: "Thank you. If your agents should be paying for things, let’s talk.",
    },
  ],
  cards: {
    left: "left today", balance: "Balance", pays: "Pays",
    items: [
      { n: "João", r: "Sales assistant", status: "active", pays: ["Customers", "Marketing"], last: "Paid Marketing" },
      { n: "Maria", r: "Finance", status: "active", pays: ["Vendors", "OpenAI"], last: "Payment to OpenAI refused · over the limit" },
      { n: "Carlos", r: "Logistics", status: "revoked", pays: ["Carriers"], last: "Session revoked by the operator" },
    ],
  },
  gate: {
    title: "Before the pitch: who are we talking to?",
    sub: "Eighteen screens, three minutes. Tell us who you are and we will open it for you.",
    name: "Name",
    role: "Role",
    rolePlaceholder: "Partner, CFO, founder…",
    kind: "You are",
    kinds: { investor: "An investor", founder: "A founder or operator", other: "Something else" },
    email: "E-mail",
    consent: "I agree that Ash may keep these details and e-mail me about Ash. I can unsubscribe at any time.",
    consentLink: "Privacy",
    submit: "Open the pitch",
    sending: "Opening…",
    skip: "Rather not share? The same pitch is open to anyone:",
    skipLink: "see it without signing in",
    errors: {
      name: "Tell us your name.",
      role: "Tell us your role.",
      kind: "Pick one.",
      email: "Check the e-mail address.",
      consent: "We need your consent to continue.",
      network: "Something went wrong on our side. Try again in a moment.",
    },
  },
  welcome: {
    hi: "Hi, {name}.",
    back: "Welcome back, {name}.",
    lines: {
      investor: "You are about to see where agent payments are going — and the layer that decides how much an agent may spend.",
      founder: "If your agents should be paying for things, this is how you let them without handing over the keys.",
      other: "Here is how an AI agent spends money without ever holding the keys.",
    },
    owner: "In this scene you are the owner. Drag the limit and watch what gets through.",
    treasury: "{name}’s treasury",
    cta: "See the pitch",
  },
  outro: {
    thanks: "Thanks for reading, {name}.",
    lines: {
      investor: "If this fits your thesis, we would love to hear what you thought — including what did not convince you.",
      founder: "If your agents should be paying for things, let’s try it together on devnet.",
      other: "If any of this is useful to you, we would like to hear where.",
    },
    ask: "Want to talk to us?",
    yes: "Yes, let’s talk",
    no: "Not now",
    pick: "Pick whatever suits you:",
    channels: { booking: "Book 20 minutes", whatsapp: "WhatsApp", email: "E-mail" },
    none: "Thanks. Write to us through the site whenever you like.",
    later: "No problem. The pitch stays here whenever you want it.",
    whatsappText: "Hi, I just saw the Ash pitch and would like to talk.",
    emailSubject: "Ash — after the pitch",
    replay: "See the pitch again",
    site: "Visit the Ash site",
  },
} as const;
