# Changesets

ADR-011 asks for independent semver per package with `@agent-rails/contract` as the
compatibility anchor, which is what this directory implements.

A pull request that changes anything a consumer can observe carries a changeset:

```bash
pnpm changeset            # pick packages, pick bump, write the line a user will read
```

The release workflow (`.github/workflows/release.yml`) consumes the accumulated files,
bumps versions, writes CHANGELOGs and opens the release pull request. Merging that pull
request is the act that publishes.

Two packages are ignored on purpose: `@agent-rails/dashboard` is an application and
`@agent-rails/e2e` is a test suite. Neither is something anyone installs.

**Everything here is `0.x` and unaudited.** Semver under `0.x` promises nothing about
breakage between minors, and the README says so where a user will see it before installing.
