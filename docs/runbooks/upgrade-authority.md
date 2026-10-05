# Runbook — moving the upgrade authority off CI

**Decision:** ADR-020. **Scope:** devnet, program `4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS`.

One transaction, no code change. What it buys: the `DEVNET_KEYPAIR` repository secret stops
being able to replace the program.

**Done on 2026-09-25.** Upgrade authority is now
`F2zW3818bfDpAapLo9Z9mgfttYjkkK23JAnkpnWNcSmP`, held offline at
`~/.config/solana/ash-upgrade.json` (never in the repo or in GitHub secrets). The CI key
`5eznzq18xdeVaagEkyo7DYb8v12mAWmYcz6AdWTnH8JQ` still pays for smokes only — run step 3 with
`devnet-ci-keypair.json` and confirm the line does **not** say `(this wallet)`.

> **Why not `Fg1TX…`?** That address is the operator's Phantom wallet on devnet — no keypair file
> was available on disk, and ADR-020 requires the checked transfer (both keys sign). A dedicated
> offline key was generated instead. To move authority to Phantom later, export the wallet to a
> local keypair file and run another `set-upgrade-authority` from the current holder.

> An agent cannot run any of this, and should not try. `.claude/hooks/guard.sh` denies the
> transfer command outright, for the reason that matters: nothing in CI sits between it and a
> program holding custody. The rule matches on command text, so it also fires on any shell
> command that merely *contains* the example in step 2. That is the guard being blunt in the
> safe direction, and this file was written with an editor rather than a shell because of it.

---

## 0. Before you start

You need the current authority keypair — `devnet-ci-keypair.json`, which is gitignored and
lives only on the maintainer's machine — and somewhere private to write twelve words down.

## 1. Generate the new authority

```bash
solana-keygen new -o ~/.config/solana/ash-upgrade.json
solana-keygen pubkey ~/.config/solana/ash-upgrade.json
```

**Write the seed phrase on paper before continuing.** Losing this key does not lose money; it
freezes the program at the bytes it currently holds, and the only way forward is a new program
id — `declare_id!`, `Anchor.toml`, the IDL, `pnpm codegen`, a redeploy at ~3.55 SOL of
programdata rent, and every manifest that names the old id. ADR-020 spells out why the backup
is part of the decision rather than an operational nicety.

The file must not go into `.ash/`, into the repository, or into a GitHub secret.

## 2. Transfer

```bash
solana program set-upgrade-authority 4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS \
  --url devnet \
  --upgrade-authority devnet-ci-keypair.json \
  --new-upgrade-authority ~/.config/solana/ash-upgrade.json
```

Pass the **file**, not the pubkey. Both keys then sign and the loader runs
`SetAuthorityChecked`, which is what makes a typo impossible to act on. The flag that accepts a
bare pubkey — `--skip-new-upgrade-authority-signer-check` — saves one signature and, on a
mistyped address, hands the authority to a key nobody holds. Do not use it here.

Check the flags against your own CLI first: they have moved between Agave releases.

## 3. Verify with our own tooling

```bash
pnpm ash doctor --rpc https://api.devnet.solana.com --wallet devnet-ci-keypair.json
```

The line must read:

```
✔ Upgrade authority   <the new pubkey>
```

If it still says `(this wallet)`, the transfer did not happen. That check reads the loader's
`ProgramData` account directly (`packages/cli/src/chain/upgrade-authority.ts`), so it cannot
agree with a transfer that did not land.

## 4. Record it

- Mark this runbook done, with the date and the new pubkey.
- The README's trust-phase table already points at the `doctor` command rather than naming a
  key, so nothing there goes stale.

## What does not change

Nothing in CI. `release-tag.yml` builds, hashes and pays for the devnet smoke; `e2e.yml` reads
the key's balance as a preflight. Neither upgrades anything, so neither notices. The CI key
keeps paying for smokes and keeps owning the throwaway treasuries each smoke creates.

## If the key is later compromised

Transfer again, from the current authority to a fresh one, with the same two steps. A
compromise is cheap to fix; a loss is not, which is the asymmetry step 1 is about.
