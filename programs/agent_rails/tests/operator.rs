//! The operator lifecycle: policies, allowlist entries, and sessions (spec §5.2).
//!
//! Two properties matter more than any individual instruction here.
//!
//! **Loosening flows downhill only.** The owner sets ceilings, the operator writes policies
//! under them, and the agent sets nothing. Every rejection below is a place where that
//! ordering is enforced rather than assumed.
//!
//! **`active_sessions` means "sessions that could still pay."** It gates `close_policy` and
//! (later) `close_treasury`, so it has to move exactly once per session in each direction.
//! `revoke_session` decrements; `close_session` decrements only what revocation did not.
//! Getting that wrong in either direction is a real bug: undercount lets a policy be closed
//! out from under live agents, overcount strands the account forever.

mod common;

use anchor_litesvm::{Pubkey, Signer};

use agent_rails::args::PolicyInput;
use agent_rails::constants::{AuthMode, MAX_SESSION_TTL_SECONDS, NATIVE_MINT};
use agent_rails::events::{
    AllowlistEntryAdded, AllowlistEntryRemoved, PolicyClosed, PolicyCreated, SessionClosed,
    SessionCreated, SessionRevoked,
};
use agent_rails::AgentRailsError;

use common::*;

const MINT_DECIMALS: u8 = 6;
const SESSION_TTL: i64 = 86_400;

/// Borsh-serializes a value, for cross-checking a digest the program computed on-chain.
fn borsh_bytes<T: anchor_lang::AnchorSerialize>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    value.serialize(&mut bytes).expect("serialize");
    bytes
}

/// A treasury with one SPL mint configured, which is the precondition for every policy.
fn treasury_with_mint(env: &mut Env) -> (TreasuryFixture, Pubkey) {
    let fixture = create_treasury(env, true, true);
    let authority = fixture.owner.insecure_clone();
    let mint = create_spl_token_mint(env, &authority, MINT_DECIMALS);
    add_spl_mint(
        env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );
    (fixture, mint)
}

// ---------------------------------------------------------------------------------------
// create_policy
// ---------------------------------------------------------------------------------------

#[test]
fn create_policy_writes_the_rules_and_counts_the_policy() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);

    let name = padded_name("vendor-payments");
    let args = permissive_policy_args(mint);
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        name,
        args.clone(),
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let address = policy_pda(&fixture.treasury, &name).0;
    let policy = policy_account(&env, &address);
    assert_eq!(policy.version, agent_rails::constants::PROGRAM_VERSION);
    assert_eq!(policy.bump, policy_pda(&fixture.treasury, &name).1);
    assert_eq!(policy.treasury, fixture.treasury);
    assert_eq!(policy.name, name);
    assert_eq!(policy.mint_count, 1);
    assert_eq!(policy.mint_limits[0].mint, mint);
    assert_eq!(
        policy.mint_limits[0].per_tx_max,
        args.mint_limits[0].per_tx_max
    );
    assert_eq!(policy.destination_mode, 0);
    assert!(!policy.require_memo);
    assert!(!policy.create_destination_ata);
    assert_eq!(policy.active_sessions, 0);
    assert_eq!(policy.created_at, policy.updated_at);
    assert_eq!(policy.reserved, [0u8; 64]);

    // The v1.1 fields must be zero however the client filled the args (spec §3.2.1).
    assert_eq!(policy.mint_limits[0].approval_threshold, 0);
    assert_eq!(policy.mint_limits[0].cooldown_seconds, 0);
    assert_eq!(policy.mint_limits[0].reserved, [0u8; 12]);

    assert_eq!(env.treasury(&fixture.treasury).policy_count, 1);

    let event: PolicyCreated = emitted_event(&result);
    assert_eq!(event.policy, address);
    assert_eq!(event.name, name);
    assert_eq!(
        event.limits_hash,
        sha256(&borsh_bytes(&args)),
        "limits_hash must commit to the PolicyInput the operator signed for"
    );
}

