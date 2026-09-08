//! One module per instruction (spec §5). Each owns its `Accounts` struct and handler; the
//! `#[program]` module in `lib.rs` is only a dispatch table.

pub mod add_mint;
pub mod create_treasury;

// Glob re-exports are required, not stylistic: `#[program]` resolves the
// `__client_accounts_*` and `__cpi_client_accounts_*` modules that `#[derive(Accounts)]`
// generates through the crate root. Handlers are named per instruction so the globs stay
// unambiguous.
pub use add_mint::*;
pub use create_treasury::*;
