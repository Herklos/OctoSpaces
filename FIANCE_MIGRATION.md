# Fiancé → `@drakkar.software/octospaces-sdk` Migration Plan

This document tracks the steps needed to migrate the Fiancé app
(`/Users/user/Documents/dev/POC/wedding-os`) to `octospaces-sdk`, starfish
`3.0.0-alpha.27`, and the `ObjectNode` tree model.

The migration also restructures `wedding-os` as a pnpm workspace and extracts
all headless business logic into a new `packages/fiance-sdk` package, mirroring
the OctoChat / OctoVault pattern.

The migration is gated on `octospaces-sdk@0.4.3` being available and on a custom
dev build of the Expo app (starfish `3.0.0-alpha.27` + `react-native-quick-crypto`
require the New Architecture and cannot run in Expo Go).

---

## ⚡ starfish 2.3 → 3.0 + octospaces-sdk adoption headline changes

Fiancé currently pins `@drakkar.software/starfish-client@^2.3.0` and uses the
**flat document-per-collection** model (`wedding/{userId}` blob,
`wedding-page/{userId}` doc, `rsvp-roster/{userId}`, etc.). The 3.x + octospaces
adoption changes the model wholesale.

### Data model

The bespoke flat collections are **retired**. The wedding is an octospaces
**Space**; every domain entity becomes an **ObjectNode** in the space's object
index (`spaces/{spaceId}/objects/_index`). The server layout moves from fixed
per-identity paths to the generic `spaces/{spaceId}/…` namespace.

### Encryption model

The bespoke `GroupKeyring` from `lib/group-crypto.ts` (wrapping `starfish-client/group`,
which is removed in v3) is **deleted**. The single space-wide keyring at
`spaces/{spaceId}/_keyring` (`spacekeyring` collection, `read:space:member` /
`write:space:owner`) replaces it. All `enc:true` nodes in the space share this
one CEK. The couple = space owner + one invited member; extra devices pair via
QR + `addDeviceToSpaceKeyring`.

### Guest / invite model

The public `wedding-page`, `rsvp-roster`, and `rsvp-inbox` collections are
**retired**. The invite-only guest page is an `access:'invite' enc:false`
ObjectNode whose content lands in `objinv` (cap-gated only; NOT reachable via
a broad `space:member` cap). Each guest receives a per-guest node invite link
(ephemeral key + `nodeMemberScope` cap) that lets them read the page and write
their own RSVP node. Revocation = `removeSpaceMember(ephemeralUserId)`.

### Why `invite + enc:false` for the guest page (not `public`, not `enc:true`)

- `public` would project the node into the world directory and serve it
  anonymously — wrong, the guest page is invite-only.
- `invite + enc:true` would require giving guests the space keyring, which
  decrypts all admin data — wrong; guests must never hold the space key.
- `invite + enc:false` (plaintext-but-cap-gated via `objinv`) is the only valid
  combination. `public + enc:true` is explicitly rejected by `createNode`.

### Node access model

| Node / page type | `access` | `enc` | Who can read |
|---|---|---|---|
| All wedding admin (guests, vendors, budget, tasks, ideas…) | `space` | `true` | Space members (the couple + paired devices) holding the space key |
| Public day-of items marked `isPublic` | `space` | `true` | Same — couple controls sharing |
| Invite-only guest page | `invite` | `false` | Guests holding a per-guest node cap |
| Guest RSVP slot | `invite` | `false` | That guest (their own RSVP node cap) + owner |
| Marketing site / free tools | out of space model | — | World-public, unchanged |

### SDK / starfish 2.3 → 3.0 breaking points for the Fiancé app

1. **`starfish-client/group` removed.** All uses of `deriveGroupKeyPair`,
   `createGroupKeyring`, `createGroupEncryptor` in `lib/group-crypto.ts` must be
   deleted and replaced by octospaces space membership + space keyring.
2. **`usersFromEdPubs` → `userIdFromEdPub`** (singular). Update any identity
   derivation that calls the old name.
3. **`ScopePreset.paths` now optional** (`string[] | undefined`). Guard all
   manual `scope.paths.some(…)` calls with `(scope.paths ?? []).some(…)`.
4. **`StarfishClient` optional `encryption` param** — no call-site change
   needed if not explicitly passed.
5. **Auth model** moves from `Bearer <authToken>` (first-16-chars of
   passphrase-derived hex) to **cap-cert request signing**
   (`buildAuthHeaders(cap, key, method, path)` from octospaces-sdk).

### ⚡ 0.4.1 shared namespace trimmed + space-wide keyring restored

The shared `octospaces` namespace holds **only**: `spaces`, `spaceregistry`,
`spacekeyring`, `profile`, `devices`, `pairing`. Content collections
(`objindex`, `objdoc`, `objlog`, `objsnap`, `objblob`, `objpub`, `objinv`,
`typeindex`) belong in **Fiancé's own `fiance` namespace** — not in `octospaces`.
One keyring per space (`keyringPull/Push(spaceId)`); `nodeMemberScope` now
covers only `['objinv']`; `OBJECT_COLLECTIONS` contains `'spacekeyring'`.

---

## Strategy: two phases

Phase A and Phase B are separate PRs. Phase A is a safe, reversible refactor
that stays on starfish 2.3; the app keeps working. Phase B is the protocol-major
bump + data remodel.

---

# Phase A — Monorepo + SDK extraction (starfish 2.3, no behaviour change)

## 1. Workspace skeleton

Convert the flat `wedding-os` repo into a pnpm workspace mirroring the
octospaces `apps/*` + `packages/*` layout:

```
wedding-os/
├─ pnpm-workspace.yaml         # packages: ['apps/*','packages/*']; nodeLinker: hoisted
├─ package.json                # private; no expo deps; -r build/test/typecheck scripts
├─ tsconfig.base.json          # shared strict compilerOptions
├─ packages/
│  └─ fiance-sdk/              # headless, no JSX, no Expo imports
└─ apps/
   ├─ mobile/                  # the Expo app (all UI + store shells + platform glue)
   └─ server/                  # the Cloudflare Worker (was server/)
```

- **Move the app to `apps/mobile`** (not repo root). The root must be the
  workspace; keeping the app at root breaks `pnpm -r` and Metro workspace
  detection. The `@/*` alias is already alias-relative, so the move only
  re-bases the alias, not the import sites.
- **Move the Worker to `apps/server`**; delete its nested `pnpm-lock.yaml`
  (the root lockfile governs).
- **Metro** — `apps/mobile/metro.config.js`:

  ```js
  const projectRoot   = __dirname;            // apps/mobile
  const workspaceRoot = path.resolve(projectRoot, '../..');
  const config = getSentryExpoConfig(projectRoot);

  config.watchFolders = [workspaceRoot];       // live-bundles packages/fiance-sdk/src
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ];
  // keep unstable_enableSymlinks: true (pnpm) and the existing resolveRequest
  // (nativewind jsx-runtime shim + web cssInterop bypass) verbatim
  ```

  Add a `predev` script that runs `pnpm --filter @fiance/sdk build` so Metro
  reads `dist/index.js` (or alias `@fiance/sdk` → `src/index.ts` in the
  resolver for faster iteration).

- **TS aliases** — `apps/mobile/tsconfig.json`:

  ```jsonc
  {
    "extends": "expo/tsconfig.base",
    "compilerOptions": {
      "paths": {
        "@/*":         ["./*"],
        "@fiance/sdk": ["../../packages/fiance-sdk/src/index.ts"]
      }
    }
    // drop "exclude": ["server"] — server is now its own workspace
  }
  ```

---

## 2. Create `packages/fiance-sdk` (skeleton from octospaces-sdk)

`package.json` mirrors `packages/ts/octospaces-sdk/package.json` exactly:
`type:module`, `sideEffects:false`, dual `exports` map (`.` + `./platform` with
`react-native` condition), `scripts: { build, typecheck, test, lint }`.