#[test]
fn create_policy_accepts_the_operator_as_well_as_the_owner() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);

    // "Operator or owner" is one of the few places two keys are interchangeable, so both
    // have to be exercised — a `has_one` on either field alone would pass one of these.
    let operator = fixture.operator_key.insecure_clone();
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &operator.pubkey(),
        padded_name("operator-made"),
        permissive_policy_args(mint),
    );
    env.execute(ix, &[&operator]).assert_success();

    let owner = fixture.owner.insecure_clone();
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        padded_name("owner-made"),
        permissive_policy_args(mint),
    );
    env.execute(ix, &[&owner]).assert_success();

    assert_eq!(env.treasury(&fixture.treasury).policy_count, 2);
}

#[test]
fn create_policy_rejects_a_stranger() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let stranger = env.keypair();

    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &stranger.pubkey(),
        padded_name("sneaky"),
        permissive_policy_args(mint),
    );
    let result = env.execute(ix, &[&stranger]);
    assert_program_error(&result, AgentRailsError::Unauthorized);
}

#[test]
fn create_policy_rejects_a_limit_above_the_ceiling() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);

    let mut args = permissive_policy_args(mint);
    args.mint_limits[0].per_tx_max = permissive_ceiling().max_per_tx + 1;

    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        padded_name("too-loose"),
        args,
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);
}

#[test]
fn create_policy_rejects_a_window_shorter_than_the_ceiling_minimum() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);

    // A shorter window with the same cap lets the agent spend that cap more often, so it is
    // the loosening direction even though no amount changed.
    let mut args = permissive_policy_args(mint);
    args.mint_limits[0].short_window_seconds = permissive_ceiling().min_short_window_seconds - 1;

    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        padded_name("too-fast"),
        args,
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);
}

#[test]
fn create_policy_rejects_an_unconfigured_mint() {
    let mut env = Env::new();
    let (fixture, _mint) = treasury_with_mint(&mut env);
    let authority = fixture.owner.insecure_clone();
    let stranger = create_spl_token_mint(&mut env, &authority, MINT_DECIMALS);

    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        padded_name("stranger"),
        permissive_policy_args(stranger),
    );
    let result = env.execute(ix, &[&authority]);
    assert_program_error(&result, AgentRailsError::MintNotConfigured);
}

#[test]
fn create_policy_rejects_open_destinations_without_the_ceiling_flag() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, false, true);
    let authority = fixture.owner.insecure_clone();
    let mint = create_spl_token_mint(&mut env, &authority, MINT_DECIMALS);
    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );

    let mut args = permissive_policy_args(mint);
    args.destination_mode = 0; // Any
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        padded_name("open"),
        args,
    );
    let result = env.execute(ix, &[&authority]);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);
}

#[test]
fn create_policy_rejects_ata_creation_without_the_ceiling_flag() {
    let mut env = Env::new();
    let fixture = create_treasury(&mut env, true, false);
    let authority = fixture.owner.insecure_clone();
    let mint = create_spl_token_mint(&mut env, &authority, MINT_DECIMALS);
    add_spl_mint(
        &mut env,
        &fixture,
        mint,
        token_program_id(),
        permissive_ceiling(),
    );

    let mut args = permissive_policy_args(mint);
    args.create_destination_ata = true;
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        padded_name("ata-maker"),
        args,
    );
    let result = env.execute(ix, &[&authority]);
    assert_program_error(&result, AgentRailsError::PolicyExceedsCeiling);
}

#[test]
fn create_policy_rejects_duplicate_and_empty_limit_sets() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let owner = fixture.owner.insecure_clone();

    let empty = PolicyInput {
        mint_limits: vec![],
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        padded_name("empty"),
        empty,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidLimit);

    let mut duplicate = permissive_policy_args(mint);
    duplicate.mint_limits.push(permissive_limit_args(mint));
    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        padded_name("duplicate"),
        duplicate,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::DuplicateMint);
}

#[test]
fn create_policy_rejects_an_empty_name() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let owner = fixture.owner.insecure_clone();

    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        [0u8; 32],
        permissive_policy_args(mint),
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidName);
}

#[test]
fn create_policy_rejects_a_name_with_trailing_garbage_after_a_nul() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let owner = fixture.owner.insecure_clone();

    // "ab\0…\0x" and "ab" would display identically but derive different PDAs, so only the
    // canonical zero-padded encoding is accepted.
    let mut name = padded_name("ab");
    name[31] = b'x';

    let ix = create_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        name,
        permissive_policy_args(mint),
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidName);
}

