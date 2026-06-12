# Changelog

All notable changes to the packages in this monorepo are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## `@drakkar.software/octospaces-sdk`

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
