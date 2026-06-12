# OctoVault → `@drakkar.software/octospaces-sdk` Migration Plan

This document tracks the steps needed to adopt `octospaces-sdk` in OctoVault.
OctoVault is the origin of the `octospaces-ui` `Theme` / `Palette` contract, so several
primitives already match exactly.

The migration is gated on publishing `octospaces-sdk@0.1.0` and `octospaces-ui@0.1.0` to npm.

---

## 1. Bump starfish alpha

OctoVault currently pins `@drakkar.software/starfish-*` at `3.0.0-alpha.26`.
`octospaces-sdk` requires `>=3.0.0-alpha.27`.

```sh
# In the OctoVault repo root
pnpm up "@drakkar.software/starfish-*@3.0.0-alpha.27"
```

Breaking changes from alpha.26 → alpha.27 (carry over to OctoVault):

- `ScopePreset.paths` is now optional (`string[] | undefined`).  
  Any manual `scope.paths.some(...)` call must be guarded: `(scope.paths ?? []).some(...)`.
- `StarfishClient` constructor now accepts an optional `encryption` parameter
  (`'delegated'` is the unchanged default; no call-site change needed if not passed).
- `usersFromEdPubs` renamed to `userIdFromEdPub` (singular — returns one userId).  
  OctoVault bot/webhook code that calls the old name must be updated.

---

## 2. Add `octospaces-sdk` + `octospaces-ui` dependencies

```json
// package.json (or the equivalent packages/* manifest)
"dependencies": {
  "@drakkar.software/octospaces-sdk": "^0.1.0",
  "@drakkar.software/octospaces-ui": "^0.1.0"
}
```

---

## 3. Delete or redirect moved files

Files to **delete** (direct equivalents in octospaces-sdk):

```
src/starfish/member-caps.ts       → space-access-store
src/starfish/space-encryptor.ts   → space-access
src/starfish/pubspace-caps.ts     → space-access-store
src/starfish/paths.ts             → octospaces-sdk (partial — keep vault extensions)
src/starfish/identity.ts          → octospaces-sdk (re-export Session)
src/starfish/client.ts            → octospaces-sdk (keep vault-specific helpers)
src/starfish/registry.ts          → octospaces-sdk (re-export + extend)
src/starfish/members.ts           → octospaces-sdk (keep vault-specific overrides)
src/starfish/pubspace.ts          → octospaces-sdk (delete — full replacement)
src/objects/tree.ts               → octospaces-sdk (re-export buildTree etc.)
```

---

## 4. Configuration

```ts
// src/lib/starfish/config.ts (or equivalent boot file)
import { configureOctoSpaces } from '@drakkar.software/octospaces-sdk';

configureOctoSpaces({
  syncBase:  process.env.NEXT_PUBLIC_STARFISH_URL,
  syncNamespace: process.env.NEXT_PUBLIC_STARFISH_NAMESPACE,
  // Optional — set to share space registry with OctoChat (points to /v1/spaces)
  spacesNamespace: process.env.NEXT_PUBLIC_STARFISH_SPACES_NAMESPACE,
});
```

---

## 5. Re-export shared symbols

Preserve existing import paths for page/component code:

```ts
// src/lib/starfish/index.ts
export {
  buildSession, buildLinkedSession,
  createSpace, readSpaces, updateSpacesDoc,
  SpaceVisibility,
  SpaceAccessHandle, getSpaceAccess, buildSpaceAccess, clearSpaceAccessCache,
  SpaceAccessEntry, getSpaceAccessEntry, saveSpaceAccessEntry,
  recoverSpaceAccess,
  createSpaceInviteLink, joinSpaceByLink, decodeSpaceInviteLink,
  removeSpaceMember,
  updateObjectIndex, readSpaceIndexRooms, readSpaceRooms,
  buildTree, addObject, patchObject, reparentObject,
} from '@drakkar.software/octospaces-sdk';
```

---

## 6. Replace `Space.type` with `Space.visibility`

OctoVault had the same `type` field on `Space`. Global search-replace:

```
space.type === 'public'  →  space.visibility === 'public'
space.type === 'private' →  space.visibility !== 'public'
{ type: 'public' }       →  { visibility: 'public' }
Space['type']            →  Space['visibility']
```

---

## 7. Replace pubspace call sites

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
| `isPublicSpaceId(spaceId)` | `space.visibility === 'public'` |
| `clearSpaceEncryptors()` | `clearSpaceAccessCache()` |
| `getSpaceEncryptor(spaceId, session, reg)` | `getSpaceAccess(spaceId, session, reg)` |
| `buildSpaceEncryptor(session, spaceId)` | `buildSpaceAccess(session, spaceId, hint)` |

