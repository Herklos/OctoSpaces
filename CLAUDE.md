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
2. **Update `CHANGELOG.md`** in the package with the new version, date, and a summary of changes — this is REQUIRED before every release
3. Commit + push octospaces
4. Update `packages/sdk/package.json` in OctoVault (pinned, not semver range) and OctoChat
5. Commit + push both consumer repos

> **Rule:** Any version bump in `packages/*` MUST include a CHANGELOG entry in the same commit. No exceptions.

## Key architecture invariants
- `ownerEnsureKeyring` must be called BEFORE `addCollectionRecipient` in invite/link flows
- `isKeyringMissing` regex: `/not found|404|does not exist|no keyring exists/i`
- `addDeviceToSpaceKeyring` must NOT call `ownerEnsureKeyring` (device pairing ≠ owner flow)
- Server never seals/unseals — all collections are `none` or `delegated`
- `_MAX_AUTHORIZED_SPACES = _MAX_CANDIDATES // 2` (2 Whistler topics per space)

## Key security invariants (enforced in code)
- `acceptResourceRequest` MUST call `inviteToNode` with `{ isolated: true }` — otherwise requesters receive space-wide caps
- `inviteToSpace` / `inviteToNode` / `scanResourceRequests` MUST verify `userId === await userIdFromEdPub(edPub)` before trusting a requester's userId
- `inviteToSpace` / `inviteToNode` / `scanResourceRequests` MUST verify `kemSig` (Ed25519 sig of kemPub by edPriv) before using kemPub — prevents MITM kemPub substitution
- Pairing rendezvous push MUST be hash-guarded (pull baseHash first); slot MUST be cleared after `completeDevicePairing`
- Identity links are v:2 — kemPub is signed by edPriv (`kemSig`); `verifyIdentityLinkBinding` verifies BOTH ownerId and kemSig offline
- Inbox seals use AES-GCM AAD = `octospaces:inbox:v1:${recipientUserId}:${shard}:${kind}`; resource-request/grant/reject must pass this context (shard-bound since 0.12.9, kind-bound since 0.13). The legacy shard-only fallback was dropped in 0.14 — every accepted inbox item MUST be kind-bound (the inbox is a 500-item monthly-sharded ring buffer, so pre-0.13 items have long since evicted)
- `removeNodeKeyringRecipient` is **rotate-only** (forward secrecy). For full eviction use `revokeNodeAccess(session, spaceId, nodeId, userId)` from `spaces/nodes.ts` which calls `evictMember` (keyring rotation + cap revocation via POST /revocations)
- `inviteToNode(isolated+enc)` auto-stores cap nonces in `nodeInviteStore`; `revokeNodeAccess` reads from it — do NOT use `revokeNodeAccess` without a prior `inviteToNode` or `saveNodeInviteEntry` call. `nodeInviteStore` is in-memory; call `serializeNodeInviteStore()` to persist and `hydrateNodeInviteStore(entries)` to restore on startup.
- `NodeInviteBundle.kind` MUST be a valid `NodeInviteKind` ('plaintext' | 'space-enc' | 'node-enc'); `acceptNodeInvite` rejects unknown kinds
- `removeSpaceMember` is **roster-only** — it does NOT rotate the keyring or revoke caps, so for `enc` spaces an evicted member keeps the CEK. For full space-tier eviction use `revokeSpaceAccess(session, spaceId, userId)` from `spaces/members.ts` (mirrors `revokeNodeAccess`): `evictMember` on `keyringName(spaceId)` (rotate + revoke cap) THEN `removeSpaceMember`. `inviteToSpace` / `createSpaceInviteLink` auto-store `{edPub, kemPub, cap nonce}` in the in-memory `spaceInviteStore` — do NOT call `revokeSpaceAccess` without a prior invite or `saveSpaceInviteEntry`; persist with `serializeSpaceInviteStore()` / `hydrateSpaceInviteStore()`
- `scanResourceGrants` enforces grant **sender authenticity**: it requires `payload.sealed.entry.addedBy === reqIdOwnerStore.get(reqId)` before accepting (or burning) a grant. The requester records `reqId → ownerEdPub` via `saveReqIdOwner` (auto-called by `submitResourceRequest`); persist with `serializeReqIdOwnerStore()` / `hydrateReqIdOwnerStore()`. A grant from an unexpected sender is dropped WITHOUT burning the reqId
- `_MAX_AUTHORIZED_SPACES = _MAX_CANDIDATES // 2` lives in the Infra Python backend (not in this repo) — do not hunt for it here
