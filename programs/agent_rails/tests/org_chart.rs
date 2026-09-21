//! An organization of agents, built out of treasuries that pay each other.
//!
//! This file exists to answer one question with a running program instead of a paragraph:
//! *can Agent Rails express a company — departments, per-agent allowances, one cold key
//! setting every ceiling — without a single new instruction?*
//!
//! It can, and the reason is two facts that were never written down together:
//!
//! 1. `execute_payment`'s `destination_owner` is an `UncheckedAccount` the program never
//!    reads (`execute_payment.rs:78`). Nothing requires it to be a wallet.
//! 2. A treasury's vault is the plain ATA of the `Treasury` PDA (`add_mint.rs:188`).
//!
//! So allowlisting a *child treasury's PDA* as a destination makes a payment land exactly
//! in that child's vault, and the child spends it under its own ceiling, its own policy,
//! its own counters and its own audit chain. The org chart is an account layout.
//!
//! Run it as a demo:
//!
//! ```text
//! cargo test -p agent_rails --test org_chart -- --nocapture
//! ```
//!
//! What it proves, in order:
//!
//! - **Allocation flows down.** HQ funds two departments; departments pay vendors.
//! - **Budgets are per agent, not per policy.** Two agents sharing one policy hold
//!   independent counters — the policy is the job, the session is the person.
//! - **Loosening only flows downhill.** A department operator cannot write a policy above
//!   the ceiling its owner set, at any level of the tree.
//! - **Pause is scoped to one treasury.** This one is a *negative* result and is asserted
//!   deliberately: pausing HQ does **not** pause its departments. Cascading pause is the
//!   one hierarchy feature worth adding (see `docs/research/agent-orgs-and-defi-mandates.md`
//!   §2.4); until it exists, an incident response has to pause each treasury it means to
//!   stop. Asserting the gap here keeps it honest and makes the day it changes visible.
//! - **Every level keeps its own audit chain**, recomputable off-chain from the receipt.

mod common;

use anchor_litesvm::{Keypair, Pubkey, Signer};

use agent_rails::args::{MintLimitInput, PolicyInput};
use agent_rails::state::AgentSession;
use agent_rails::AgentRailsError;
use agent_rails::MintCeilingInput;

use common::*;

const MINT_DECIMALS: u8 = 6;
const SESSION_TTL: i64 = 86_400;
const HOUR: u32 = 3_600;
const DAY: u32 = 86_400;

/// Base units for a whole-dollar amount at 6 decimals, so the numbers below read like the
/// budget a human would actually write down.
fn usd(dollars: u64) -> u64 {
    dollars * 1_000_000
}

fn ceiling(per_tx: u64, short: u64, long: u64, lifetime: u64) -> MintCeilingInput {
    MintCeilingInput {
        max_per_tx: per_tx,
        max_short_window: short,
        max_long_window: long,
        max_lifetime: lifetime,
        min_short_window_seconds: HOUR,
        min_long_window_seconds: DAY,
    }
}

/// A policy in `DestinationMode::Allowlist` — the only mode these treasuries permit, since
/// every one of them is chartered with `allow_any_destination: false`.
fn budget(mint: Pubkey, per_tx: u64, short: u64, long: u64, lifetime: u64) -> PolicyInput {
    PolicyInput {
        mint_limits: vec![MintLimitInput {
            mint,
            per_tx_max: per_tx,
            short_window_max: short,
            short_window_seconds: HOUR,
            long_window_max: long,
            long_window_seconds: DAY,
            lifetime_max: lifetime,
        }],
        destination_mode: 1,
        require_memo: false,
        create_destination_ata: true,
    }
}