---

## 8. Path extensions

`octospaces-sdk`'s `accountScope` does not include vault-specific collections.
Extend it in the vault's own path module:

```ts
// src/lib/starfish/paths.ts (vault extension)
import { accountScope as baseAccountScope } from '@drakkar.software/octospaces-sdk';
import type { ScopePreset } from '@drakkar.software/starfish-identities';

export function accountScope(userId: string): ScopePreset {
  const base = baseAccountScope(userId);
  return {
    ...base,
    // Add vault-specific collections here, e.g. 'vaultblob', 'vaultsecrets'
    collections: [...base.collections!],
    paths: [...(base.paths ?? [])],
  };
}
```

---

## 9. Adopt `octospaces-ui` theme provider

OctoVault's `Palette` is the **origin** of the `octospaces-ui` `Palette` interface (the
`editorCanvas`, `tooltipBg`, `onTooltip` tokens were added to cover vault-specific needs).
The vault's existing theme object already satisfies the contract — no token additions needed.

```tsx
// src/app/layout.tsx (or equivalent root)
import { OctoSpacesThemeProvider } from '@drakkar.software/octospaces-ui';
import { resolvedTheme } from '@/theme';

export default function RootLayout({ children }) {
  return (
    <OctoSpacesThemeProvider theme={resolvedTheme}>
      {children}
    </OctoSpacesThemeProvider>
  );
}
```

Then migrate component imports progressively:
```ts
// Before
import { presenceColor, avatarTint } from '@/lib/theme/helpers';
// After
import { presenceColor, avatarTint } from '@drakkar.software/octospaces-ui';
```

---

## 10. Platform adapter (if using React Native build target)

```ts
// index.native.ts
import '@drakkar.software/octospaces-sdk/platform';
```

This installs `react-native-quick-crypto` in place of WebCrypto for native builds.
Peer: `react-native-quick-crypto >=0.7`.

---

## 11. Data migration: stored data → ObjectNode tree

> OctoVault is a **knowledge app**, not a chat app — its room/channel machinery is vestigial
> residue from the OctoChat lineage. No room or message data needs migrating. The real content
> — pages, boards, tasks, files — is already `ObjectNode`-shaped everywhere.

### 11.0 — Rooms and categories: REMOVED, not migrated

As part of adopting `octospaces-sdk`, the OctoVault SDK removes rooms and categories entirely
from its data model:

- `type:'room'` and `type:'category'` are deleted from `BuiltinObjectType`.
- `Room`, `RoomKind`, `RoomSubtype`, `ObjectNode.subtype`, `objectsToRoomCategories`, `categoryId`,
  `DEFAULT_CATEGORY`, `seedIndexNodes` room/category seeding, and dead chat types
  (`Message`/`Thread`/`Reaction`) are removed from the OctoVault SDK.
- The **automation** concept (previously `type:'room' + subtype:'automation'`) is promoted to a
  first-class `type:'automation'` — the `AutomationMeta` config and stream-bot transport are kept
  unchanged.
- Generic room-named infra (space-open hooks, registry provider, live-sync event bus,
  access-record read/write) is **renamed** to space/doc names — it was always generic, just
  misleadingly named from the OctoChat lineage.
- The `_rooms` storage leaf and `spaceregistry` server collection stay **byte-compatible** — only
  TypeScript symbol names change.

New private spaces land directly on the "Write your first page" empty state; no general/channel
room is seeded.

### 11.1 — Private spaces: nothing to convert

OctoVault pages, boards, tasks, files, and folders are already `ObjectNode`s stored in the
encrypted `spaces/{spaceId}/objects/_index` doc. The `octospaces-sdk` reads the same doc shape
(`{ objects: ObjectNode[] }`). **No data migration needed for private spaces.**

Vestigial `general` room + `cat-channels` category nodes that exist in live spaces are tolerated
by `buildTree` (which reparents orphans to root) and hidden by `showsInWorkTree`. A lazy cleanup
helper (`stripRoomNodes`) strips them on the next index write — no forced migration pass required.

### 11.2 — Keep bespoke (do not convert)

| Data | Why it stays bespoke |
|---|---|
| `Space` container doc / `_spaces` SpacesDoc | Account-level registry — not object-tree content |
| `_rooms` ACL doc `{v, owner, members, name, image}` | Access control record; same storage path |
| `typeindex` custom-type registry | Schema metadata — not content nodes |
| Profile, devices, keyring | Identity/auth data — outside object tree |
| Device-local `Vault` | Local encrypted storage — never on the object path |

### 11.3 — Public spaces: relocate the existing object index (NOT a shape conversion)

OctoVault public content is **already** plaintext `ObjectNode`s at the old path:

