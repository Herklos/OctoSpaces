# OctoChat → `@drakkar.software/octospaces-sdk` Migration Plan

This document tracks the steps needed to adopt `octospaces-sdk` in OctoChat
(`/Users/user/Documents/dev/POC/OctoChat`). It covers the SDK package (`packages/sdk`),
the mobile app, and the sync server (`apps/server`).

The migration is gated on publishing `octospaces-sdk@0.1.0` to npm.

---

## 1. Server (apps/server) — REQUIRED FIRST

These server changes must ship **before** any client-side migration that creates public
spaces under `spaces/**`, because the current public-directory projection reads from
`pubspace` collection writes to `pubspaces/**`.

### 1a. Rebuild the public-space directory projection

File: `apps/server/src/projections.ts`

- The current hook fires on `pubspace` collection writes to `_rooms` under
  `pubspaces/{ownerId}/{spaceId}`.
- After the migration, public spaces write `_rooms` to the `rooms` collection under
  `spaces/{spaceId}`, with a `visibility:'public'` field.
- **Change**: add a second hook that fires on `rooms` collection writes where
  `docId === '_rooms'` and `body.visibility === 'public'`. Extract `body.name` and
  `body.image`; derive room count from subsequent `objindex` writes (count
  `type:'room'` nodes) or omit the count.