```jsonc
{
  "name": "@fiance/sdk",
  "version": "0.1.0",
  "description": "Headless wedding domain core — types, domain calc, backup/sync over octospaces.",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./platform": {
      "react-native": "./dist/platform/index.native.js",
      "import":       "./dist/platform/index.js",
      "types":        "./dist/platform/index.d.ts"
    }
  },
  "scripts": {
    "build":     "tsup",
    "typecheck": "tsc --noEmit",
    "test":      "vitest run",
    "lint":      "tsc --noEmit"
  },
  "dependencies": {
    "@noble/curves": "^2.2.0",
    "@noble/hashes": "^2.2.0",
    "@scure/bip39":  "^2.0.0",
    "date-fns":      "^3.6.0",
    "zod":           "^3.25.76"
  },
  "peerDependencies": {
    "@drakkar.software/starfish-client":     ">=3.0.0-alpha.27",
    "@drakkar.software/starfish-identities": ">=3.0.0-alpha.27",
    "@drakkar.software/starfish-keyring":    ">=3.0.0-alpha.27",
    "@drakkar.software/starfish-protocol":   ">=3.0.0-alpha.27",
    "@drakkar.software/starfish-sharing":    ">=3.0.0-alpha.27"
  },
  "devDependencies": {
    "@drakkar.software/starfish-client":     "3.0.0-alpha.27",
    "@drakkar.software/starfish-identities": "3.0.0-alpha.27",
    "@drakkar.software/starfish-keyring":    "3.0.0-alpha.27",
    "@drakkar.software/starfish-protocol":   "3.0.0-alpha.27",
    "@drakkar.software/starfish-sharing":    "3.0.0-alpha.27",
    "@types/node":  "^22.0.0",
    "tsup":         "^8.3.0",
    "typescript":   "~5.9.3",
    "vitest":       "^4.1.4"
  }
}
```

Phase A activates only runtime deps (`@noble/*`, `@scure/bip39`, `date-fns`,
`zod`). Phase B adds `@drakkar.software/octospaces-sdk@0.4.3` as a dep +
starfish `3.0.0-alpha.27` as peer deps. Copy `tsup.config.ts`, `tsconfig.json`,
and `vitest.config.ts` (node env, `singleFork: true` — module-level singletons
in analytics + config) verbatim from `packages/ts/octospaces-sdk/`.

Source layout:

```
packages/fiance-sdk/src/
├─ index.ts                   # barrel
├─ core/
│  └─ config.ts               # FianceConfig extends OctoSpacesConfig; configureFiance()  (Phase B)
├─ objects/
│  └─ object-types.ts         # FIANCE_TYPES  (declared in Phase A, activated in Phase B)
├─ domain/
│  ├─ schema.ts               # entity interfaces (Wedding, Guest, Vendor, Table, Task…)
│  ├─ types.ts                # enums, labels, BUDGET_*, PRICING_KEY_*, DEFAULT_INVITATION_TYPES
│  ├─ guests.ts               # GuestCounts + computeCounts + pure guest/table/group reducers
│  ├─ budget.ts               # computeBudgetSummary, calculateVendorTotal, caterer scoring
│  ├─ planning.ts             # generateDefaultCategories/Tasks, recalculateDueDates (inject randomId + t)
│  ├─ vendor-config.ts        # getVendorTypeConfig
│  └─ registry.ts             # WeddingRegistry CRUD (inject SecureKvAdapter + onDeleteDb)
├─ sync/
│  ├─ server-config.ts        # ServerConfig, deriveUserId, resolveServerConfig
│  ├─ backup.ts               # BackupData, createBackupDocument(snapshot), restoreFromBackup(doc), v1→v6
│  ├─ public-page.ts          # PublicWeddingPage types + buildPublicPageDocument (pure)
│  ├─ rsvp.ts                 # buildRsvpRoster, roster/submission pure transforms + interfaces
│  └─ export-import-core.ts   # JSON validate + restore orchestration (no Expo I/O)
├─ platform/
│  ├─ index.ts                # web: no-op re-export  (Phase B)
│  └─ index.native.ts         # native: import octospaces-sdk/platform  (Phase B)
└─ analytics.ts               # FianceEvents map + lazy starfish adapter (inject storage + platform)
```

---

## 3. Delete or redirect moved files

**The keystone extraction first:** move `GuestCounts` + `computeCounts` + the
guest/table/group pure reducers out of `store/useGuestsStore.ts` into
`src/domain/guests.ts`, then repoint `lib/budget.ts` and `lib/sync.ts` to
import from the SDK. This severs the SDK→store back-dependency that would
otherwise create a cycle. Run tests; they must stay green before continuing.

```
db/schema.ts                   → src/domain/schema.ts            (pure TS types; clean move)
db/types.ts  (minus icons)     → src/domain/types.ts             (VENDOR_TYPE_ICONS + lucide → apps/mobile/lib/vendor-icons.ts)
lib/budget.ts                  → src/domain/budget.ts
lib/planning.ts                → src/domain/planning.ts          (inject randomId + translator t)
lib/vendorTypeConfig.ts        → src/domain/vendor-config.ts
lib/wedding-registry.ts        → src/domain/registry.ts          (inject SecureKvAdapter + onDeleteDb cb)
lib/server.ts                  → src/sync/server-config.ts
lib/sync.ts                    → src/sync/backup.ts              (pure: createBackupDocument(snapshot) / restoreFromBackup(doc))
lib/public-page.ts  (pure)     → src/sync/public-page.ts         (store-reading wrapper stays app-side)
lib/rsvp-sync.ts  (non-React)  → src/sync/rsvp.ts               (useGuestRsvpUrl hook stays apps/mobile)
lib/export-import.ts  (core)   → src/sync/export-import-core.ts  (Expo file I/O stays apps/mobile;
                                                                   fix deprecated `expo-file-system/legacy`
                                                                   import → `expo-file-system` during the move)
lib/analytics.ts               → src/analytics.ts                (inject storage adapter + platform string)
```

**DELETE / REDIRECT in Phase B — octospaces-sdk provides these:**

```
lib/identity.ts      → octospaces-sdk  generateSeedWords / isValidSeed / buildSession / deriveSession
                                        (keep thin Fiancé wrappers for passphrase dash-format + expo-linking;
                                         inject webBase via config)
lib/group-crypto.ts  → octospaces-sdk  DELETE — GroupKeyring replaced by space membership + space keyring
                                        (inviteToSpace / acceptSpaceInvite or createSpaceInviteLink /
                                         joinSpaceByLink; addDeviceToSpaceKeyring for new devices)
lib/server.ts env    → configureFiance / configureOctoSpaces / getSyncBase
lib/starfish.ts      → makeClient / fetchWithTimeout / pullCache / registerPull / dispatchDocChange
  sync transport         (backup logic already moved to fiance-sdk; singleton orchestration stays app-side)
```

**`lib/public-page.ts` uses `createDebouncedPush`** (different from `createDebouncedSync`, but
also removed in v3). The pure builder is extracted to `src/sync/public-page.ts` (no debounced
push needed there), but the app-side wrapper that calls `createDebouncedPush` must be replaced
with a direct `client.push(…)` call (or debounced manually) in Phase B.

**`lib/links.ts`** re-exports from `@drakkar.software/seahorse/utils/links`. In Phase B
octospaces-sdk replaces `seahorse` for invite link encoding (`encodeNodeInviteLink` /
`decodeNodeInviteLink`). `lib/links.ts` becomes a thin Fiancé-specific wrapper re-exporting
from `@fiance/sdk`; the `seahorse` direct dep is removed.

**`pullEntitlements`** is imported from `@drakkar.software/starfish-client` in
`lib/providers.tsx`, `lib/iap.ts`, and `lib/stripe.ts`. This API uses v2.3 Bearer auth and
has no direct v3 equivalent — it must be replaced with a plain `client.pull('entitlements/…')`
call authenticated via cap-cert (or dropped if the `entitlements` collection migrates to a
dedicated endpoint). Flag these three files in Phase B.

**`notifySync()` in Phase B:** `lib/starfish.ts` currently calls `createDebouncedSync(store)`
(starfish 2.3 API, removed in v3). In Phase B, delete `createDebouncedSync` and redefine
`notifySync()` as a lightweight wrapper around the octospaces live-sync-bus:

```ts
// apps/mobile/lib/starfish.ts  (Phase B)
import { dispatchDocChange } from '@fiance/sdk';

export function notifySync(path?: string): void {
  dispatchDocChange(path ?? '*');   // triggers registered pull listeners
}
```

All 13 store shells keep calling `notifySync()` unchanged; the call-site API is identical.
Add this to the Phase B checklist (§"Files deleted/redirected").

**Stays in `apps/mobile`** (UI / React / platform / composition root):

