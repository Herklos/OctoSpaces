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
  spacesNamespace: process.env.EXPO_PUBLIC_STARFISH_SPACES_NAMESPACE,
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

## 4. Data migration: stored data → ObjectNode tree

### 4.0 — Private spaces: nothing to convert

OctoChat private rooms, categories, pages, tasks, etc. are already `ObjectNode`s stored in the
encrypted `spaces/{spaceId}/objects/_index` doc. The `octospaces-sdk` reads the same doc shape
(`{ objects: ObjectNode[] }`). **No data migration needed for private spaces.**

### 4.1 — Keep bespoke (do not convert)

| Data | Why it stays bespoke |
|---|---|
| Chat messages / reactions / edits / pins | `streams/{roomId}` append-log; `contentKind:'append'` — **never** fold into the node tree |
| `dminbox` delivery docs | DM delivery queue; OctoChat-specific scope |
| `_spaces` SpacesDoc | Account-level registry — not object-tree content |
| `_rooms` ACL doc `{v, owner, members, name, image}` | Access control record; same storage path |
| Profile, devices, keyring | Identity/auth data — outside object tree |

Chat messages are append-only logs keyed by the room node's `id` (`streams/{roomId}`). They carry
`contentKind:'append'` on the room `ObjectNode` — the log stays separate from the node tree by
design. **Do not convert messages to object nodes.**

### 4.2 — Public spaces: relocate node index + streams

Public-space content is already `ObjectNode`s at the old paths:

```
pubspaces/{ownerId}/{spaceId}/objects/_index     ← OLD (pubobjindex)
pubspaces/{ownerId}/{spaceId}/streams/{roomId}   ← OLD (message append-logs)
```

The unified-spaces SDK reads from the new paths:

```
spaces/{spaceId}/objects/_index                  ← NEW
spaces/{spaceId}/streams/{roomId}                ← NEW
```

**Decide first:** dev-only spaces → abandon (wipe `pubspaces/` namespace, clean break).
Production spaces with real content → run the relocate below.

**Relocate recipe** (run once per owner, with that owner's session):

```ts
import { updateObjectIndex, readSpaceIndexRooms } from '@drakkar.software/octospaces-sdk';

for (const entry of await listPublicSpaces(ownerId)) {
  const { spaceId, name, image } = entry;

  // 1. Read old plaintext index doc verbatim (nodes already correct shape)
  const oldIndex = await readPubObjIndex(ownerId, spaceId); // { objects: ObjectNode[] }

  // 2. Write verbatim to new path (encryptor null = plaintext)
  await updateObjectIndex(session, spaceId, () => oldIndex, reg);

  // 3. Synthesize the new _rooms access record
  await writeSpaceAccess(reg.client, spaceId, {
    v: 1, owner: ownerId, members: [], visibility: 'public', name, image,
  });

  // 4. Relocate message streams (or accept history loss for public spaces)
  for (const roomNode of oldIndex.objects.filter(n => n.type === 'room')) {
    // copy  pubspaces/{ownerId}/{spaceId}/streams/{roomId}
    //   →   spaces/{spaceId}/streams/{roomId}  (append-only log, unchanged shape)
    await relocateStream(ownerId, spaceId, roomNode.id);
  }
}

// Verify: relocated index reads back correctly with room nodes intact
await readSpaceIndexRooms(session, spaceId, reg);
```

Stream relocation is optional — if message history in public spaces is acceptable to lose, skip
step 4 and wipe `pubspaces/` after the index relocate.

> **Note:** keep the old `pubspace`/`pubstream` collection hooks alive in the server projection
> during the transition window (old clients still write there). See section 1a.

---

## 5. Infra

### 5a. Add a `spaces` namespace app

File: `Infra/sync/server/drakkar_sync/server.py`

Mount `drakkar_sync/apps/spaces/` at `/v1/spaces`:
- Collections: `spaces`, `rooms`, `chatkeyring`, `spaceindex` only (no `objindex` etc. — space
  index data lives in each app's own namespace).
- Role enricher: `make_space_role_enricher` (reads `spaces/{spaceId}/_rooms`).
- Projection plugin: watches `rooms` writes with `visibility:'public'` → upserts into
  `_index/spaces/public` (supplements the legacy `pubspace` hook during the migration window).
- This is what `spacesNamespace` points to for cross-app space registry sharing.

---

## Summary checklist

- [ ] **Server**: rebuild projection for `rooms` collection `_rooms` writes with `visibility:'public'`
- [ ] **Server**: (later) retire `pubspace`/`pubstream` collections
- [ ] **SDK**: add `octospaces-sdk` dep; delete replaced files; re-export + extend
- [ ] **App**: wire `sharedSpacesNamespace`; swap registry call sites
- [ ] **App**: `Space.type` → `Space.visibility` global search-replace
- [ ] **App**: replace pubspace call sites per the table above
- [ ] **App** (optional): adopt `octospaces-ui` primitives after theme contract satisfied
- [ ] **Data migration**: for public spaces — relocate `pubobjindex` to `spaces/{spaceId}/objects/_index` (nodes already correct shape); relocate `pubstream` logs to `spaces/{spaceId}/streams/{roomId}` or accept history loss; synthesize `_rooms` with `visibility:'public'`. For private spaces: nothing to convert (already ObjectNodes).
- [ ] **Infra**: add `spaces` namespace app at `/v1/spaces`
