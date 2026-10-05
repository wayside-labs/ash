# @ash/client

100% Codama-generated. Nothing here is hand-written except `src/index.ts`, which re-exports
the generated barrel, and `src/index.test.ts`.

## Never edit src/generated

`pnpm codegen:check` in CI regenerates from the committed IDL and fails on any difference,
so a hand edit is reverted with a red build rather than kept. A `PreToolUse` hook denies
the write before it happens. Both exist because the failure mode is quiet: the edit works
locally until the next `pnpm codegen` erases it.

To change what is generated, change the input — the program (then `pnpm idl:build`) or
`codama.json` — and regenerate.

## Configuration that looks removable and is not

**`importExtension: "js"` in `codama.json`.** Codama otherwise emits extensionless relative
specifiers (`export * from "./accounts"`), which `moduleResolution: "nodenext"` rejects.
The failure is invisible from inside this package, because `include: ["src"]` pulls every
file into the program directly and nothing has to resolve. Seen from sdk and mcp, which
consume this package through the `types` condition, the barrel fails to resolve and every
symbol re-exported through it looks absent — 7 errors here once produced 77 there, all
reading "@ash/client has no exported member".

**`dts: false` with `types` pointing at `src/generated/index.ts`.** Consumers typecheck
against the generated source rather than an emitted `.d.ts`. That is deliberate: the
declaration build of this much generated code is slow and buys nothing when the source
ships anyway. It does mean errors in generated code surface in *every* consumer's
`tsc --noEmit`, which is the intended behaviour, not a leak.

**`@solana/program-client-core` must track `@solana/kit`.** `@solana/kit` bundles its own
copy of that package. Declaring a different major here puts two copies in the tree, and two
copies means two sets of nominal brands: the `ClientWithRpc<T>` the generated plugin
imports stops unifying with the client kit hands it, and `ashProgram()` becomes
untypeable for reasons no renderer setting can fix. Bump the two together.

## Upgrading the renderer

`@codama/renderers-js` 2.5.0 generates against a `@solana/program-client-core` v8 API. It
is not a drop-in on a v6/kit-8.2 tree — the attempt produced 97 errors where there had been
5. Treat a renderer bump as a coordinated kit upgrade, and regenerate plus typecheck before
committing either.