```
app/**                  (all Expo Router screens + marketing site)
components/**           (71 UI components)
lib/providers.tsx       (SyncInitializer / IAPInitializer / NotificationInitializer — React glue)
db/provider.tsx         (DatabaseProvider + useDatabase — React context)
lib/persistence.ts      (store↔KV write-through — THE composition root; stays because it wires all 13 stores)
lib/starfish.ts         (runtime singleton: initStarfish, notifySync, SyncManager — Phase A stays; Phase B redirects transport pieces)
lib/theme.ts  global.css  tailwind.config.js
lib/notifications*.ts   (expo-notifications — platform OS)
lib/toast/**            (sonner/sonner-native — UI)
lib/iap.ts              (expo-iap — platform purchase)
lib/premium.ts  lib/stripe.ts
lib/pdf-export.ts  lib/print-schedule.ts
lib/use-page-meta.ts  lib/usePwaInstall.ts
lib/vendor-icons.ts     (NEW — split from db/types.ts; holds lucide icon map)
lib/kv-storage*.ts      (stays — Expo KV; Phase B wires octospaces configureKv around it;
                         see §8 KvAdapter note below for the web variant)
i18n/**  assets/**  public/**  .storybook/**
all 13 store/*.ts shells (see §4 below)
```

---

## 4. Store split pattern

Every one of the 13 Zustand store mutators today does three things: (1) a
**pure reducer** over arrays, (2) `persistX(storage)` write-through, (3)
`notifySync()` debounce. Extract (1) into `fiance-sdk/src/domain/`; leave
(2)+(3) + the `create()` shell in the app. The shells stay app-side because the
side-effects transitively pull in `expo-sqlite`, Zustand's React binding, and
the Starfish singleton.

```ts
// apps/mobile/store/useGuestsStore.ts  (after)
addGuest: (guest) => {
  set((s) => ({ guests: guestsDomain.addGuest(s.guests, guest) })); // SDK pure reducer
  const storage = getStorage(); if (storage) persistGuests(storage); // app side-effect
  notifySync();                                                       // app side-effect
},
```

The `computeCounts` free function (already exported from `useGuestsStore`) is
the reference pattern — it has no store import in its current body.

**Three stores are exempt from this pattern** — they do not follow the
`persistX + notifySync` model and need separate treatment:

| Store | Why exempt | Phase A action |
|---|---|---|
| `useBudgetStore` | Pure derived/computed state; no `persistX`, no `notifySync`. | Move pure budget math to `src/domain/budget.ts`; shell becomes a selector-only wrapper. |
| `useSettingsStore` | Backed by `expo-secure-store`, not KV; local-only (survives wedding deletion); no sync. | Keep entirely in `apps/mobile`; nothing to extract. |
| `useWeddingRegistryStore` | Wraps `lib/wedding-registry.ts` via `SecureStore`; not part of the sync loop. | Move pure registry CRUD to `src/domain/registry.ts` (inject `SecureKvAdapter` + `onDeleteDb`); app shell keeps Expo-secure-store wiring. |

---

## 5. Re-export barrel + import rewrite

`src/index.ts` re-exports domain + sync modules now. In Phase B it adds a
curated re-export set from octospaces-sdk so the app never imports
`@drakkar.software/octospaces-sdk` directly:

```ts
// packages/fiance-sdk/src/index.ts
// ── Fiancé domain ────────────────────────────────────────────
export * from './domain/schema.js';
export * from './domain/types.js';           // minus icons
export * from './domain/guests.js';          // computeCounts, GuestCounts, reducers
export * from './domain/budget.js';
export * from './domain/planning.js';
export * from './domain/vendor-config.js';
export * from './domain/registry.js';
export * from './objects/object-types.js';   // FIANCE_TYPES
// ── Fiancé sync ──────────────────────────────────────────────
export * from './sync/server-config.js';
export * from './sync/backup.js';
export * from './sync/public-page.js';
export * from './sync/rsvp.js';
export * from './sync/export-import-core.js';
export * from './analytics.js';
export { configureFiance }  from './core/config.js';
export type { FianceConfig } from './core/config.js';
export { accountScope } from './paths.js';   // Phase B — Fiancé accountScope extension

// ── Re-export from octospaces-sdk (Phase B — stable app imports) ──
export {
  configureOctoSpaces, configureKv, getSyncBase, getSyncPrefix,
  buildSession, buildLinkedSession, deriveSession,
  generateSeedWords, isValidSeed, fingerprintFromUserId, userIdFromEdPub,
  makeClient, buildEncryptor, openEncryptor, ownerEnsureKeyring,
  buildAuthHeaders, readProfile, writeProfile, ensureProfileKeys,
  keyringName, keyringPull, keyringPush, addDeviceToSpaceKeyring,
  createSpaceInviteLink, joinSpaceByLink, decodeSpaceInviteLink,
  createNodeInviteLink, joinNodeByLink, decodeNodeInviteLink, previewInvite,
  encodeNodeInviteLink,
  createSpace, readSpaces, updateSpacesDoc,
  createNode, updateObjectIndex, readObjectTree,
  addObject, patchObject, reparentObject, buildTree,
  fetchWithTimeout, registerPull, dispatchDocChange, emitSseStatus, onSseStatus,
  sealToSelf, unsealFromSelf,
} from '@drakkar.software/octospaces-sdk';
export type {
  OctoSpacesConfig, KvAdapter, ObjectType, ObjectNode, NodeAccess, ID,
  Session, LinkedIdentity, DeviceKeys, PublicProfile, Space,
} from '@drakkar.software/octospaces-sdk';
```

Rewrite app import sites: `@/lib/*` + `@/db/*` + pure `@/store/*` →
`@fiance/sdk` (blast radius: ~42 files import `@/lib`, ~41 `@/store`, ~20
`@/db`; most `@/store` hits are React hooks that stay).

---

## 6. Test migration

Move pure-logic tests into the SDK (octospaces colocated convention:
`src/**/*.test.ts`); keep hook/IO tests in `apps/mobile/__tests__/`:

```
__tests__/budget.test.ts          → packages/fiance-sdk/src/domain/budget.test.ts
__tests__/planning.test.ts        → packages/fiance-sdk/src/domain/planning.test.ts
__tests__/vendor-config.test.ts   → packages/fiance-sdk/src/domain/vendor-config.test.ts
__tests__/schema.test.ts          → packages/fiance-sdk/src/domain/guests.test.ts     (computeCounts)
__tests__/public-page.test.ts     → packages/fiance-sdk/src/sync/public-page.test.ts
__tests__/rsvp-sync.test.ts       → packages/fiance-sdk/src/sync/rsvp.test.ts         (non-hook portions)
__tests__/sync-encryption.test.ts → packages/fiance-sdk/src/sync/backup.test.ts       (encryption portions)
__tests__/sync-migrations.test.ts → packages/fiance-sdk/src/sync/backup.test.ts       (v1→v6 migrations)
__tests__/identity.test.ts        → packages/fiance-sdk/src/sync/identity.test.ts     (Phase B)
__tests__/links.test.ts           → apps/mobile/__tests__/links.test.ts               (seahorse re-export)
__tests__/join.test.ts            → apps/mobile/__tests__/join.test.ts                (end-to-end, integration)
```

SDK `vitest.config.ts`: `environment:'node'`, `singleFork:true`, `include:['src/**/*.test.ts']`,
no `@` alias (relative imports only). App `vitest.config.ts`: add alias
`'@fiance/sdk': '../../packages/fiance-sdk/src/index.ts'` so app tests resolve
SDK source without a build step.

**Phase B test replacement — `sync-encryption.test.ts`:** the current test verifies the
v2.3 per-user `ENCRYPTION_SECRET` round-trip via `SyncManager`. In Phase B it is entirely
wrong (different encryption model, no `SyncManager`). Replace it with a new test in
`src/sync/backup.test.ts` that verifies the space-keyring E2EE round-trip:
`ownerEnsureKeyring → writeEncDoc → readEncDoc` correctly encrypts + decrypts an entity doc.
The old test must be deleted; do not port it as-is.

---

# Phase B — starfish bump + octospaces adoption + data remodel

## 7. Bump starfish + add octospaces-sdk

```sh
# In wedding-os root
pnpm up "@drakkar.software/starfish-*@3.0.0-alpha.27"
# Then add octospaces-sdk as a dep of fiance-sdk + as a peer dep of mobile
pnpm --filter @fiance/sdk add @drakkar.software/octospaces-sdk@0.4.3
```