// ---------------------------------------------------------------------------------------
// create_session / revoke_session / close_session
// ---------------------------------------------------------------------------------------

#[test]
fn create_session_starts_a_genesis_chain_and_mirrors_the_policy_slots() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    add_native_mint(&mut env, &fixture, permissive_ceiling());

    let args = PolicyInput {
        mint_limits: vec![
            permissive_limit_args(mint),
            permissive_limit_args(NATIVE_MINT),
        ],
        destination_mode: 0,
        require_memo: false,
        create_destination_ata: false,
    };
    let policy = create_policy(&mut env, &fixture, padded_name("two-mints"), args);

    let session_key = env.unfunded_keypair();
    let expires_at = env.now() + SESSION_TTL;
    let ix = create_session_ix(
        &env,
        &fixture.treasury,
        &fixture.owner.pubkey(),
        &policy,
        SessionSpec {
            session_key: session_key.pubkey(),
            label: padded_name("billing-agent-prod"),
            expires_at,
            auth_mode: AuthMode::DIRECT_SIGNER,
        },
    );
    let owner = fixture.owner.insecure_clone();
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let address = session_pda(&fixture.treasury, &session_key.pubkey()).0;
    let session = session_account(&env, &address);
    assert_eq!(session.treasury, fixture.treasury);
    assert_eq!(session.policy, policy);
    assert_eq!(session.session_key, session_key.pubkey());
    assert_eq!(session.auth_mode, AuthMode::DIRECT_SIGNER);
    assert_eq!(session.label, padded_name("billing-agent-prod"));
    assert_eq!(session.expires_at, expires_at);
    assert!(!session.revoked);
    assert_eq!(session.revoked_at, 0);
    assert_eq!(session.seq, 0);
    assert_eq!(session.reserved, [0u8; 64]);

    // Genesis head, not zero: the chain is bound to this session's own address.
    assert_eq!(
        session.audit_head,
        agent_rails_policy::genesis_audit_head(&address.to_bytes())
    );

    // Counters index-aligned with the policy, every amount zero.
    assert_eq!(session.spend[0].mint, mint);
    assert_eq!(session.spend[1].mint, NATIVE_MINT);
    assert_eq!(session.spend[2].mint, Pubkey::default());
    for counter in session.spend.iter() {
        assert_eq!(counter.short_spent, 0);
        assert_eq!(counter.long_spent, 0);
        assert_eq!(counter.lifetime_spent, 0);
    }

    assert_eq!(env.treasury(&fixture.treasury).active_sessions, 1);
    assert_eq!(policy_account(&env, &policy).active_sessions, 1);

    let event: SessionCreated = emitted_event(&result);
    assert_eq!(event.session, address);
    assert_eq!(event.policy, policy);
    assert_eq!(event.session_key, session_key.pubkey());
    assert_eq!(event.expires_at, expires_at);
}

#[test]
fn create_session_refuses_a_privileged_key() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();

    // A hot agent key that is also the owner or operator would let a compromised agent
    // widen its own limits instead of being boxed in by them.
    for privileged in [fixture.owner.pubkey(), fixture.operator] {
        let ix = create_session_ix(
            &env,
            &fixture.treasury,
            &owner.pubkey(),
            &policy,
            SessionSpec {
                session_key: privileged,
                label: padded_name("agent"),
                expires_at: env.now() + SESSION_TTL,
                auth_mode: AuthMode::DIRECT_SIGNER,
            },
        );
        assert_program_error(
            &env.execute(ix, &[&owner]),
            AgentRailsError::PrivilegedKeyAsSession,
        );
    }
}

#[test]
fn create_session_refuses_a_v1_1_auth_mode_and_a_bad_expiry() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();

    let key = env.unfunded_keypair();
    let ix = create_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        SessionSpec {
            session_key: key.pubkey(),
            label: padded_name("agent"),
            expires_at: env.now() + SESSION_TTL,
            auth_mode: AuthMode::SIGNED_INTENT,
        },
    );
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::InvalidAuthMode,
    );

    let already_expired = env.now();
    let ix = create_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        SessionSpec {
            session_key: key.pubkey(),
            label: padded_name("agent"),
            expires_at: already_expired,
            auth_mode: AuthMode::DIRECT_SIGNER,
        },
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidExpiry);

    let too_far = env.now() + MAX_SESSION_TTL_SECONDS + 1;
    let ix = create_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        SessionSpec {
            session_key: key.pubkey(),
            label: padded_name("agent"),
            expires_at: too_far,
            auth_mode: AuthMode::DIRECT_SIGNER,
        },
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidExpiry);
}