/// `create_treasury` with an explicit owner, so one cold key can charter the whole tree.
///
/// `common::create_treasury` draws a fresh owner per treasury, which is right for a test
/// that only needs one. Here the point is the opposite: HQ and both departments answer to
/// the *same* owner key, which is what makes "the ceilings of every department were set by
/// one cold key" a true statement rather than a diagram.
fn charter(env: &mut Env, owner: &Keypair) -> TreasuryFixture {
    let create_key = env.unfunded_keypair();
    let operator_key = env.keypair();
    let operator = operator_key.pubkey();
    let recovery_destination = env.unique_pubkey();

    let (treasury, treasury_bump) = Env::treasury_pda(&create_key.pubkey());
    let (sol_vault, sol_vault_bump) = Env::sol_vault_pda(&treasury);

    let ix = env
        .ctx
        .program()
        .accounts(agent_rails::accounts::CreateTreasury {
            payer: owner.pubkey(),
            create_key: create_key.pubkey(),
            treasury,
            sol_vault,
            system_program: anchor_lang::system_program::ID,
            event_authority: Env::event_authority(),
            program: agent_rails::ID,
        })
        .args(agent_rails::instruction::CreateTreasury {
            owner: owner.pubkey(),
            operator,
            recovery_destination,
            // No department may ever pay an address nobody named.
            allow_any_destination: false,
            allow_create_destination_ata: true,
        })
        .instruction()
        .expect("build create_treasury instruction");

    env.execute(ix, &[owner, &create_key]).assert_success();

    TreasuryFixture {
        create_key,
        payer: owner.insecure_clone(),
        owner: owner.insecure_clone(),
        operator_key,
        operator,
        recovery_destination,
        treasury,
        treasury_bump,
        sol_vault,
        sol_vault_bump,
    }
}

/// `create_policy`, signed by the operator rather than the owner — the warm key does the
/// day-to-day, exactly as the trust model intends.
fn write_policy(env: &mut Env, fx: &TreasuryFixture, name: &str, args: PolicyInput) -> Pubkey {
    let padded = padded_name(name);
    let ix = create_policy_ix(env, &fx.treasury, &fx.operator, padded, args);
    let operator = fx.operator_key.insecure_clone();
    env.execute(ix, &[&operator]).assert_success();
    policy_pda(&fx.treasury, &padded).0
}

/// Issues a session with a real label, so the printed ledger names agents instead of keys.
fn hire(env: &mut Env, fx: &TreasuryFixture, policy: &Pubkey, label: &str) -> SessionFixture {
    let session_key = env.unfunded_keypair();
    let session = session_pda(&fx.treasury, &session_key.pubkey()).0;
    let expires_at = env.now() + SESSION_TTL;

    let ix = create_session_ix(
        env,
        &fx.treasury,
        &fx.operator,
        policy,
        SessionSpec {
            session_key: session_key.pubkey(),
            label: padded_name(label),
            expires_at,
            auth_mode: agent_rails::constants::AuthMode::DIRECT_SIGNER,
        },
    );
    let operator = fx.operator_key.insecure_clone();
    env.execute(ix, &[&operator]).assert_success();

    SessionFixture {
        session_key,
        session,
        policy: *policy,
        genesis_head: agent_rails_policy::genesis_audit_head(&session.to_bytes()),
    }
}

/// Registers a counterparty this policy may pay. The label is what an agent names; the
/// pubkey is what the program pays.
fn allow(
    env: &mut Env,
    fx: &TreasuryFixture,
    policy: &Pubkey,
    destination_owner: Pubkey,
    label: &str,
) -> Pubkey {
    let ix = add_allowlist_entry_ix(
        env,
        &fx.treasury,
        &fx.operator,
        policy,
        destination_owner,
        padded_name(label),
        0,
    );
    let operator = fx.operator_key.insecure_clone();
    env.execute(ix, &[&operator]).assert_success();
    allowlist_pda(policy, &destination_owner).0
}

/// One payment, through the same instruction an agent's MCP call would reach.
#[allow(clippy::too_many_arguments)]
fn pay(
    env: &mut Env,
    fx: &TreasuryFixture,
    session: &SessionFixture,
    fee_payer: &Keypair,
    mint: Pubkey,
    destination_owner: Pubkey,
    entry: Pubkey,
    amount: u64,
) -> agent_rails::PaymentIntent {
    let intent = intent(env, mint, destination_owner, amount);
    let ix = execute_payment_ix(
        env,
        fx,
        session,
        &fee_payer.pubkey(),
        token_program_id(),
        Some(entry),
        &intent,
    );
    env.execute(ix, &[fee_payer, &session.session_key])
        .assert_success();
    intent
}

fn label_of(session: &AgentSession) -> String {
    String::from_utf8_lossy(&session.label)
        .trim_end_matches('\0')
        .to_string()
}