Fix carry-over breakages (from §"SDK / starfish 2.3 → 3.0 breaking points" above):
- Delete all `import … from 'starfish-client/group'` (file `lib/group-crypto.ts` deleted).
- Rename `usersFromEdPubs` → `userIdFromEdPub`.
- Guard `(scope.paths ?? [])`.
- Remove explicit `encryption` param if passed to `StarfishClient` (optional, unchanged default).

Also bump the `sunglasses-*` packages in the same pass — they wrap `starfish-client` and must
be compatible with v3:

```sh
pnpm up "@drakkar.software/sunglasses-*@latest"
```

`@drakkar.software/sunglasses-adapter-starfish@^0.7.0` (analytics), `sunglasses-react-native`
(Sentry/analytics provider in `app/_layout.tsx`), and `sunglasses-adapter-sentry` are all in
`package.json`. If they are not bumped for v3 compat, the root layout (`SunglassesProvider`,
`SunglassesErrorBoundary`, `createSentryBeforeSend`) and analytics pipeline break silently.

**`createMobileLifecycle` removal (Phase B):** `lib/providers.tsx` calls
`createMobileLifecycle(sf, { appState: AppState, netInfo: NetInfo })` to wire OS foreground
events into `SyncManager`. Both `createMobileLifecycle` and `SyncManager` are removed in v3.
Replace with the octospaces live-sync-bus connectivity hooks — `emitSseStatus(status)` on
`AppState` change + `onSseStatus(listener)` for UI indicators.

**`onSyncStatusChange` / `getSyncStatus` / `getLastSyncTimestamp` (Phase B):** these three
exports from `lib/starfish.ts` drive UI sync-status indicators (spinner, "last synced" label).
Replace with `onSseStatus(listener)` from octospaces-sdk. Any component calling
`getSyncStatus()` or `getLastSyncTimestamp()` must be rewritten to use the SSE status bus.

**Size-limit UX (Phase B):** `initStarfish` calls `fetchServerConfig(url)` to fetch live
`weddingMaxBytes` limits, then fires `onSizeWarning` / `onSizeExceeded` toasts when the
encrypted backup blob approaches its cap. In Phase B the monolithic wedding blob is replaced
by ObjectNodes — there is no equivalent single-doc size cap. Delete `fetchServerConfig`,
`onSizeWarning`, and `onSizeExceeded`; remove the size-warning toast from `lib/providers.tsx`.

---

## 8. Configuration + identity + keyring rewire

```ts
// packages/fiance-sdk/src/core/config.ts
import {
  configureOctoSpaces, configureKv,
  type OctoSpacesConfig, type KvAdapter,
} from '@drakkar.software/octospaces-sdk';

export interface FianceConfig extends OctoSpacesConfig {
  weddingMaxBytes?: number;  // fallback when /config is unreachable
  backupVersion?:   number;  // schema version understood by this build
}

export function configureFiance(cfg: FianceConfig, kv: KvAdapter): void {
  configureOctoSpaces({
    syncBase:              cfg.syncBase,
    syncNamespace:         'fiance',
    sharedSpacesNamespace: 'octospaces',
  });
  configureKv(kv);  // SDK account-scoped state (caps, profile cache, pull cache)
}
```

Call `configureFiance(cfg, kvAdapter)` in `lib/providers.tsx` at app boot before
any SDK call. For native builds, add at the top of the root entry point:

### Identity continuity bridge

**Critical:** the starfish 2.3 userId = `authToken.slice(0, 16)` (8-byte hex derived from
`PBKDF2(passphrase) + slice`), while octospaces userId = `sha256(edPub)[0:32]` (16-byte hex
from `userIdFromEdPub`). These are provably different strings — a couple migrating from the
old client loses their encrypted data unless the Space is created with the correct new userId
and the legacy backup is loaded into it.

**Recommended: deterministic re-keying during the relocate step (§14.1).** The v6 backup
contains all wedding data; the relocate decrypts it with the old key and re-encrypts under
the new space keyring. There is no need to preserve the old 2.3 identity after migration.
The owner's new seed is generated once (`generateSeedWords`), secured by the user, and used
for all future sessions. The old passphrase + authToken are discarded after the one-time
relocate confirms success.

Old partner-invite deep links (`exp://…?t=<authToken>`) are dropped without a compat shim —
they reference the 2.3 auth model and cannot be re-keyed. All existing invite links are
invalidated on migration; couples re-invite their partners via the new octospaces space invite
flow after the relocate completes.

```ts
// apps/mobile/index.native.ts  (or the Expo root _layout.tsx)
import '@fiance/sdk/platform';
```

The `./platform` export of `fiance-sdk` re-exports `@drakkar.software/octospaces-sdk/platform`,
which installs `react-native-quick-crypto` in place of WebCrypto for native builds.
Peer: `react-native-quick-crypto >=0.7`. **Requires New Architecture + custom dev build.**

### KvAdapter interface compatibility

`configureKv(kv)` (from octospaces-sdk) expects a `KvAdapter` — a simple
`{ get, set, delete, list }` interface. The native `lib/kv-storage.ts` adapter maps cleanly.
The **web variant** (`lib/kv-storage.web.ts`) adds:

- `initStorage(databaseName)` — namespace prefix (`<dbFileName>::<key>`). Call this before
  `configureKv`; it is not part of `KvAdapter` but must run at boot.
- `purgeStorage(dbFileName)` — full namespace wipe called on wedding deletion. The `onDeleteDb`
  injection in `src/domain/registry.ts` must call this on web; the native path uses
  `expo-sqlite`'s `deleteDatabaseAsync` (no-op equivalent already handled by the existing
  `lib/wedding-registry.web.ts` platform override → `src/domain/registry.web.ts`).

### New Architecture + build config

`react-native-quick-crypto` requires the New Architecture. Three files need updating in
Phase B before the first custom dev build:

```jsonc
// apps/mobile/app.json
{
  "expo": {
    "android": { "newArchEnabled": true },
    "ios":     { "newArchEnabled": true }
  }
}
```

```jsonc
// apps/mobile/eas.json  — add to development + preview profiles
{
  "build": {
    "development": { "env": { "EXPO_USE_NEW_ARCH": "1" } },
    "preview":     { "env": { "EXPO_USE_NEW_ARCH": "1" } }
  }
}
```

```sh
pnpm --filter mobile add react-native-quick-crypto
```

Note: `react-native-quick-crypto` is **not in `package.json`** yet. Without it, `import
'@fiance/sdk/platform'` silently falls back to WebCrypto on native (Ed25519 ops will fail on
older devices that lack WebCrypto).

---

## 9. Declare FIANCE_TYPES

`octospaces-sdk` ships **zero** domain type strings. Declare them in
`src/objects/object-types.ts`:

```ts
// packages/fiance-sdk/src/objects/object-types.ts
import type { ObjectType } from '@drakkar.software/octospaces-sdk';

export const FIANCE_TYPES = {
  // 16 domain entities
  wedding:        'wedding',
  guestGroup:     'guestGroup',
  guest:          'guest',
  table:          'table',
  vendor:         'vendor',
  quotePricing:   'quotePricing',
  vendorPayment:  'vendorPayment',
  accommodation:  'accommodation',
  gift:           'gift',
  invitationType: 'invitationType',
  taskCategory:   'taskCategory',
  task:           'task',
  agendaEvent:    'agendaEvent',
  dayOfItem:      'dayOfItem',
  ideaCollection: 'ideaCollection',
  idea:           'idea',
  // 2 guest-surface synthetic types
  publicPage:     'publicPage',
  rsvp:           'rsvp',
} as const;

export type FianceObjectType = (typeof FIANCE_TYPES)[keyof typeof FIANCE_TYPES] & ObjectType;
```

Existing stored `type` strings in live data keep their values unchanged — the
tree engine works with any `type: string`.

---

## 10. Node taxonomy: ObjectNode tree layout

The object index (`spaces/{spaceId}/objects/_index`) is always **plaintext** +
member-gated. For `enc` nodes, confidential fields go in the **content doc**
(`objdoc`, sealed under the space keyring) — never in `title`, `emoji`, or
`meta` (all indexed in the clear). For `invite` nodes,
`serializeForIndex` strips `title`/`emoji` before the index write (`meta` is NOT
stripped — keep no secrets there either).

