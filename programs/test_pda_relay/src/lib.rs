//! Test-only fixture, never deployed anywhere but LiteSVM (ADR-014 verification).
//!
//! Exists to answer one narrow question without deploying the real Squads V4 program and
//! its full multisig/proposal/voting machinery: does `agent_rails::enable_native_allowance`
//! (and, by the same mechanism, every other `owner: Signer` instruction) accept a signature
//! that arrives via CPI from a program-owned PDA, the way Squads' and Realms' vault-execute
//! instructions do when a vault PDA "signs" on the multisig's behalf?
//!
//! A PDA has no private key, so it can never be a top-level transaction signer — the only
//! way it "signs" anything is a program that owns it calling `invoke_signed` with the
//! matching seeds, which the runtime accepts as equivalent to a real signature for the
//! duration of that CPI. This program does exactly that and nothing else: it re-signs
//! whatever instruction it's handed as its own PDA (seeds `[OWNER_SEED]`) and forwards it
//! unmodified. It carries no multisig logic, no member list, no proposals — those are
//! Squads/Realms business logic, orthogonal to the one thing actually being verified here:
//! that Agent Rails' account constraints have nothing that rejects a PDA in the `owner`
//! slot beyond the signature itself.
//!
//! Instruction data: `[bump: u8][target_program: 32 bytes][inner instruction data: rest]`.
//! Accounts: exactly the target instruction's account list, in its exact order, with index
//! 0 being this program's own PDA (`find_program_address(&[OWNER_SEED], program_id)`).

// `solana_program::entrypoint!` checks `cfg`s (`target_os = "solana"`, `feature =
// "custom-heap"`, ...) that only exist in a real SBF build; linting this crate for the host
// target (`cargo clippy` without `--target sbf-...`) trips `unexpected_cfgs` on the macro
// expansion itself, not on anything this crate wrote. Harmless — this program is only ever
// actually built with `cargo build-sbf`.
#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub const OWNER_SEED: &[u8] = b"owner";

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&bump, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    if rest.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (target_program_bytes, inner_data) = rest.split_at(32);
    let target_program = Pubkey::new_from_array(
        target_program_bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    let (pda_owner, _) = accounts
        .split_first()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let (expected_pda, _) = Pubkey::find_program_address(&[OWNER_SEED], program_id);
    if pda_owner.key != &expected_pda {
        return Err(ProgramError::InvalidArgument);
    }

    // Forward every account as the caller declared it (writability), signing only for
    // index 0 — our own PDA. Everything downstream of that is exactly what
    // `enable_native_allowance` would see from a real wallet signer.
    let metas: Vec<AccountMeta> = accounts
        .iter()
        .enumerate()
        .map(|(i, info)| AccountMeta {
            pubkey: *info.key,
            is_signer: i == 0,
            is_writable: info.is_writable,
        })
        .collect();

    let ix = Instruction {
        program_id: target_program,
        accounts: metas,
        data: inner_data.to_vec(),
    };

    invoke_signed(&ix, accounts, &[&[OWNER_SEED, &[bump]]])
}