- Keep the old `pubspace` hook alive during the transition window (old clients still
  write there; new clients don't).

Mirror in `Infra/sync/server/drakkar_sync/apps/octochat/projections.py`.

### 1b. Retire pubspace/pubstream collections

Files: `apps/server/src/config.ts`, `Infra/sync/server/drakkar_sync/apps/octochat/collections.py`

- Once all active clients have migrated, deactivate the `pubspace`, `pubstream`, and
  `webhooks` collections (set `pullOnly: true` or remove their write roles).
- Leave them readable for a migration window so clients can recover old links.

### 1c. Optional: add `links[]` to `_rooms` for ghost-member hygiene

Files: `apps/server/src/space-role.ts`, `Infra/…/role_enricher.py`

- Add a separate `links: string[]` field to the `_rooms` doc alongside `members[]`.
- Grant `space:member` to identities in EITHER `members` OR `links`.
- This lets the SDK migrate link ids out of `members[]` (which affects profile fan-outs
  and member counts) without a breaking change to the role enricher.
- Timeline: do this before counting real member counts from `_rooms.members`.

---

## 2. OctoChat SDK (`packages/sdk`)

### 2a. Add `octospaces-sdk` dependency

```json
// packages/sdk/package.json
"dependencies": {
  "@drakkar.software/octospaces-sdk": "^0.1.0"
}
```

### 2b. Delete or redirect moved files

Files to **delete** (their replacements are in octospaces-sdk):

```
packages/sdk/src/starfish/member-caps.ts   → space-access-store
packages/sdk/src/starfish/space-encryptor.ts → space-access
packages/sdk/src/starfish/pubspace-caps.ts → space-access-store
packages/sdk/src/domain/paths.ts           → octospaces-sdk (partial — keep chat extensions)
packages/sdk/src/starfish/identity.ts      → octospaces-sdk (re-export Session)
packages/sdk/src/starfish/client.ts        → octospaces-sdk (keep chat-specific helpers)
packages/sdk/src/starfish/registry.ts      → octospaces-sdk (re-export + extend)
packages/sdk/src/starfish/members.ts       → octospaces-sdk (keep inviteToSpace if chat-specific)
packages/sdk/src/starfish/pubspace.ts      → octospaces-sdk (delete — full replacement)
```

### 2c. Extend `OctoChatConfig extends OctoSpacesConfig`

```ts
// packages/sdk/src/config/config.ts
import type { OctoSpacesConfig } from '@drakkar.software/octospaces-sdk';

export interface OctoChatConfig extends OctoSpacesConfig {
  /** Chat-specific extensions, e.g. streamsUrl, featuresUrl. */
}
```

### 2d. Re-export shared symbols

Preserve existing import paths for app code:
```ts
// packages/sdk/src/index.ts
export { buildSession, createSpace, readSpaces, … } from '@drakkar.software/octospaces-sdk';
```

### 2e. Add `dminbox` back to `accountScope`

`octospaces-sdk`'s `accountScope` deliberately omits `'dminbox'`. OctoChat must
re-add it:

```ts
// packages/sdk/src/domain/paths.ts (chat extension)
import { accountScope as baseAccountScope } from '@drakkar.software/octospaces-sdk';
import type { ScopePreset } from '@drakkar.software/starfish-identities';

export function accountScope(userId: string): ScopePreset {
  const base = baseAccountScope(userId);
  return {
    ...base,
    collections: [...base.collections!, 'dminbox'],
    paths: [...(base.paths ?? []), `dminbox/${userId}/**`],
  };
}
```

---

## 3. OctoChat app (`apps/mobile`)

### 3a. Wire `sharedSpacesNamespace`

```ts
// apps/mobile/src/lib/starfish/config.ts
configureOctoSpaces({
  syncBase: process.env.EXPO_PUBLIC_STARFISH_URL,
  syncNamespace: process.env.EXPO_PUBLIC_STARFISH_NAMESPACE,
  sharedSpacesNamespace: process.env.EXPO_PUBLIC_STARFISH_SHARED_SPACES_NAMESPACE,
});
```

### 3b. Switch registry calls to `spacesRegistryClient`

Any call site that does `session.accountClient` for `readSpaces` / `updateSpacesDoc`
must switch to `session.spacesRegistryClient`. Similarly for keyring ops:
`session.chatClient` → `session.spacesKeyringClient`.

### 3c. Replace `Space.type` with `Space.visibility`

Global search-replace in app code:
```
space.type === 'public'  →  space.visibility === 'public'
space.type === 'private' →  space.visibility !== 'public'
{ type: 'public' }       →  { visibility: 'public' }
```

### 3d. Replace pubspace call sites

| Old | New |
|---|---|
| `createPublicSpace(session, name)` | `createSpace(session, name, { visibility: 'public' })` |
| `createPublicInvite(session, spaceId, name, write, origin)` | `createSpaceInviteLink(session, spaceId, name, write, origin)` |
| `joinPublicSpace(session, token)` | `joinSpaceByLink(session, token)` |
| `recoverPubspaceAccess(session, pubAccess)` + `hydrateMemberCaps(...)` | `recoverSpaceAccess(session, { caps, pubAccess })` |
| `getPubspaceAccess(spaceId)` | `getSpaceAccessEntry(spaceId)` (check `.kind === 'link'`) |
| `publicSpaceClient(session, spaceId)` | `getSpaceAccess(spaceId, session, reg).client` |
| `updatePublicObjectIndex(session, spaceId, mutator)` | `updateObjectIndex(session, spaceId, mutator, reg)` |
| `readPublicIndexRooms(client, ownerId, spaceId)` | `readSpaceIndexRooms(session, spaceId, reg)` |
| `isPublicSpaceId(spaceId)` | `space.visibility === 'public'` (use the Space object) |
| `clearSpaceEncryptors()` | `clearSpaceAccessCache()` |
| `getSpaceEncryptor(spaceId, session, reg)` | `getSpaceAccess(spaceId, session, reg)` |
| `buildSpaceEncryptor(session, spaceId)` | `buildSpaceAccess(session, spaceId, hint)` |

### 3e. Satisfy the `Theme` superset contract

OctoChat's `theme.ts` must add the OctoVault-origin tokens before adopting
`octospaces-ui` primitives:
- `editorCanvas: string`
- `tooltipBg: string`
- `onTooltip: string`

These are already present in OctoVault's palette — copy the values or derive them.

### 3f. Wrap root in `OctoSpacesThemeProvider`

```tsx
import { OctoSpacesThemeProvider } from '@drakkar.software/octospaces-ui';
import { resolvedTheme } from '@/theme';

<OctoSpacesThemeProvider theme={resolvedTheme}>
  <RootNavigator />
</OctoSpacesThemeProvider>
```

Then replace `import { ... } from '@/components/ui'` with
`import { ... } from '@drakkar.software/octospaces-ui'` progressively.

---

## 4. Infra

### 4a. Add a `shared` namespace app

File: `Infra/sync/server/drakkar_sync/server.py`

Mount a new `drakkar_sync/apps/shared/` app at `/v1/shared`:
- Collections: `spaces`, `rooms`, `chatkeyring` only (no `objindex` etc. — space index
  data is in each app's own namespace).
- Role enricher: reuse `make_space_role_enricher` + `make_pubspace_role_enricher`.
- This is what `sharedSpacesNamespace` points to for cross-app space registry sharing.

---

## Summary checklist

- [ ] **Server**: rebuild projection for `rooms` collection `_rooms` writes with `visibility:'public'`
- [ ] **Server**: (later) retire `pubspace`/`pubstream` collections
- [ ] **SDK**: add `octospaces-sdk` dep; delete replaced files; re-export + extend
- [ ] **App**: wire `sharedSpacesNamespace`; swap registry call sites
- [ ] **App**: `Space.type` → `Space.visibility` global search-replace
- [ ] **App**: replace pubspace call sites per the table above
- [ ] **App** (optional): adopt `octospaces-ui` primitives after theme contract satisfied
- [ ] **Infra**: add `shared` namespace app