| type | access | enc | contentKind | confidential fields | parent |
|---|---|---|---|---|---|
| `wedding` (root singleton) | space | true | merge | names/date/venue/desc/faq/budget → enc `objdoc` | root (parentId null) |
| `guestGroup` | space | true | none | name → enc `objdoc` | wedding |
| `guest` | space | true | merge | ALL PII → enc `objdoc`; `meta` holds only non-PII FKs: `groupId/tableId/companionId/accommodationId/legacyId` | guestGroup (or wedding if ungrouped) |
| `table` | space | true | merge | name/capacity/shape; layout coords may sit in `meta` | wedding |
| `vendor` | space | true | merge | contact/contract/notes → enc `objdoc` | wedding |
| `quotePricing` | space | true | merge | pricing lines → enc `objdoc` | vendor |
| `vendorPayment` | space | true | append | amount/date/method → enc append-log (immutable ledger) | vendor |
| `accommodation` | space | true | merge | address/dates/price → enc `objdoc` | wedding |
| `gift` (registry) | space | true | merge | title/price/url/claimed → enc `objdoc` | wedding |
| `invitationType` | space | true | merge | label/needsSleeping | wedding |
| `taskCategory` | space | true | none | name/icon/color | wedding |
| `task` | space | true | merge | title/status/dueDate/assignee → enc `objdoc` | taskCategory |
| `agendaEvent` | space | true | merge | title/time/location → enc `objdoc` | wedding |
| `dayOfItem` | space | true | merge | title/time/location/responsible/isPublic → enc `objdoc` | wedding |
| `ideaCollection` | space | true | none | name/desc | wedding |
| `idea` | space | true | merge | notes/palette → enc `objdoc`; images → sealed `objblob` | ideaCollection |
| **`publicPage`** | **invite** | **false** | merge | about/timeline/FAQ/public gifts → plaintext `objinv` | wedding |
| **`rsvp`** (one per guest) | **invite** | **false** | merge | guest RSVP submission → plaintext `objinv` | publicPage |

---

## 11. Invite-only guest page + per-guest RSVP

### Create the nodes

```ts
// run as owner session, once per wedding
const publicPage = await createNode(session, spaceId, {
  type: FIANCE_TYPES.publicPage, title: 'Wedding', access: 'invite', enc: false,
  parentId: weddingNodeId,
});

// for each guest, a dedicated rsvp node gives per-guest revocation
const rsvpNode = await createNode(session, spaceId, {
  type: FIANCE_TYPES.rsvp, access: 'invite', enc: false,
  parentId: publicPage.id, meta: { guestNodeId: guestNode.id },
});
```

### Index privacy (verified, `object-index.ts:19`)

`serializeForIndex` strips `title`/`emoji` from `invite` nodes before every
index write. Non-invited readers see `{ id, type, parentId, order, access }` in
the `_index` — no title, no content.

### Mint per-guest invite links (verified, `nodes.ts:355`, `paths.ts:148`)

```ts
// mint two caps per guest: one to read the page, one to write their rsvp
// createNodeInviteLink signature (nodes.ts:355):
//   (session, spaceId, nodeId, nodeName: string, node: { enc?: boolean }, write: boolean, origin: string)
const pageLink = await createNodeInviteLink(session, spaceId, publicPage.id, 'Wedding', { enc: false }, /* write */ false, origin);
const rsvpLink = await createNodeInviteLink(session, spaceId, rsvpNode.id,   'RSVP',    { enc: false }, /* write */ true,  origin);
// send both in the invitation email; encode together into one URL fragment
```

`createNodeInviteLink` (plaintext branch — `enc:false` node):
- mints ephemeral Ed/KEM keypair, derives `ephemeralUserId = userIdFromEdPub(ek.edPub)`
- `addSpaceMember(ephemeralUserId)` so the server enricher grants `space:member`
  (needed to read the plaintext `_index`)
- mints `nodeMemberScope(spaceId, nodeId, canWrite)` cap →
  `{ ops:['read','list','write'], collections:['objinv'], paths:['spaces/{spaceId}/objects/n/{nodeId}/**'] }`
- ships `{cap, key: ek.edPriv, write}` in the URL fragment

### Write-back authorization (verified end-to-end, `paths.ts:148, 113`)

1. Cap synthesizes `cap:write:objinv` from `collections:['objinv'], ops:['write']`.
2. Request path `spaces/{spaceId}/objects/n/{rsvpNodeId}/content` (`objInvName`)
   is independently glob-matched against the cap's `paths` — match cleared.
3. `objinv` is **excluded** from `spaceMemberScope` + `OBJECT_COLLECTIONS`
   (verified `paths.ts:113`), so a broad `space:member` cap cannot reach any
   other node's `objinv`; only this path-scoped cap can.
4. Guest writes via `objInvPush(spaceId, rsvpNodeId)` with no encryptor (plaintext).

### Revoke a guest

```ts
await removeSpaceMember(session.accountClient, spaceId, ephemeralUserId);
// no keyring rotation — the page is plaintext; the cap will no longer authorize
```

### RSVP URL format change

`buildWeddingPageUrl(userId)` (in `lib/rsvp-sync.ts`) constructs the public RSVP URL using
the old 16-char userId. In Phase B userIds are 32-char hex (`userIdFromEdPub`), and the guest
page is no longer at `wedding-page/{userId}` — it is an `objinv` node reached via an invite
link fragment. Update `buildWeddingPageUrl` (or replace it with `encodeNodeInviteLink` output)
in Phase B. **All existing QR codes and shared RSVP URLs will break** — couples must regenerate
and redistribute guest invite links after the relocate.

### GAP — anonymous (app-less) guest RSVP

`joinNodeByLink` needs a session (it seals access into `_spaces.pubAccess` via
`sealToSelf`). A guest with no installed app and no octospaces identity cannot
call it.

**Recommended fix:** add `writeNodeWithLinkCap(token, body)` to `fiance-sdk`:
sign an `objinv` push directly from the link token's `cap` + `key` via
`buildAuthHeaders(cap, key, 'POST', path)`, bypassing session sealing. This
mirrors how `submitRsvp` in `rsvp-sync.ts` does an unauthenticated update today
and preserves the "RSVP from a link, no install" UX. Add it to
`packages/fiance-sdk/src/sync/rsvp.ts`.

---

## 12. Path extensions

`accountScope` from octospaces-sdk does not include Fiancé-specific collections
(still needed in Phase A for the 2.3 server; migrated to the new caps in Phase B).

```ts
// packages/fiance-sdk/src/paths.ts
import { accountScope as baseAccountScope } from '@drakkar.software/octospaces-sdk';
import type { ScopePreset } from '@drakkar.software/starfish-identities';

/** Fiancé accountScope: base octospaces scope + fiance content collections.
 *  Phase B: bespoke collections retire as they move into the fiance namespace
 *  served by the cap-cert model; remove them from this list once migrated. */
export function accountScope(userId: string): ScopePreset {
  const base = baseAccountScope(userId);
  return {
    ...base,
    collections: [
      ...(base.collections ?? []),
      'objindex', 'objdoc', 'objlog', 'objsnap', 'objblob', 'objpub', 'typeindex',
      // Phase B deprecated (retire after server migration):
      'wedding', 'wedding-page', 'rsvp-roster', 'rsvp-inbox', 'gift-claims', 'entitlements',
    ],
    paths: [
      ...(base.paths ?? []),
      'spaces/**',
      // Phase B deprecated:
      `wedding/${userId}`, `wedding-page/${userId}`,
      `rsvp-roster/${userId}`, `rsvp-inbox/${userId}`,
    ],
  };
}
```

---

## 13. Stand up the `fiance` content namespace (server / Infra)

**Verified gap:** `apps/server/src/config.ts` holds only the 6 shared registry
collections; its header explicitly states content collections belong in each
app's own namespace. Fiancé must declare its own `SyncConfig`.

Clone `apps/server/src/config.ts` into a new `fiance` namespace config and add:

| collection | storagePath | readRoles | writeRoles | notes |
|---|---|---|---|---|
| `objindex` | `spaces/{spaceId}/objects/_index` | `space:member` | `space:member` | plaintext (invite titles stripped client-side) |
| `objdoc` | `spaces/{spaceId}/objects/docs/{objectId}` | `space:member` | `space:member` | LWW merge doc; ciphertext client-sealed |
| `objlog` | `spaces/{spaceId}/objects/logs/{objectId}` | `space:member` | `space:member` | append log (vendorPayment ledger) |
| `objsnap` | `spaces/{spaceId}/objects/logs/{objectId}__snapshot` | `space:member` | `space:member` | log snapshot |
| `objblob` | `spaces/{spaceId}/objects/blobs/{blobId}` | `space:member` | `space:member` | sealed binary (idea images); larger `maxBodyBytes` |
| `objpub` | `spaces/{spaceId}/objects/pub/{nodeId}` | `public` | `space:member` | reserved; Fiancé has no `access:'public'` nodes currently |
| **`objinv`** | `spaces/{spaceId}/objects/n/{nodeId}/content` | **`cap:read:objinv`** | **`cap:write:objinv`** | **guest page + RSVP; cap-gated ONLY** |
| `typeindex` | `spaces/{spaceId}/types/_index` | `space:member` | `space:owner` | per-space type registry |