/// `1234500000` -> `$1,234.50`. Thousands separators because the whole point of the
/// printed ledger is that a human reads it at a glance.
fn dollars(base_units: u64) -> String {
    let whole = base_units / 1_000_000;
    let cents = (base_units % 1_000_000) / 10_000;
    let digits = whole.to_string();
    let mut grouped = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(c);
    }
    format!("${grouped}.{cents:02}")
}

/// One agent's line in the printed ledger.
fn print_agent(env: &Env, session_pda: &Pubkey, mint: &Pubkey, branch: &str) {
    let state = session_account(env, session_pda);
    let counter = state.spend[state.find_counter(mint).expect("counter")];
    println!(
        "{:<28} gastou {:>12}   pagamentos {}   audit {}",
        format!("{branch} {}", label_of(&state)),
        dollars(counter.lifetime_spent),
        state.seq,
        hex8(&state.audit_head),
    );
}

/// One department's header line.
fn print_treasury(name: &str, vault: u64, per_tx_ceiling: u64) {
    println!(
        "{name:<28} vault  {:>12}   teto/tx {:>11}",
        dollars(vault),
        dollars(per_tx_ceiling),
    );
}

fn hex8(bytes: &[u8; 32]) -> String {
    bytes[..4].iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn an_organization_of_agents_runs_on_treasuries_that_pay_each_other() {
    let mut env = Env::new();
    let token_program = token_program_id();
    let mint_authority = env.keypair();
    let usdc = create_spl_token_mint(&mut env, &mint_authority, MINT_DECIMALS);

    // One cold key charters the whole company and sets every ceiling in it.
    let founder = env.keypair();
    let fee_payer = env.keypair();

    // ---------------------------------------------------------------------------------
    // 1. The tree. HQ holds the money; two departments hold mandates.
    // ---------------------------------------------------------------------------------
    let hq = charter(&mut env, &founder);
    let research = charter(&mut env, &founder);
    let ops = charter(&mut env, &founder);

    // Ceilings are the owner's statement of the most any policy below may ever allow.
    add_spl_mint(
        &mut env,
        &hq,
        usdc,
        token_program,
        ceiling(usd(25_000), usd(100_000), usd(200_000), usd(1_000_000)),
    );
    add_spl_mint(
        &mut env,
        &research,
        usdc,
        token_program,
        ceiling(usd(500), usd(1_000), usd(2_000), usd(20_000)),
    );
    add_spl_mint(
        &mut env,
        &ops,
        usdc,
        token_program,
        ceiling(usd(5_000), usd(8_000), usd(15_000), usd(100_000)),
    );

    // `add_mint` created each treasury's vault ATA. That is the account HQ will pay into.
    fund_vault(
        &mut env,
        &hq.treasury,
        &usdc,
        &mint_authority,
        token_program,
        usd(200_000),
    );

    // ---------------------------------------------------------------------------------
    // 2. HQ's allocator agent. Its only permitted destinations are the two departments.
    // ---------------------------------------------------------------------------------
    let allocation = write_policy(
        &mut env,
        &hq,
        "alocacao",
        budget(usdc, usd(25_000), usd(50_000), usd(100_000), usd(500_000)),
    );
    let to_research = allow(&mut env, &hq, &allocation, research.treasury, "pesquisa");
    let to_ops = allow(&mut env, &hq, &allocation, ops.treasury, "operacoes");
    let cfo = hire(&mut env, &hq, &allocation, "agente-cfo");

    let research_grant = pay(
        &mut env,
        &hq,
        &cfo,
        &fee_payer,
        usdc,
        research.treasury,
        to_research,
        usd(5_000),
    );
    pay(
        &mut env,
        &hq,
        &cfo,
        &fee_payer,
        usdc,
        ops.treasury,
        to_ops,
        usd(20_000),
    );

    // The claim, asserted: money paid to a treasury PDA lands in that treasury's vault.
    let research_vault = vault_ata(&research.treasury, &usdc, &token_program);
    let ops_vault = vault_ata(&ops.treasury, &usdc, &token_program);
    assert_eq!(token_balance(&env, &research_vault), usd(5_000));
    assert_eq!(token_balance(&env, &ops_vault), usd(20_000));

    // ---------------------------------------------------------------------------------
    // 3. Research: one policy, two agents, independent budgets.
    // ---------------------------------------------------------------------------------
    let analyst = write_policy(
        &mut env,
        &research,
        "analista",
        budget(usdc, usd(200), usd(600), usd(1_200), usd(5_000)),
    );
    let data_api = env.unique_pubkey();
    let reports = env.unique_pubkey();
    let to_data_api = allow(&mut env, &research, &analyst, data_api, "dados-api");
    let to_reports = allow(&mut env, &research, &analyst, reports, "relatorios");

    let scout = hire(&mut env, &research, &analyst, "scout-mercado");
    let quant = hire(&mut env, &research, &analyst, "analista-token");

    for _ in 0..2 {
        pay(
            &mut env,
            &research,
            &scout,
            &fee_payer,
            usdc,
            data_api,
            to_data_api,
            usd(150),
        );
    }
    pay(
        &mut env,
        &research,
        &quant,
        &fee_payer,
        usdc,
        reports,
        to_reports,
        usd(180),
    );

    // ---------------------------------------------------------------------------------
    // 4. Ops: bigger mandate, same shape.
    // ---------------------------------------------------------------------------------
    let purchasing = write_policy(
        &mut env,
        &ops,
        "compras",
        budget(usdc, usd(2_000), usd(5_000), usd(10_000), usd(50_000)),
    );
    let cloud = env.unique_pubkey();
    let saas = env.unique_pubkey();
    let to_cloud = allow(&mut env, &ops, &purchasing, cloud, "cloud");
    let to_saas = allow(&mut env, &ops, &purchasing, saas, "licencas");

    let infra = hire(&mut env, &ops, &purchasing, "compras-infra");
    let seats = hire(&mut env, &ops, &purchasing, "compras-saas");

    pay(
        &mut env,
        &ops,
        &infra,
        &fee_payer,
        usdc,
        cloud,
        to_cloud,
        usd(1_200),
    );
    pay(
        &mut env,
        &ops,
        &seats,
        &fee_payer,
        usdc,
        saas,
        to_saas,
        usd(800),
    );

    // ---------------------------------------------------------------------------------
    // 5. The ledger, consolidated from on-chain state alone.
    // ---------------------------------------------------------------------------------
    let hq_vault = vault_ata(&hq.treasury, &usdc, &token_program);
    println!("\nAGENT RAILS — um organograma feito de contas");
    println!("{}", "─".repeat(76));
    print_treasury("HQ", token_balance(&env, &hq_vault), usd(25_000));
    print_agent(&env, &cfo.session, &usdc, "  └─");
    println!();
    print_treasury("  PESQUISA", token_balance(&env, &research_vault), usd(500));
    print_agent(&env, &scout.session, &usdc, "    ├─");
    print_agent(&env, &quant.session, &usdc, "    └─");
    println!();
    print_treasury("  OPERACOES", token_balance(&env, &ops_vault), usd(5_000));
    print_agent(&env, &infra.session, &usdc, "    ├─");
    print_agent(&env, &seats.session, &usdc, "    └─");
    println!("{}", "─".repeat(76));
    println!("Cada nivel: teto proprio, politica propria, contadores proprios, cadeia propria.\n");

    // Balances: what HQ sent minus what each department spent.
    assert_eq!(token_balance(&env, &hq_vault), usd(175_000));
    assert_eq!(token_balance(&env, &research_vault), usd(5_000) - usd(480));
    assert_eq!(token_balance(&env, &ops_vault), usd(20_000) - usd(2_000));
    assert_eq!(
        token_balance(&env, &data_ata(&env, &data_api, &usdc)),
        usd(300)
    );

    // Two agents, one policy, separate budgets. This is the property that makes the
    // policy a job description and the session a person.
    let scout_state = session_account(&env, &scout.session);
    let quant_state = session_account(&env, &quant.session);
    assert_eq!(scout_state.policy, quant_state.policy);
    assert_eq!(
        scout_state.spend[scout_state.find_counter(&usdc).expect("counter")].lifetime_spent,
        usd(300)
    );
    assert_eq!(
        quant_state.spend[quant_state.find_counter(&usdc).expect("counter")].lifetime_spent,
        usd(180)
    );

    // Each level's chain is its own. Recompute HQ's first link the way an indexer would.
    let hq_receipt = receipt_account(
        &env,
        &receipt_pda(&cfo.session, &research_grant.intent_id).0,
    );
    let cfo_state = session_account(&env, &cfo.session);
    assert_eq!(cfo_state.seq, 2);
    let first_link = agent_rails_policy::next_audit_head(
        &cfo.genesis_head,
        1,
        &research_grant.intent_id,
        &usdc.to_bytes(),
        &research.treasury.to_bytes(),
        usd(5_000),
        hq_receipt.slot,
    );
    assert_ne!(first_link, cfo.genesis_head);
    assert_ne!(cfo_state.audit_head, scout_state.audit_head);

    // ---------------------------------------------------------------------------------
    // 6. Governance, at every level of the tree.
    // ---------------------------------------------------------------------------------

    // Loosening only flows downhill: research's own operator cannot write itself a policy
    // above the ceiling the founder set for research, even though the same operator is
    // free to write anything at or below it.
    let over_ceiling = create_policy_ix(
        &env,
        &research.treasury,
        &research.operator,
        padded_name("mais-alto"),
        budget(usdc, usd(600), usd(1_000), usd(2_000), usd(20_000)),
    );
    let operator = research.operator_key.insecure_clone();
    let result = env.execute(over_ceiling, &[&operator]);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);

    // Pause is per treasury, and a guardian is the one who pulls it.
    let guardian = env.keypair();
    add_guardian(&mut env, &ops, guardian.pubkey());
    let pause_ops = pause_ix(&env, &ops.treasury, &guardian.pubkey());
    env.execute(pause_ops, &[&guardian]).assert_success();

    let blocked = intent(&mut env, usdc, cloud, usd(100));
    let ix = execute_payment_ix(
        &env,
        &ops,
        &infra,
        &fee_payer.pubkey(),
        token_program,
        Some(to_cloud),
        &blocked,
    );
    let result = env.execute(ix, &[&fee_payer, &infra.session_key]);
    assert_program_error(&result, AgentRailsError::Paused);

    // Research is untouched by Ops' pause — departments are independent blast radii.
    pay(
        &mut env,
        &research,
        &scout,
        &fee_payer,
        usdc,
        data_api,
        to_data_api,
        usd(20),
    );
    unpause(&mut env, &ops);

    // The honest gap: pausing HQ stops HQ's allocator and nothing else. Cascading pause
    // does not exist (research doc §2.4). Asserted so that adding it is a visible change.
    pause(&mut env, &hq);
    let blocked_allocation = intent(&mut env, usdc, ops.treasury, usd(1_000));
    let ix = execute_payment_ix(
        &env,
        &hq,
        &cfo,
        &fee_payer.pubkey(),
        token_program,
        Some(to_ops),
        &blocked_allocation,
    );
    let result = env.execute(ix, &[&fee_payer, &cfo.session_key]);
    assert_program_error(&result, AgentRailsError::Paused);

    pay(
        &mut env,
        &ops,
        &infra,
        &fee_payer,
        usdc,
        cloud,
        to_cloud,
        usd(100),
    );
    assert_eq!(
        token_balance(&env, &ops_vault),
        usd(20_000) - usd(2_000) - usd(100),
        "a department keeps spending while its parent is paused"
    );

    // And the emergency exit still works, paused or not: the owner withdraws.
    let escrow = env.unique_pubkey();
    let escrow_ata = create_destination_ata(&mut env, &fee_payer, &escrow, &usdc, token_program);
    let withdraw = withdraw_ix(
        &env,
        &hq,
        &hq.owner.pubkey(),
        usdc,
        usd(1_000),
        escrow_ata,
        Some((hq_vault, token_program)),
    );
    let owner = hq.owner.insecure_clone();
    env.execute(withdraw, &[&owner]).assert_success();
    assert_eq!(token_balance(&env, &escrow_ata), usd(1_000));
}

/// The ATA a vendor receives into. Named for what it is at the call site.
fn data_ata(env: &Env, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let _ = env;
    anchor_spl::associated_token::get_associated_token_address_with_program_id(
        owner,
        mint,
        &token_program_id(),
    )
}
