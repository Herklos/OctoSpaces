# octospaces

## Repo layout
- `packages/ts/octospaces-sdk` — headless TS SDK (published as `@drakkar.software/octospaces-sdk`)
- `packages/ts/octospaces-ui` — React UI components
- `apps/server` — local dev server mirroring Infra octospaces backend
- Consumer repos: `POC/OctoVault` and `POC/OctoChat` at `/Users/user/Documents/dev/POC/`

## Running tests (SDK)
```bash
# From the package dir
cd packages/ts/octospaces-sdk && pnpm test
# Single file
cd packages/ts/octospaces-sdk && pnpm test src/spaces/members.keyring.test.ts
```

## Vitest mock gotcha
`vi.mock()` factories are hoisted — never reference module-level `const mockFn = vi.fn()` inside a factory.
Define `vi.fn()` directly in the factory; access the mock via `vi.mocked(<import>)` in test bodies.

## Version bumping workflow
1. Bump `packages/ts/octospaces-sdk/package.json` version
2. Update `CHANGELOG.md`
3. Commit + push octospaces
4. Update `packages/sdk/package.json` in OctoVault and OctoChat consumer repos
5. Commit + push both consumer repos

## Key architecture invariants
- **E2EE**: server NEVER seals/unseals content — all collections are `none` or `delegated`
- **Keyring invite ordering**: `ownerEnsureKeyring` MUST be called before `addCollectionRecipient` in `inviteToSpace` / `createSpaceInviteLink` — ensures the keyring exists before the member is added as a recipient
- **Device pairing**: `addDeviceToSpaceKeyring` must NOT call `ownerEnsureKeyring` (device is not the owner; skip-if-absent is the correct behavior)
- **`isKeyringMissing` regex**: `/not found|404|does not exist|no keyring exists/i`
- **SSE topic budget**: `_MAX_AUTHORIZED_SPACES = _MAX_CANDIDATES // 2` because `topic_mapper` emits 2 Whistler topics per space (`object.changed` + `log.changed`)

## Related repos
- `Infra/sync` — Python Starfish backend; `apps/octospaces/` is the sole namespace app
- `POC/OctoVault` — OctoVault consumer (namespace `octospaces`, SDK pinned)
- `POC/OctoChat` — OctoChat consumer (namespace `octospaces`, SDK `^0.8.x`)
- Cross-language vectors: `tests/test-vectors/` — update when adding path helpers or changing cap scopes
