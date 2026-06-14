# Changelog

All notable changes to the packages in this monorepo are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## `@drakkar.software/octospaces-ui`

### [0.3.0] — 2026-06-14 (SpacesRail — headless spaces rail component)

#### Added

- **`SpacesRail`** — headless, abstractly-themed vertical spaces rail component.
  Reads the host app's `Theme` via `useOctoSpacesTheme()`; delegates all app-specific
  concerns (icons, tile images, badges, account foot) to render props. Zero new
  runtime or peer dependencies (still `react` + `react-native` only).
  - Per-tile states: active (filled + glow), hovered (tinted), resting, and DnD
    drop-over (accent border).
  - E2EE lock corner + mute corner badges via `renderIcon`.
  - Unread count badges via `renderBadge`.
  - Web drag-reorder via `useTileDnd` hook-injection seam.
  - Optional `swatches` keys (`railTile`, `railTileHoverBorder`, `railGlow`,
    `railTileHoverInk`) for fine-tuned rail colors; each falls back to a core
    palette token.
- **`RailSpace`** — structural item type (no SDK import).
- **`RailIconName`** — `'dm' | 'lock' | 'mute' | 'add'` union.

---

## `@drakkar.software/octospaces-sdk`

### [0.6.0] — 2026-06-14 (removeJoinedSpace + moveSpace)

#### Added

- **`removeJoinedSpace(client, userId, spaceId)`** — drop a space from the identity's
  own `_spaces` list, erasing its cap and `pubAccess` credential atomically. Idempotent.
- **`moveSpace(client, userId, spaceId, toIndex)`** — move one space to an absolute
  index in the `_spaces` list (clamped, no-op when already there or absent).

### [0.4.3] — 2026-06-12 (generic utilities: search, live-sync bus, invite preview)

#### Added

- **`matchTitle(query, title)`** / **`rankResults(query, items, limit?)`** — pure title
  matcher + ranker for quick-find over object trees. Four-tier relevance (prefix → word
  boundary → substring → fuzzy subsequence); ties broken by `updatedAt` DESC.
  Exports: `matchTitle`, `rankResults`, `fold`, `isWordStart`, types `MatchRange`,
  `TitleMatch`, `RankedResult`.
- **`registerPull(docPath, fn)`** / **`dispatchDocChange(docPath)`** / **`emitSseStatus`** /
  **`onSseStatus`** / **`clearLiveSyncBus`** — generic live-sync dispatch bus for wiring
  SSE doc-change events to active pull hooks. Zero dependencies; call `clearLiveSyncBus()`
  on account switch.
- **`previewInvite(raw)`** — classify + decode an invite string (URL fragment, raw fragment,
  or private member-bundle JSON) into a typed `InvitePreview` discriminated union
  (`'space-link' | 'node-link' | 'member-bundle'`) without joining. Uses only
  `decodeSpaceInviteLink` / `decodeNodeInviteLink` internally. Safe to surface error
  messages verbatim.
  Exports: `previewInvite`, type `InvitePreview`.

#### Added (0.4.2 — published separately)

- **`MuteValue`**, **`ReadValue`**, **`PresenceStatus`**, **`VerificationLevel`** — exported
  from `core/types` (were declared but not exported). `VerificationLevel` now includes `'none'`
  for unknown/not-yet-verified state.
- **`objIndexName`**, **`objLogName`**, **`objDocName`**, **`objectBlobName`**,
  **`typesIndexName`**, **`attachmentName`**, **`spaceIdFromRoomId`** — path `*Name` helpers
  exported from the barrel (were internal-only).

### [0.3.0] — 2026-06-12 (typed + subtyped public space directory)

#### Added

- `Space.type` / `Space.subtype` — optional opaque string fields (app-owned, no SDK builtins).
- `SpaceMeta.type` / `SpaceMeta.subtype` — write-side meta.
- `writeSpaceAccess` / `readSpaceAccess` persist and return `type` / `subtype`.
- `addSpaceMember` / `removeSpaceMember` thread `type` / `subtype` through roster writes.
- `createSpace` accepts `opts.type` / `opts.subtype`.
- `spaceIndexName` exported from barrel; both `spaceIndexName` / `spaceIndexPull` accept any
  shard string (default `'public'`).

## `@octospaces/server`

### [0.2.0] — 2026-06-12 (typed shard projection)

#### Changed

- `spaceTarget` now shards the public directory by `body.type` — untyped spaces still land in
  `_index/spaces/public`; typed spaces land in `_index/spaces/{type}` (sanitised).
- `projectSpaceRegistry` adds `subtype` to each directory row.

---

## `@drakkar.software/octospaces-sdk`

### [Unreleased] — 2026-06-12 (unified spaces refactor)

#### Changed — **breaking** (pre-publish clean break; no consumers yet)

- **Unified public + private spaces onto a single path family** — public spaces now live
  under `spaces/{spaceId}/**` with the same OBJECT_COLLECTIONS scopes as private spaces.
  The separate `pubspaces/{ownerId}/{spaceId}/**` path tree, `pubspace`/`pubstream`
  collections, and all `pub*` path helpers are removed from the SDK.
