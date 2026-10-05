//! Input shapes that several instructions share.

use anchor_lang::prelude::*;

use crate::constants::MAX_NAME_LEN;
use crate::error::AshError;

/// Checks a 32-byte zero-padded UTF-8 name or label (spec §1, `MAX_NAME_LEN`).
///
/// Three rules, and each one is load-bearing. Non-empty, because `Policy.name` is a PDA
/// seed and an all-zero name would give every treasury one unnameable policy slot. No
/// interior NUL followed by non-zero bytes, because two encodings of the same displayed
/// string would derive two different PDAs. Valid UTF-8, because the CLI and the indexer
/// render these directly and a lossy decode would show an operator a name that is not the
/// one the seeds committed to.
pub fn validate_padded_name(name: &[u8; MAX_NAME_LEN]) -> Result<()> {
    let len = name
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(MAX_NAME_LEN);
    require!(len > 0, AshError::InvalidName);
    require!(
        name[len..].iter().all(|byte| *byte == 0),
        AshError::InvalidName
    );
    require!(
        core::str::from_utf8(&name[..len]).is_ok(),
        AshError::InvalidName
    );
    Ok(())
}