#[test]
fn revoke_session_stops_the_agent_and_releases_both_counters() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let owner = fixture.owner.insecure_clone();

    let ix = revoke_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
    );
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let account = session_account(&env, &session.session);
    assert!(account.revoked);
    assert_eq!(account.revoked_at, env.now());
    assert_eq!(env.treasury(&fixture.treasury).active_sessions, 0);
    assert_eq!(policy_account(&env, &policy).active_sessions, 0);

    let event: SessionRevoked = emitted_event(&result);
    assert_eq!(event.session, session.session);
    assert_eq!(event.by, owner.pubkey());
    assert_eq!(event.seq, 0);
    assert_eq!(event.audit_head, session.genesis_head);

    // Revocation is permanent; a second attempt must not double-decrement the counters.
    let ix = revoke_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::AlreadyRevoked);
    assert_eq!(env.treasury(&fixture.treasury).active_sessions, 0);
}

#[test]
fn revoke_session_rejects_a_stranger() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let stranger = env.keypair();

    let ix = revoke_session_ix(
        &env,
        &fixture.treasury,
        &stranger.pubkey(),
        &policy,
        &session.session,
    );
    assert_program_error(
        &env.execute(ix, &[&stranger]),
        AgentRailsError::Unauthorized,
    );
    assert!(!session_account(&env, &session.session).revoked);
}

#[test]
fn close_session_reclaims_rent_after_revocation_without_double_counting() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let owner = fixture.owner.insecure_clone();

    let ix = revoke_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
    );
    env.execute(ix, &[&owner]).assert_success();

    let rent_destination = env.unique_pubkey();
    let rent = env.lamports(&session.session);
    assert!(rent > 0);

    let ix = close_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
        &rent_destination,
    );
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    assert!(!account_exists(&env, &session.session));
    assert_eq!(env.lamports(&rent_destination), rent);

    // Revocation already released the counters; closing must not release them twice.
    assert_eq!(env.treasury(&fixture.treasury).active_sessions, 0);
    assert_eq!(policy_account(&env, &policy).active_sessions, 0);

    let event: SessionClosed = emitted_event(&result);
    assert_eq!(event.session, session.session);
    assert_eq!(event.audit_head, session.genesis_head);
}

#[test]
fn close_session_releases_the_counters_for_a_session_that_only_expired() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let owner = fixture.owner.insecure_clone();

    assert_eq!(env.treasury(&fixture.treasury).active_sessions, 1);
    env.warp_seconds(SESSION_TTL + 1);

    let rent_destination = env.unique_pubkey();
    let ix = close_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
        &rent_destination,
    );
    env.execute(ix, &[&owner]).assert_success();

    // Nothing revoked this one, so closing is what owes the decrement.
    assert_eq!(env.treasury(&fixture.treasury).active_sessions, 0);
    assert_eq!(policy_account(&env, &policy).active_sessions, 0);
}

#[test]
fn close_session_refuses_a_live_session() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let owner = fixture.owner.insecure_clone();
    let rent_destination = env.unique_pubkey();

    let ix = close_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
        &rent_destination,
    );
    assert_program_error(
        &env.execute(ix, &[&owner]),
        AgentRailsError::SessionStillActive,
    );
    assert!(account_exists(&env, &session.session));
}

// ---------------------------------------------------------------------------------------
// close_policy
// ---------------------------------------------------------------------------------------

#[test]
fn close_policy_reclaims_rent_and_decrements_the_treasury_count() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("temporary"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();
    assert_eq!(env.treasury(&fixture.treasury).policy_count, 1);

    let rent_destination = env.unique_pubkey();
    let rent = env.lamports(&policy);

    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &rent_destination,
    );
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    assert!(!account_exists(&env, &policy));
    assert_eq!(env.lamports(&rent_destination), rent);
    assert_eq!(env.treasury(&fixture.treasury).policy_count, 0);

    let event: PolicyClosed = emitted_event(&result);
    assert_eq!(event.policy, policy);
    assert_eq!(event.name, padded_name("temporary"));
}