- `Space.type` renamed → `Space.visibility` (`'private' | 'public'`, absent ⇒ `'private'`).
  New exported type `SpaceVisibility`.
- `createSpace(session, name)` now accepts an optional third argument
  `opts?: { visibility?: SpaceVisibility }`. Public-space creation skips the keyring.
- `isPublicSpaceId` / `psp-` id prefix dropped — visibility is stored in data, not in
  the id. All spaces mint `sp-*` via `newSpaceId()`.
- `SpaceEncryptor` / `getSpaceEncryptor` / `buildSpaceEncryptor` / `clearSpaceEncryptors`
  replaced by `SpaceAccessHandle` / `getSpaceAccess` / `buildSpaceAccess` /
  `clearSpaceAccessCache`. The new accessor returns `encryptor: null` for public spaces
  instead of refusing to resolve.
- `hydrateMemberCaps` + `saveMemberCap` + `removeMemberCap` + `clearMemberCaps` and the
  separate `hydratePubspaceCaps` / `mergePubspaceAccess` / `localPubspaceEntries` /
  `getPubspaceAccess` / `savePubspaceAccess` / `removePubspaceAccess` / `clearPubspaceCaps`
  replaced by the unified **`space-access-store`** API:
  `hydrateSpaceAccessStore`, `getSpaceAccessEntry`, `saveSpaceAccessEntry`,
  `removeSpaceAccessEntry`, `localSpaceAccessEntries`, `memberCapsFromStore`,
  `linkAccessFromStore`, `clearSpaceAccessStore`. Entry shape:
  `{ kind:'member', cap:string } | { kind:'link', cap, key, write }`.
- `hydrateMemberCaps` + `recoverPubspaceAccess` consolidated into a single
  **`recoverSpaceAccess(session, { caps, pubAccess })`** call.
- `addJoinedPublicSpaceWithAccess` renamed → `addJoinedSpaceWithLinkAccess`.
- `readPrivateIndexRooms` / `readPrivateSpaceRooms` / `readPublicIndexRooms` replaced by
  `readSpaceIndexRooms` / `readSpaceRooms`.
- `pushIndexSeed` now accepts `Encryptor | null` (plaintext push when null).
- `accountScope` and `linkedDeviceScope` no longer include `'pubspace'` collection or
  `pubspaces/{userId}/**` paths.
- `pubspaceScope`, `pubstreamBotScope`, and all `pubObjIndex*` / `pubObjDoc*` /
  `pubObjLog*` / `pubspaceRooms*` / `pubspaceWebhooks*` / `pubstreamRoom*` path helpers
  removed. Bot access: mint a narrow-path member cap via `spaceMemberScope`.
- `PubspaceAccess`, `AccessMap`, `PublicInviteToken` types removed.
- `isPublicSpaceId`, `publicSpaceAuth`, `publicSpaceClient`,
  `encodePublicInviteLink` / `decodePublicInvite`,
  `createPublicSpace`, `createPublicInvite`, `joinPublicSpace`,
  `readPublicRooms`, `readPublicRoomsDoc`, `createPublicRoom`,
  `updatePublicSpaceMeta`, `updatePublicRoomsRegistry`, `updatePublicObjectIndex`
  removed.

#### Added

- `SpaceVisibility` type (`'private' | 'public'`).
- `SpaceAccessHandle` interface + `getSpaceAccess` / `buildSpaceAccess` /
  `clearSpaceAccessCache` (unified encryptor resolver; null encryptor = public space).
- `SpaceAccessEntry` / `SpaceAccessMap` types + full `space-access-store` API.
- `recoverSpaceAccess(session, { caps, pubAccess })` — single sign-in hydration.
- `createSpaceInviteLink` / `encodeSpaceInviteLink` / `decodeSpaceInviteLink` /
  `joinSpaceByLink` — link-based joins for public spaces (token `v:1`, no `ownerId`
  field — derived from `cap.iss` on accept).
- `removeSpaceMember(client, spaceId, memberUserId)` — link revocation primitive.
- `updateObjectIndex(session, spaceId, mutator)` — unified plaintext/encrypted RMW.
- `addJoinedSpaceWithLinkAccess` (renamed from `addJoinedPublicSpaceWithAccess`).
- `readSpaceIndexRooms` / `readSpaceRooms` — unified read helpers for both space kinds.
- `spaceIndexPull` re-exported (was unreachable before).

#### Behaviour note

Write link-bearers can now create rooms in public spaces (`objindex` writeRoles is
`space:member`). Previously only owners could create rooms (via the `_rooms` plaintext
registry). This is intentional — "write access = can create channels".

### [0.1.0] — 2026-06-12

Initial release. Extracted and unified from OctoChat SDK and OctoVault starfish layer.

#### Added

