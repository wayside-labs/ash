//! One module per instruction (spec §5). Each owns its `Accounts` struct and handler; the
//! `#[program]` module in `lib.rs` is only a dispatch table.

pub mod add_allowlist_entry;
pub mod add_guardian;
pub mod add_mint;
pub mod close_policy;
pub mod close_receipt;
pub mod close_session;
pub mod close_treasury;
pub mod create_policy;
pub mod create_session;
pub mod create_treasury;
pub mod execute_payment;
pub mod execute_payment_sol;
pub mod pause;
pub mod payment;
pub mod policy;
pub mod remove_allowlist_entry;
pub mod remove_guardian;
pub mod remove_mint;
pub mod revoke_session;
pub mod set_ceiling;
pub mod set_roles;
pub mod unpause;
pub mod update_policy;
pub mod withdraw;

// Glob re-exports are required, not stylistic: `#[program]` resolves the
// `__client_accounts_*` and `__cpi_client_accounts_*` modules that `#[derive(Accounts)]`
// generates through the crate root. Handlers are named per instruction so the globs stay
// unambiguous.
pub use add_allowlist_entry::*;
pub use add_guardian::*;
pub use add_mint::*;
pub use close_policy::*;
pub use close_receipt::*;
pub use close_session::*;
pub use close_treasury::*;
pub use create_policy::*;
pub use create_session::*;
pub use create_treasury::*;
pub use execute_payment::*;
pub use execute_payment_sol::*;
pub use pause::*;
pub use remove_allowlist_entry::*;
pub use remove_guardian::*;
pub use remove_mint::*;
pub use revoke_session::*;
pub use set_ceiling::*;
pub use set_roles::*;
pub use unpause::*;
pub use update_policy::*;
pub use withdraw::*;
