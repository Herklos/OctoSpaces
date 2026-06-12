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
  // Optional — set if OctoVault shares space registry with OctoChat
  sharedSpacesNamespace: process.env.NEXT_PUBLIC_STARFISH_SHARED_SPACES_NAMESPACE,
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

## 11. Server follow-ups (other repos — documented here for tracking)

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
- [ ] **Server**: rebuild public-space directory projection