#[test]
fn close_policy_refuses_while_a_session_is_live_and_allows_it_once_revoked() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("busy"),
        permissive_policy_args(mint),
    );
    let session = create_session(&mut env, &fixture, &policy, SESSION_TTL);
    let owner = fixture.owner.insecure_clone();
    let rent_destination = env.unique_pubkey();

    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &rent_destination,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::PolicyInUse);
    assert!(account_exists(&env, &policy));

    let ix = revoke_session_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &session.session,
    );
    env.execute(ix, &[&owner]).assert_success();

    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &rent_destination,
    );
    env.execute(ix, &[&owner]).assert_success();
    assert!(!account_exists(&env, &policy));
}

#[test]
fn close_policy_rejects_a_stranger() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let stranger = env.keypair();
    let rent_destination = env.unique_pubkey();

    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &stranger.pubkey(),
        &policy,
        &rent_destination,
    );
    assert_program_error(
        &env.execute(ix, &[&stranger]),
        AgentRailsError::Unauthorized,
    );
    assert!(account_exists(&env, &policy));
}

// ---------------------------------------------------------------------------------------
// add_allowlist_entry / remove_allowlist_entry
// ---------------------------------------------------------------------------------------

#[test]
fn add_allowlist_entry_writes_the_spec_layout() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let mut args = permissive_policy_args(mint);
    args.destination_mode = 1;
    let policy = create_policy(&mut env, &fixture, padded_name("listed"), args);

    let destination = env.unique_pubkey();
    let label = padded_name("openai-billing");
    let owner = fixture.owner.insecure_clone();
    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        destination,
        label,
        0,
    );
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    let (address, bump) = allowlist_pda(&policy, &destination);
    let entry = allowlist_account(&env, &address);
    assert_eq!(entry.version, agent_rails::constants::PROGRAM_VERSION);
    assert_eq!(entry.bump, bump);
    assert_eq!(entry.policy, policy);
    assert_eq!(entry.destination_owner, destination);
    assert_eq!(entry.label, label);
    assert_eq!(entry.per_tx_max_override, 0);
    assert_eq!(entry.added_at, env.now());
    assert_eq!(entry.added_by, owner.pubkey());
    assert_eq!(entry.reserved, [0u8; 32]);

    // Spec §3.4: 186 bytes, discriminator included.
    assert_eq!(env.account_data(&address).len(), 186);

    let event: AllowlistEntryAdded = emitted_event(&result);
    assert_eq!(event.policy, policy);
    assert_eq!(event.destination_owner, destination);
    assert_eq!(event.label, label);
}

#[test]
fn add_allowlist_entry_refuses_a_destination_the_treasury_controls() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();

    // All three would be self-payment loops: the treasury itself, its native SOL vault, and
    // the vault ATA for a configured mint.
    let vault = vault_ata(&fixture.treasury, &mint, &token_program_id());
    for forbidden in [fixture.treasury, fixture.sol_vault, vault] {
        let ix = add_allowlist_entry_ix(
            &env,
            &fixture.treasury,
            &owner.pubkey(),
            &policy,
            forbidden,
            padded_name("self"),
            0,
        );
        assert_program_error(
            &env.execute(ix, &[&owner]),
            AgentRailsError::SelfPaymentForbidden,
        );
    }
}

#[test]
fn an_allowlist_override_may_only_tighten() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let owner = fixture.owner.insecure_clone();
    let per_tx_max = policy_account(&env, &policy).mint_limits[0].per_tx_max;

    let destination = env.unique_pubkey();
    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        destination,
        padded_name("vendor"),
        per_tx_max + 1,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidLimit);

    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        destination,
        padded_name("vendor"),
        per_tx_max,
    );
    env.execute(ix, &[&owner]).assert_success();
}