```
pubspaces/{ownerId}/{spaceId}/objects/_index     ← OLD (pubObjIndex)
pubspaces/{ownerId}/{spaceId}/objects/docs/{id}
pubspaces/{ownerId}/{spaceId}/objects/logs/{id}
```

The unified-spaces SDK reads from the new path — only the path changes, not the node shape:

```
spaces/{spaceId}/objects/_index                  ← NEW
spaces/{spaceId}/objects/docs/{id}
spaces/{spaceId}/objects/logs/{id}
```

**Decide first:** dev-only spaces → abandon (wipe `pubspaces/` namespace, clean break).
Production spaces with real content → run the relocate below.

**Relocate recipe** (run once per owner, with that owner's session):

```ts
import { updateObjectIndex, readSpaceIndexRooms } from '@drakkar.software/octospaces-sdk';

for (const entry of await listPublicSpaces(ownerId)) {
  const { spaceId, name, image } = entry;

  // 1. Read old plaintext index doc verbatim
  const oldIndex = await readPubObjIndex(ownerId, spaceId); // { objects: ObjectNode[] }

  // 2. Strip vestigial room/category nodes; re-tag automation nodes to new type
  const cleaned = oldIndex.objects
    .filter(n => n.type !== 'room' && n.type !== 'category')
    .map(n =>
      n.type === 'room' && (n as any).subtype === 'automation'
        ? { ...n, type: 'automation' as const, subtype: undefined }
        : n,
    );
  // buildTree() re-homes any children whose parent was stripped → no orphan crash

  // 3. Write cleaned index to new path (encryptor null = plaintext)
  await updateObjectIndex(session, spaceId, () => ({ objects: cleaned }), reg);

  // 4. Synthesize the new _rooms access record (name/image from old PublicSpaceDoc)
  await writeSpaceAccess(reg.client, spaceId, {
    v: 1, owner: ownerId, members: [], visibility: 'public', name, image,
  });

  // 5. Copy pubObjDoc/pubObjLog content docs to new path unchanged
  //    (pubspaces/{ownerId}/{spaceId}/objects/docs/* → spaces/{spaceId}/objects/docs/*)
  await relocateObjectContentDocs(ownerId, spaceId);

  // 6. Copy typeindex (custom type registry) to new path as-is
  //    pubspaces/{ownerId}/{spaceId}/typeindex → spaces/{spaceId}/typeindex
  await relocateTypeindex(ownerId, spaceId);
}

// Verify: relocated index reads back correctly
await readSpaceIndexRooms(session, spaceId, reg); // should return [] for vault (no rooms)
```

Note: OctoVault public spaces contain **no message streams** (no chat) — no stream relocate is
needed.

---

## 12. Server follow-ups (other repos — documented here for tracking)

These are independent of the OctoVault codebase but may be required for public spaces
in OctoVault deployments:

1. **Directory projection** (`apps/server` or equivalent Infra): rebuild the public-space
   index from `rooms`-collection `_rooms` writes with `visibility:'public'`. Until shipped,
   new public spaces don't appear in the public directory.
2. **Retire `pubspace`/`pubstream` collections**: after all active OctoVault clients have
   migrated, disable write on those collections. Keep readable for a recovery window.
3. **`links[]` roster field** (optional): add `links: string[]` alongside `members[]` in
   `_rooms` so ephemeral link-bearer ids stop inflating the displayed member count.

---

## Summary checklist

- [ ] **Starfish**: bump `@drakkar.software/starfish-*` to `3.0.0-alpha.27`; fix `ScopePreset.paths` guards and `userIdFromEdPub` rename
- [ ] **Deps**: add `octospaces-sdk@^0.1.0` + `octospaces-ui@^0.1.0`
- [ ] **Config**: call `configureOctoSpaces` at boot
- [ ] **Files**: delete replaced files; re-export shared symbols
- [ ] **Types**: `Space.type` → `Space.visibility` global search-replace
- [ ] **Call sites**: replace pubspace call sites per the table above
- [ ] **Paths**: extend `accountScope` with vault-specific collections if needed
- [ ] **UI**: wrap root in `OctoSpacesThemeProvider` (theme already satisfies the contract)
- [ ] **Native** (if applicable): add `platform` import
- [ ] **Data migration**: for public spaces — relocate `pubObjIndex` to `spaces/{spaceId}/objects/_index`; strip room/category nodes; re-tag `type:'room'+subtype:'automation'` → `type:'automation'`; synthesize `_rooms` from `PublicSpaceDoc.name`/`.image`. For private spaces: nothing to convert (already ObjectNodes); vestigial room/category nodes cleaned lazily on next index write.
- [ ] **Server**: rebuild public-space directory projection
