# octospaces

## Repo layout
- `packages/ts/octospaces-sdk` — headless TS SDK (published as `@drakkar.software/octospaces-sdk`)
- `packages/ts/octospaces-ui` — React UI components
- `apps/server` — local dev server mirroring Infra octospaces backend
- Consumer repos: `Drakkar-Software/OctoVault` and `Drakkar-Software/OctoChat` (not cloned by default — `gh repo clone` to get them)

## Running tests (SDK)
```bash
# From package dir — vitest not in PATH from root
cd packages/ts/octospaces-sdk && /Users/user/Documents/dev/Drakkar-Software/octospaces/node_modules/.bin/vitest run
# Single file
cd packages/ts/octospaces-sdk && /Users/user/Documents/dev/Drakkar-Software/octospaces/node_modules/.bin/vitest run src/spaces/members.keyring.test.ts
```
`pnpm --filter octospaces-sdk exec vitest run <abs-path>` does NOT work — use package-relative path from within the package dir.

## Vitest mock gotcha
`vi.mock()` factories are hoisted — never reference module-level `const mockFn = vi.fn()` inside a factory.
Define `vi.fn()` directly in the factory; access the mock via `vi.mocked(<import>)` in test bodies.

## Worktree isolation
Agents running in `.claude/worktrees/<id>/` cannot Write/Edit files outside the worktree.
To copy a file to the main repo from a worktree: `cp <worktree-path>/file <main-repo-path>/file` via Bash (bypasses the guard).
Worktrees do NOT have node_modules — point to `<main-repo>/node_modules/.bin/<tool>` directly.

## Version bumping workflow
1. Bump `packages/ts/octospaces-sdk/package.json` version
2. Commit + push octospaces
3. Update `packages/sdk/package.json` in OctoVault (pinned, not semver range) and OctoChat
4. Commit + push both consumer repos

## Key architecture invariants
- `ownerEnsureKeyring` must be called BEFORE `addCollectionRecipient` in invite/link flows
- `isKeyringMissing` regex: `/not found|404|does not exist|no keyring exists/i`
- `addDeviceToSpaceKeyring` must NOT call `ownerEnsureKeyring` (device pairing ≠ owner flow)
- Server never seals/unseals — all collections are `none` or `delegated`
- `_MAX_AUTHORIZED_SPACES = _MAX_CANDIDATES // 2` (2 Whistler topics per space)