Wire with `createCapCertRoleResolver({ allowAnonymous: true, plugins: [identitiesServerPlugin, sharingServerPlugin], … })`
+ `makeSpaceRoleEnricher(store)` (synthesizes `space:owner` / `space:member` from
`spaces/{spaceId}/_access`, which lives in the shared `octospaces` namespace).

Shared registry collections (`spaces`, `spaceregistry`, `spacekeyring`, `profile`,
`devices`, `pairing`) are served under the `octospaces` namespace on the same
server — the client points `sharedSpacesNamespace:'octospaces'` to reach them.

**Router wiring** — explicitly mount the two namespace routers in `apps/server/src/index.ts`
(the octospaces server uses Hono):

```ts
// apps/server/src/index.ts
import { createSyncRouter } from '@drakkar.software/starfish-server';
import { octospacesSyncConfig } from './config.js';        // existing shared registry
import { fianceSyncConfig }    from './fiance-config.js';  // new content namespace (§13)

const octospacesSyncRouter = createSyncRouter({ config: octospacesSyncConfig, store, roleResolver, enricher });
const fianceSyncRouter     = createSyncRouter({ config: fianceSyncConfig,     store, roleResolver, enricher });

app.route('/v1/octospaces', octospacesSyncRouter);
app.route('/v1/fiance',     fianceSyncRouter);
```

`configureFiance` already sets `syncNamespace:'fiance'` and `sharedSpacesNamespace:'octospaces'`,
so the SDK auto-prefixes every request with `/v1/fiance/pull|push/…` or
`/v1/octospaces/pull|push/…` respectively — no further client-side change needed.

Keep in sync with `Infra/sync/server/drakkar_sync/apps/fiance/collections.py`.

### Dev vs production server

Develop against the **octospaces dev server** (`apps/server`, already on
`alpha.27` with the cap-cert resolver + space enricher + queuing). The Worker
(`fiance-sync`) is pinned to `starfish-server@2.3.0` with a different role
model — port it as a **separate phase**:

1. Add `starfish-server@3.0.0-alpha.27` to `apps/server/package.json`.
2. Swap `roleResolver` for content collections → `createCapCertRoleResolver` + `makeSpaceRoleEnricher`.
3. Add the `fiance` content collections (the R2 `ObjectStore` implementation in
   `server/index.ts` already satisfies the `ObjectStore` interface — keep it).
4. **Doubloon IAP / `entitlements` — must NOT swap resolver for these routes.**
   The actual Doubloon/IAP routes in `server/index.ts` are **`/iap/apple`**,
   **`/iap/google`**, and **`/stripe/webhook`** (NOT `/webhook/doubloon` — that path
   does not exist). These write `entitlements` using a Bearer `DOUBLOON_ADMIN_TOKEN` →
   `admin` role granted by the legacy `roleResolver`. The cap-cert resolver has no
   Bearer→admin path. Port Doubloon as a **separate phase**; until then the Worker
   keeps two resolver paths: cap-cert for content + the legacy Bearer check for the
   three IAP/Stripe routes only.
5. **Remove `keyring` + `gift-claims` from Worker `SyncConfig`.** `server/starfish-config.ts`
   declares both collections explicitly. They must be deleted from the Worker config after
   Phase B — they will not exist in the new `fiance` namespace.
6. **Remove `ENCRYPTION_SECRET` from `wrangler.toml`.** The Worker currently passes
   `ENCRYPTION_SECRET` (a server-side AES key) to `createSyncRouter` for server-side content
   encryption. In Phase B encryption is fully client-side (space keyring); the binding becomes
   dead weight. Remove it from `wrangler.toml` and the Worker entrypoint after Phase B.
7. **`isValidUserId` in `server/doubloon.ts` must accept 32-char hex.** Currently validates
   `/^[0-9a-f]{16}$/i` (v2.3 8-byte userId). Phase B userIds are 32-char hex
   (`userIdFromEdPub`). Update the regex to `/^[0-9a-f]{32}$/i` or all post-migration
   Doubloon webhook entitlement writes will silently fail.

**Phase A:** move the root-level `wrangler.toml` (Cloudflare Pages deploy config for the web
app) to `apps/mobile/wrangler.toml` as part of the monorepo restructure (§1). The Worker's
own `wrangler.toml` moves to `apps/server/wrangler.toml`.

---

## 14. Data migration: v6 backup → space + ObjectNode tree

Today a live wedding is one encrypted `wedding/{userId}` blob (`BackupData`,
`BACKUP_VERSION=6`, verified `lib/sync.ts`) plus plaintext `wedding-page` /
`rsvp-roster` / `rsvp-inbox` / `keyring` collections. This is a genuine
**shape conversion** (unlike OctoVault where nodes already existed).

### 14.0 — Sync-pattern replacements in `rsvp-sync.ts`

`submitRsvp()` and `pushRsvpRoster()` call `SyncManager.update(callback)` — a pull →
mutate → push loop with conflict retry. `SyncManager` is removed in v3. In
`src/sync/rsvp.ts` (Phase B) replace these with the same pull/retry pattern used in
`updateObjectIndex`:

```ts
for (let i = 0; i < 3; i++) {
  const res = await client.pull(path).catch(() => null);
  try { await client.push(path, mutate(res?.data), res?.hash ?? null); return; }
  catch (e) { if (!(e instanceof ConflictError) || i === 2) throw e; }
}
```

`fetchRsvpRoster` and `fetchRsvpInbox` (plain `StarfishClient.pull` calls) become
direct `client.pull(objInvPull(spaceId, nodeId))` calls in v3 with no other change.

### 14.0 — Keep bespoke / nothing to convert

| Data | Disposition | Why |
|---|---|---|
| `_spaces` / `Space` / `_access` | Created fresh by `createSpace` | Account registry, not content |
| Old `keyring` / `GroupKeyring` | **Drop** | Replaced by `spacekeyring`; re-minted via `ownerEnsureKeyring` on first `enc` node |
| `rsvp-roster` | **Drop** | Replaced by per-guest `rsvp` nodes + invite link caps |
| `rsvp-inbox` submissions | Convert (seed) then drop | Fold pending into per-guest `rsvp` `objinv` docs |
| `wedding-page` doc | **Convert** | Becomes the `publicPage` node's `objinv` content |
| `gift-claims` | Convert / drop | Fold into `gift` node content or per-guest write; collection retires |
| `entitlements` / Doubloon IAP | **Keep bespoke** | Premium is orthogonal to spaces; Worker webhooks unchanged |

**TTL gap:** the old `rsvp-inbox` collection had a 30-day TTL and `gift-claims` had a 90-day
TTL (`server/starfish-config.ts`). ObjectNodes have **no built-in expiry**. Decide before
migration:
- `rsvp` nodes: keep indefinitely (the per-guest RSVP is a permanent record) — recommended.
- `gift-claims`: fold into the `gift` node's enc `objdoc` as a `claimedBy`/`claimedAt` field;
  the 90-day self-destruct is no longer needed since the claim now lives inside the E2EE doc.
- If ephemeral behaviour is still required, implement a server-side cron that deletes nodes
  older than N days by calling `removeSpaceMember(ephemeralGuestId)` + archiving the node.
| `analytics-events` | Keep bespoke | Fire-and-forget telemetry |
| Zustand / KV local state | Rehydrate from node tree | Local cache; same role as `restoreFromBackup` today |

### 14.1 — Relocate recipe (run once per wedding, with owner session)