#[test]
fn an_allowlist_override_is_bounded_by_the_tightest_mint_slot() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    add_native_mint(&mut env, &fixture, permissive_ceiling());

    // One entry covers every mint, so the bound has to be the *smallest* per-tx cap.
    // Bounding by the loosest slot would let an override raise the tightest one.
    let mut tight = permissive_limit_args(NATIVE_MINT);
    tight.per_tx_max = 1_000;
    let args = PolicyInput {
        mint_limits: vec![permissive_limit_args(mint), tight],
        destination_mode: 1,
        require_memo: false,
        create_destination_ata: false,
    };
    let policy = create_policy(&mut env, &fixture, padded_name("mixed"), args);
    let owner = fixture.owner.insecure_clone();
    let destination = env.unique_pubkey();

    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        destination,
        padded_name("vendor"),
        1_001,
    );
    assert_program_error(&env.execute(ix, &[&owner]), AgentRailsError::InvalidLimit);

    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        destination,
        padded_name("vendor"),
        1_000,
    );
    env.execute(ix, &[&owner]).assert_success();
}

#[test]
fn add_allowlist_entry_rejects_a_stranger_and_a_duplicate() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let stranger = env.keypair();
    let destination = env.unique_pubkey();

    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &stranger.pubkey(),
        &policy,
        destination,
        padded_name("vendor"),
        0,
    );
    assert_program_error(
        &env.execute(ix, &[&stranger]),
        AgentRailsError::Unauthorized,
    );

    add_allowlist_entry(&mut env, &fixture, &policy, destination, 0);
    let owner = fixture.owner.insecure_clone();
    let ix = add_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        destination,
        padded_name("vendor"),
        0,
    );
    env.execute(ix, &[&owner]).assert_failure();
}

#[test]
fn remove_allowlist_entry_reclaims_rent() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let destination = env.unique_pubkey();
    let entry = add_allowlist_entry(&mut env, &fixture, &policy, destination, 0);

    let owner = fixture.owner.insecure_clone();
    let rent_destination = env.unique_pubkey();
    let rent = env.lamports(&entry);

    let ix = remove_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &destination,
        &rent_destination,
    );
    let result = env.execute(ix, &[&owner]);
    result.assert_success();

    assert!(!account_exists(&env, &entry));
    assert_eq!(env.lamports(&rent_destination), rent);

    let event: AllowlistEntryRemoved = emitted_event(&result);
    assert_eq!(event.policy, policy);
    assert_eq!(event.destination_owner, destination);
}

#[test]
fn an_allowlist_entry_outlives_its_policy_and_is_still_reclaimable() {
    let mut env = Env::new();
    let (fixture, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &fixture,
        padded_name("doomed"),
        permissive_policy_args(mint),
    );
    let destination = env.unique_pubkey();
    let entry = add_allowlist_entry(&mut env, &fixture, &policy, destination, 0);
    let owner = fixture.owner.insecure_clone();
    let rent_destination = env.unique_pubkey();

    // `close_policy` cannot sweep entries — the program cannot enumerate PDAs — so closing
    // the policy strands this one. Its rent still has to be reclaimable afterwards, which
    // is the only reason `remove_allowlist_entry` takes an unchecked policy account.
    let ix = close_policy_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &rent_destination,
    );
    env.execute(ix, &[&owner]).assert_success();
    assert!(!account_exists(&env, &policy));
    assert!(account_exists(&env, &entry));

    let ix = remove_allowlist_entry_ix(
        &env,
        &fixture.treasury,
        &owner.pubkey(),
        &policy,
        &destination,
        &rent_destination,
    );
    env.execute(ix, &[&owner]).assert_success();
    assert!(!account_exists(&env, &entry));
}

#[test]
fn remove_allowlist_entry_refuses_an_entry_from_another_treasury() {
    let mut env = Env::new();
    let (first, mint) = treasury_with_mint(&mut env);
    let policy = create_policy(
        &mut env,
        &first,
        padded_name("p"),
        permissive_policy_args(mint),
    );
    let destination = env.unique_pubkey();
    add_allowlist_entry(&mut env, &first, &policy, destination, 0);

    // A second treasury whose owner tries to reclaim the first one's entry rent.
    let (second, _) = treasury_with_mint(&mut env);
    let intruder = second.owner.insecure_clone();
    let rent_destination = env.unique_pubkey();

    let ix = remove_allowlist_entry_ix(
        &env,
        &second.treasury,
        &intruder.pubkey(),
        &policy,
        &destination,
        &rent_destination,
    );
    assert_program_error(
        &env.execute(ix, &[&intruder]),
        AgentRailsError::Unauthorized,
    );
}