- **`core/config`** — `OctoSpacesConfig`, `configureOctoSpaces()`, config getters. Supports `sharedSpacesNamespace` for cross-app shared space storage.
- **`core/types`** — `ObjectNode`, `ObjectType`, `BUILTIN_OBJECT_TYPES`, `ObjectsIndex`, `Space`, `Room`, `RoomKind`, `RoomSubtype`, `AutomationMeta`, `CapMap`, `PubAccessMap`, `DmMap`, `MutePrefs`, `ReadPrefs`, `ArchivedDms`.
- **`core/ids`** — `randomId()`, `roomSlug()`, `newSpaceId()`, `newDmSpaceId()`, `newPublicSpaceId()`.
- **`core/adapters`** — `StorageAdapter` interface for platform-local persistence.
- **`core/space-access-error`** — `SpaceAccessError` typed error class.
- **`core/storage-types`** — `KVStore` and `StorageBackend` interfaces.
- **`sync/identity`** — `Session`, `buildSession()`, `buildLinkedSession()`, `deriveSession()`. Session now carries `spacesRegistryClient` and `spacesKeyringClient` for cross-app namespace routing.
- **`sync/client`** — `makeClient()`, `openEncryptor()`, `buildEncryptor()`, `ownerEnsureKeyring()`, profile helpers (`readProfile`, `writeProfile`, `ensurePseudo`, `ensureProfileKeys`).
- **`sync/paths`** — Full merged path set (OctoChat + OctoVault). Generic `OBJECT_COLLECTIONS = ['keyring','objindex','objlog','objsnap','objdoc','objblob','typeindex']`. `ownerScope()` and `accountScope()` use generic collection names. All `obj*`, `typeIndex*`, `pubObj*` path helpers included. `accountScope` does not include `dminbox` (chat-specific — added by consumers).
- **`sync/pairing`** — `PAIR_PREFIX = 'octospaces-pair:'`. `completeDevicePairing()` accepts legacy `octochat-pair:` prefix during migration window.
- **`sync/space-encryptor`** — `SpaceEncryptor`, `getSpaceEncryptor()`, `buildSpaceEncryptor()`, `clearSpaceEncryptors()`.
- **`sync/account-seal`** — `sealToRecipient()`, `openSeal()`, `SealedBlob`.
- **`sync/member-caps`** — `hydrateMemberCaps()`, `persistMemberCap()`, `purgeMemberCaps()`.
- **`sync/pubspace-caps`** — Public-space credential storage and retrieval.
- **`sync/pull-cache`** — `pullCacheKey()`, `readPullCache()`, `writePullCache()` with `octospaces.pullcache.*` KV prefix.
- **`sync/profile-cache`** — Profile caching with `octospaces.*` KV prefix.
- **`sync/fetch-timeout`** — `fetchWithTimeout()` with configurable abort.
- **`sync/base64`** / **`sync/base64url`** — Starfish-compatible encode/decode helpers.
- **`spaces/registry`** — `createSpace()`, `readSpaces()`, `updateSpacesDoc()`, `reorderSpaces()`, `leaveSpace()`, `readRooms()`, `writeRooms()`, `broadcastSpaceMeta()`, `onSpaceMeta()`, `reconcileSpaceMeta()`.
- **`spaces/members`** — `inviteToSpace()`, `addDeviceToSpaceKeyring()`, `acceptSpaceInvite()`, `makeJoinRequest()`.
- **`spaces/object-index`** — `seedSpaceObjectIndex()`, `pushIndexSeed()`, `readIndexRooms()`.
- **`spaces/pubspace`** — Public-space read/write helpers.
- **`objects/objects`** — `buildTree()` (cycle/orphan repair), `breadcrumbs()`, `ancestors()`, `subtreeIds()`, `nextOrder()`, `categoryId()`, `DEFAULT_CATEGORY`. Node reducers: `addObject()`, `patchObject()`, `reparentObject()`, `reorderObjects()`, `archiveObject()`. `seedIndexNodes()` for new-space bootstrap. Transitional bridges marked `@deprecated`: `objectsToRoomCategories()`, `excludeAutomatedRooms()`, `roomKindToSubtype()`, `subtypeToRoomKind()`.
- **`platform/`** — `configureStarfishPlatform()` (web + native split via `./platform` export condition). Native variant installs `react-native-quick-crypto`.

---

## `@drakkar.software/octospaces-ui`

### [0.1.0] — 2026-06-12

Initial scaffold. Theme plumbing only — primitives to follow.

#### Added

- **`theme/types`** — `ColorScheme`, `Palette` (OctoVault superset: includes `editorCanvas`, `tooltipBg`, `onTooltip`), `Theme` contract (`scheme`, `colors`, `spacing`, `radii`, `type`, `fonts`, `motion`, `shadows`, `layout`, `opacity`, `swatches`, `layers`, `easing`, `labelTracking`). Types only, zero values.
- **`theme/provider`** — `OctoSpacesThemeProvider` (React context injection) and `useOctoSpacesTheme()` hook (throws with a descriptive message if called outside a provider).
- **`theme/helpers`** — Pure functions over `Palette`/`Theme`: `presenceColor()`, `verificationColor()`, `avatarTint()`, `swatch()`, `paperBorder()`, `glowShadow()`, `focusRingStyle()`, `statusColor()`.