```ts
import {
  buildSession, generateSeedWords, createSpace, createNode, readObjectTree,
  objDocPush, objInvPush, getNodeAccess, buildEncryptor, openEncryptor,
} from '@fiance/sdk';

// Helper: encrypt + push a content doc to objdoc (space-member + enc nodes)
async function writeEncDoc(session: Session, spaceId: string, nodeId: string, data: unknown) {
  const { enc } = await getNodeAccess(session, spaceId, nodeId, { enc: true });
  await enc.push(objDocPush(spaceId, nodeId), data);
}

// Helper: push a plaintext invite-node content doc to objinv (invite+enc:false nodes)
async function writeInvDoc(session: Session, spaceId: string, nodeId: string, data: unknown) {
  await session.spaceClient(spaceId).push(objInvPush(spaceId, nodeId), data, null);
}

// Identity continuity: generate a fresh seed for the new owner session.
// The v6 backup is decrypted with the OLD 2.3 key (see legacyPull below),
// then re-encrypted under the new space keyring. The old passphrase is only
// needed to decrypt the legacy backup — after a successful relocate it is discarded.
const seedWords = generateSeedWords();  // store securely (12-word BIP-39 phrase)
const session = await buildSession({ seedWords });
const space   = await createSpace(session, weddingLabel);

// pull + decrypt the legacy v6 backup with the OLD 2.3 client + old key
// oldUserId = legacyDeriveCredentials(passphrase).authToken.slice(0, 16) (8-byte hex)
// oldKey    = the 2.3 encryption key derived from the same passphrase
const v = migrateBackup(await legacyPull(`/pull/wedding/${oldUserId}`, oldKey));
// migrateBackup = the existing restoreFromBackup v1→v6 chain from fiance-sdk/src/sync/backup.ts

const map: Record<string, string> = {}; // oldId → nodeId, per type

// 1. Wedding root (enc)
const weddingNode = await createNode(session, space.id, {
  type: 'wedding', title: 'Wedding', access: 'space', enc: true,
});
await writeEncDoc(session, space.id, weddingNode.id,
  pick(v.wedding, ['partner1Name','partner2Name','weddingDate','venueName',
                   'description','faq','eventPhotos','budgetTarget','categoryBudgets','currency']));

// 2. Relocate each collection — preserve FK joins via meta (non-PII keys only)
for (const g of v.guestGroups) {
  const n = await createNode(session, space.id,
    { type:'guestGroup', title:g.name, access:'space', enc:true, parentId:weddingNode.id });
  map[`guestGroup:${g.id}`] = n.id;
  await writeEncDoc(session, space.id, n.id, { name: g.name });
}
for (const guest of v.guests) {
  const parentId = guest.groupId ? map[`guestGroup:${guest.groupId}`] : weddingNode.id;
  const n = await createNode(session, space.id, {
    type:'guest', access:'space', enc:true, parentId,
    meta: { legacyId:guest.id, groupId:guest.groupId, tableId:guest.tableId,
            companionId:guest.companionId, accommodationId:guest.accommodationId },
  });
  map[`guest:${guest.id}`] = n.id;
  await writeEncDoc(session, space.id, n.id, guest);  // ALL PII in enc objdoc, never meta
}
// … repeat for tables, vendors→quotePricing/vendorPayment(children),
//   accommodations, gifts, invitationTypes, taskCategories→tasks(children),
//   agendaEvents, dayOfItems, ideaCollections→ideas(children).
//   Keep a map[`type:oldId`] per type to rewrite FK references.

// 3. Guest page (plaintext objinv)
const pageNode = await createNode(session, space.id,
  { type:'publicPage', access:'invite', enc:false, parentId:weddingNode.id });
await writeInvDoc(session, space.id, pageNode.id, buildPublicPageFromBackup(v));

// 4. One rsvp node per guest; seed from old rsvp-inbox if present
for (const guest of v.guests) {
  const rsvp = await createNode(session, space.id,
    { type:'rsvp', access:'invite', enc:false, parentId:pageNode.id,
      meta:{ guestNodeId: map[`guest:${guest.id}`] } });
  const oldSubmit = oldSubmissionFor(guest); // fetch from legacy rsvp-inbox
  if (oldSubmit) await writeInvDoc(session, space.id, rsvp.id, oldSubmit);
}

// Verify — read the index and run buildTree to catch FK orphans without writing
const tree = await readObjectTree(session, space.id);
const { roots, orphans } = buildTree(tree);
console.assert(orphans.length === 0, 'FK orphans after relocate:', orphans);
```

**Batch node creation:** the recipe above calls `createNode` per entity, which does a
full `updateObjectIndex` pull-mutate-push per call. For a 200-guest wedding this is
400+ round-trips. Prefer batching: collect all nodes first, then write the index once:

```ts
// collect all nodes synchronously (no createNode calls yet)
const allNodes: ObjectNode[] = [];
for (const g of v.guestGroups)  allNodes.push(makeNode({ type:'guestGroup', … }));
for (const guest of v.guests)   allNodes.push(makeNode({ type:'guest', … }));
// … all 16 types …

// one updateObjectIndex call seeds the entire tree
await updateObjectIndex(session, space.id, () => allNodes);

// then write enc docs in parallel (each is an independent objdoc push)
await Promise.all(allNodes.map(n => writeEncDoc(session, space.id, n.id, docDataFor(n))));
```

`writeEncDoc` = resolve `getNodeAccess(…, { enc:true })` → encryptor opens the space
keyring → push to `objDocPush(spaceId, nodeId)`.
`writeInvDoc` = plaintext push to `objInvPush(spaceId, nodeId)` (no encryptor).

`buildTree` (re-exported from octospaces-sdk) reparents orphans/cycles to root
so a missed FK never crashes the tree.

---

## 15. Infra / server follow-ups

1. **`fiance` namespace Cloudflare Worker**: port `apps/server/fiance-sync` to
   the new cap-cert model (§13 above). Gate on Phase B being stable.
2. **`Infra/sync/server/drakkar_sync/apps/fiance/collections.py`**: add the
   `fiance` namespace in lockstep with §13.
3. **Directory projection**: add a `fiance` projection sourcing from the
   `objindex` collection if a public space directory is ever needed. Not required
   initially (no `access:'public'` nodes).
4. **`links[]` roster field** (optional): add `links: string[]` alongside
   `members[]` in `_access` so ephemeral guest link-bearer ids don't inflate the
   displayed member count.

---

## Summary checklist

> Status as of 2026-06-14 — **nothing started**. `wedding-os` is still a flat
> Expo repo on starfish `^2.3.0` with no `packages/` or `apps/` dirs.

### Phase A — Monorepo + SDK extraction (ship first, stays on starfish 2.3)

- [ ] **A1 · Monorepo skeleton**: `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`; app → `apps/mobile`, server → `apps/server`; Metro `watchFolders`/`projectRoot`/`nodeModulesPaths`; TS alias `@fiance/sdk → ../../packages/fiance-sdk/src/index.ts`; root `wrangler.toml` (Pages) → `apps/mobile/wrangler.toml`; Worker `wrangler.toml` → `apps/server/wrangler.toml`
- [ ] **A2 · fiance-sdk skeleton**: `package.json` (type:module, dual exports, tsup/vitest) copied from `octospaces-sdk` template; `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts` copied verbatim
- [ ] **A3a · Keystone extraction**: `GuestCounts` + `computeCounts` + guest/table/group pure reducers out of `useGuestsStore.ts` → `src/domain/guests.ts`; `lib/budget.ts` + `lib/sync.ts` repointed; tests green before continuing
- [ ] **A3b · Domain moves**: `schema.ts`, `types.ts` (minus icons → `lib/vendor-icons.ts`), `budget.ts`, `planning.ts` (inject randomId/t), `vendor-config.ts`, `registry.ts` (inject SecureKvAdapter) → `src/domain/`
- [ ] **A3c · Sync moves**: `lib/sync.ts` → `src/sync/backup.ts` (pure createBackupDocument/restoreFromBackup + v1→v6); `lib/public-page.ts` (pure builder) → `src/sync/public-page.ts`; `lib/rsvp-sync.ts` (non-React) → `src/sync/rsvp.ts`; `lib/server.ts` → `src/sync/server-config.ts`; `lib/export-import.ts` (core) → `src/sync/export-import-core.ts` **+ fix `expo-file-system/legacy` → `expo-file-system`**; `lib/analytics.ts` → `src/analytics.ts` (inject storage + platform)
- [ ] **A4 · Store split**: 10 sync stores split into SDK pure reducer + app-side `persistX`/`notifySync`; 3 exempt stores handled separately: `useBudgetStore` (pure computed, shell only), `useSettingsStore` (SecureStore-local, stays as-is), `useWeddingRegistryStore` (pure registry → `src/domain/registry.ts`, shell keeps SecureStore wiring); no SDK module imports a store, Expo, or i18n
- [ ] **A5 · Re-export barrel + import rewrite**: `src/index.ts` exports domain + sync modules; `@/lib/*` + `@/db/*` + pure `@/store/*` imports in `apps/mobile` rewritten to `@fiance/sdk`; `git grep "@/lib/" apps/mobile` shows only UI-only remainders
- [ ] **A6 · Test migration**: 8 pure-logic tests → `packages/fiance-sdk/src/**/*.test.ts`; 3 hook/IO tests stay in `apps/mobile/__tests__/`; SDK `vitest.config.ts` node env, no `@` alias; `pnpm -r test` green
- [ ] **A · Ship gate**: `pnpm -r build` + `pnpm -r typecheck` green; app boots on web + dev build with behaviour identical to pre-migration; `pnpm --filter @fiance/sdk build` emits valid `dist/`

### Phase B — starfish bump + octospaces adoption + data remodel (irreversible)

- [ ] **B1 · Starfish bump**: `pnpm up "@drakkar.software/starfish-*@3.0.0-alpha.27"` + `pnpm up "@drakkar.software/sunglasses-*@latest"` across app/sdk/server; rename `usersFromEdPubs` → `userIdFromEdPub`; add `?? []` guards on `ScopePreset.paths`; delete all `starfish-client/group` imports
- [ ] **B1 · octospaces-sdk**: add `@drakkar.software/octospaces-sdk@0.4.3` to fiance-sdk dep + mobile peer dep
- [ ] **B2 · Config**: `FianceConfig extends OctoSpacesConfig`; `configureFiance(cfg, kv)` calls `configureOctoSpaces({ syncBase, syncNamespace:'fiance', sharedSpacesNamespace:'octospaces' })` + `configureKv(kv)`; called at app boot in `lib/providers.tsx`
- [ ] **B2 · Native platform adapter**: add `react-native-quick-crypto` dep; set `newArchEnabled:true` in `app.json` + `eas.json` development/preview profiles; `import '@fiance/sdk/platform'` at app root entry
- [ ] **B2 · Files deleted/redirected**: `lib/identity.ts` → octospaces-sdk; `lib/group-crypto.ts` deleted; `lib/links.ts` → thin wrapper re-exporting octospaces-sdk invite codecs (seahorse dep removed); `lib/starfish.ts` transport → `makeClient`/`fetchWithTimeout`/live-sync-bus; `notifySync()` → `dispatchDocChange('*')` wrapper; `createDebouncedSync` + `createDebouncedPush` + `SyncManager` + `createMobileLifecycle` + `fetchServerConfig` all deleted
- [ ] **B2 · Sync-status UX**: `onSyncStatusChange`/`getSyncStatus`/`getLastSyncTimestamp` in `lib/starfish.ts` → `onSseStatus(listener)` from octospaces-sdk; `AppState`/`NetInfo` lifecycle → `emitSseStatus` calls; size-warning toasts removed (no single-blob size cap in ObjectNode model)
- [ ] **B2 · pullEntitlements**: replace 3 call sites in `lib/providers.tsx`, `lib/iap.ts`, `lib/stripe.ts` — use direct `client.pull('entitlements/…')` via cap-cert auth (or a dedicated endpoint post-Doubloon port)
- [ ] **B2 · Call sites**: `inviteToSpace`/`acceptSpaceInvite` replaces GroupKeyring partner invite; `addDeviceToSpaceKeyring` replaces bespoke multi-device; `buildSession`/`generateSeedWords` replaces `deriveCredentials`/`generatePassphrase`
- [ ] **B2 · KvAdapter**: `lib/kv-storage.ts` verified against `KvAdapter` interface; web variant `lib/kv-storage.web.ts` — call `initStorage(databaseName)` before `configureKv`; `onDeleteDb` in `src/domain/registry.web.ts` calls `purgeStorage(dbFileName)`
- [ ] **B3 · FIANCE_TYPES**: 16 domain + 2 guest-surface types declared in `src/objects/object-types.ts`
- [ ] **B4 · Path extension**: `fiance-sdk/src/paths.ts` extends `accountScope` with fiance content collections; deprecated bespoke collections (`wedding`, `wedding-page`, `rsvp-roster`, `rsvp-inbox`, `gift-claims`, `entitlements`) listed for removal once server migration completes
- [ ] **B5 · Server `fiance` namespace**: `fiance-config.ts` created with 8 content collections (`objindex`/`objdoc`/`objlog`/`objsnap`/`objblob`/`objpub`/`objinv`/`typeindex`); `objinv` gated `cap:read:objinv`/`cap:write:objinv` ONLY; wired with `createCapCertRoleResolver` + `makeSpaceRoleEnricher`; router mounted at `app.route('/v1/fiance', fianceSyncRouter)` in `apps/server/src/index.ts`
- [ ] **B5 · Doubloon/entitlements resolver isolation**: Worker keeps legacy Bearer→admin resolver for `/iap/apple`, `/iap/google`, `/stripe/webhook` routes (NOT `/webhook/doubloon` — that path doesn't exist); cap-cert resolver handles all content routes; coexist until Doubloon is separately ported
- [ ] **B5 · `isValidUserId` in `server/doubloon.ts`**: update regex from `/^[0-9a-f]{16}$/i` → `/^[0-9a-f]{32}$/i` (Phase B userIds are 32-char hex from `userIdFromEdPub`)
- [ ] **B5 · Worker config cleanup**: remove `keyring` + `gift-claims` collections from Worker `SyncConfig`; remove `ENCRYPTION_SECRET` binding from `wrangler.toml` (server-side encryption replaced by client-side space keyring)
- [ ] **B6 · Identity continuity**: relocate generates fresh `seedWords`; v6 backup decrypted with old passphrase key (`authToken` from `deriveCredentials`) + re-encrypted under new space keyring; old passphrase discarded after successful relocate
- [ ] **B6 · TTL replacement**: `gift-claims` 90d TTL → `claimedBy`/`claimedAt` in enc `gift` objdoc; `rsvp-inbox` 30d TTL → permanent per-guest `rsvp` nodes (no expiry needed)
- [ ] **B6 · rsvp-sync v3**: `SyncManager.update()` → manual pull/retry loop in `src/sync/rsvp.ts`; `fetchRsvpRoster`/`fetchRsvpInbox` → direct `client.pull(objInvPull(…))`
- [ ] **B6 · RSVP URL format**: `buildWeddingPageUrl` updated/replaced with `encodeNodeInviteLink` output; all existing QR codes + shared RSVP links invalidated — couples regenerate after relocate
- [ ] **B6 · Data migration**: v6 backup relocate recipe run per wedding; all 16 entity types batched into enc ObjectNodes via single `updateObjectIndex`; enc docs pushed in parallel; guest page + per-guest rsvp nodes seeded; FK integrity verified via `readObjectTree` + `buildTree`; old flat collections retired
- [ ] **B6 · Guest page**: `publicPage` + per-guest `rsvp` nodes (`access:'invite', enc:false`) created; `serializeForIndex` strips titles in `_index`; `createNodeInviteLink(session, spaceId, nodeId, name, {enc:false}, write, origin)` mints per-guest caps; `writeNodeWithLinkCap` helper added to `src/sync/rsvp.ts` for app-less RSVP
- [ ] **B6 · E2EE encryption test**: delete `__tests__/sync-encryption.test.ts` (tests v2.3 `ENCRYPTION_SECRET` model); replace with `src/sync/backup.test.ts` space-keyring round-trip test (`ownerEnsureKeyring → writeEncDoc → readEncDoc`)
- [ ] **B6 · accountScope cleanup**: deprecated bespoke collections removed from `fiance-sdk/src/paths.ts` `accountScope` after server migration verified stable
- [ ] **B · E2EE verified**: `objdoc` body opaque ciphertext at rest; `_index` shows `title:''` for `publicPage`/`rsvp`; `space:member` token rejected on another node's `objinv`; partner + paired device both decrypt via one space keyring
- [ ] **Infra**: `Infra/.../fiance/collections.py` added in lockstep with server `SyncConfig`; Worker (`fiance-sync`) ported to cap-cert model; Doubloon IAP webhooks untouched
- [ ] **Deferred**: directory projection from `objindex` (only needed if `access:'public'` nodes are added later); `links[]` field in `_access` to separate ephemeral guest bearer ids from displayed members
