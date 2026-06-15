# Changelog — @drakkar.software/octospaces-sdk

## 0.8.0 (2026-06-15)

### Added

- **`objPubLogName/Pull/Push(spaceId, nodeId)`** — path helpers for the public
  append-log collection (`objpublog`): `spaces/{spaceId}/objects/pub/{nodeId}/log`.
  For `access:'public'` nodes with an append-log content kind (e.g. public chat rooms).
  Public-read + member-write. Covered by `spaceMemberScope`.
- **`objInvLogName/Pull/Push(spaceId, nodeId)`** — path helpers for the invite-only
  append-log collection (`objinvlog`): `spaces/{spaceId}/objects/n/{nodeId}/log`.
  For `access:'invite'` nodes with an append-log content kind. Cap-gated via the sharing
  plugin — excluded from `spaceMemberScope`, same as `objinv`.
- **`objOwnerName/Pull/Push(spaceId, nodeId)`** — path helpers for the owner-only content
  collection (`objowner`): `spaces/{spaceId}/objects/owner/{nodeId}`. For `access:'owner'`
  nodes (webhooks, private config). Only `spaceOwnerScope` / `ownerScope` reach it.
- **`inboxName/Pull/Push(identity, shard?)`** — path helpers for the identity inbox
  collection (`inbox`): `inbox/{identity}/{shard}`. Public-write, `cap:read:inbox`-gated
  read. Time-sharded by UTC month. Identity-scoped (NOT under `spaces/`).
- **`spaceDirName/Pull(shard?)`** — path helpers for the public space directory
  projection at `_index/spaces/{shard}`. Default shard `'public'` (spaces with at least
  one public room); `'meta'` shard carries name+image for all spaces.
- **`spaceOwnerScope(spaceId)`** — new scope: owner r/w access to ONE space, covering
  `OBJECT_COLLECTIONS + ['objowner']` under `spaces/{spaceId}/**`.
- **`OBJECT_COLLECTIONS`** extended with `'objpublog'` — space members can write to
  public append-logs, so it belongs in the broad member scope.

### Changed

- **`ownerScope()`** now includes `'objowner'` (the owner content tier) in its
  collection list alongside `OBJECT_COLLECTIONS`.
- **`linkedDeviceScope(userId)`** extended with `'objowner'` (linked device acts as
  owner) and `'inbox'` (reads the identity's DM inbox), plus `inbox/${userId}/**` path.
- **`accountScope(userId)`** extended with `'inbox'` collection and
  `inbox/${userId}/**` path so the identity can read their own DM inbox.

## 0.7.0 (2026-06-15)

### Added

- **`buildSignedEventsRequest(spaceIds, config?)`** — pure helper that builds the
  fetch URL and signed `pathAndQuery` for a Starfish `/events` SSE request. Strips
  the `syncBase` mount prefix from the signed path (so nginx-fronted deployments
  where the mount is rewritten before reaching the origin continue to authenticate
  correctly) and encodes the space-id comma as `%2C` (CDN-normalisation-safe).
  Reads from global `configureOctoSpaces()` config by default; `config` override
  accepts `{ eventsUrl?, syncBase? }` for use in tests.
- **`parseSseFrames(chunk, carry)`** — incremental WHATWG SSE frame parser. Returns
  `{ events, carry }` — `events` is an array of parsed `data:` payloads from
  completed frames; `carry` is the leftover text to prepend on the next chunk.
  Normalises `\r\n` line endings and skips `id:`, `event:`, and `:` (comment/heartbeat)
  lines per the SSE spec.
- **`subscribeChanges<T>(opts)`** — single auto-reconnecting SSE subscription.
  App-specific payload parsing is injected via `opts.parse(data) => T | null` so
  the transport is domain-agnostic. Uses capped exponential backoff
  (`minReconnectMs` → `maxReconnectMs`, reset after a successful connect). Returns
  an unsubscribe function. Options: `spaces`, `authHeaders`, `parse`, `onChange`,
  `onStatus?`, `minReconnectMs? = 1000`, `maxReconnectMs? = 30000`.
- **`SubscribeChangesOptions<T>`** type exported from the barrel.
- **`getEventsUrl()`** now exported from the barrel (was previously internal).

## 0.4.3 (2026-06-13)

### Added

- **Python SDK** (`packages/python/octospaces-sdk`) — full functional port of the TS
  SDK, backed by the `starfish-*` Python packages. Provides identity, registry, objects,
  invite flows, and sync plumbing. Install via `pip install octospaces-sdk`.
- **Shared cross-language test vectors** (`tests/test-vectors/*.json`) — 7 JSON fixtures
  consumed by both vitest and pytest: `objects-tree`, `search-match`, `paths-scopes`,
  `user-id`, `room-slug`, `base64url`, `invite-links`.
- **TS vector test files** (`*.vectors.test.ts`) — 4 new vitest files asserting the TS
  SDK against the shared vectors (objects, search-match, paths/scopes/base64url, invite links).
- **CI workflow** (`.github/workflows/ci.yml`) — TypeScript job (pnpm + vitest) and
  Python job (uv, matrix 3.11/3.12/3.13) both asserting the shared vectors.
- **Monorepo restructure** — `packages/octospaces-sdk` → `packages/ts/octospaces-sdk`
  and `packages/octospaces-ui` → `packages/ts/octospaces-ui` (satellite layout;
  `pnpm-workspace.yaml` updated to `packages/ts/*`).

## 0.4.1 (2026-06-12)

### Breaking changes

- **Space-wide keyring restored.** `nodeKeyringName`, `nodeKeyringPull`, `nodeKeyringPush`
  are removed. Replaced by `keyringName`, `keyringPull`, `keyringPush` (one keyring per
  space, at `spaces/{spaceId}/_keyring`, collection `spacekeyring`).
- **`nodeMemberScope` no longer includes `'nodekeyring'`** — collections is now
  `['objinv']` only. Use `spaceMemberScope` when the bearer also needs to decrypt enc
  content (they need `spacekeyring` + `spaces/{spaceId}/**` path).
- **`OBJECT_COLLECTIONS` updated**: `'nodekeyring'` → `'spacekeyring'`.

### Added

- **`keyringName(spaceId)`** — base path for `addCollectionRecipient` calls.
- **`keyringPull(spaceId)` / `keyringPush(spaceId)`** — pull/push paths for the
  space-wide keyring at `spaces/{spaceId}/_keyring`.
- **`addDeviceToSpaceKeyring(session, spaceId, device)`** — add a paired device's KEM
  key to a space's keyring. Call after device pairing for each space the new device
  should decrypt. ONE call per space unlocks all `enc` nodes.

### Changed

- **`inviteToSpace`** now adds the invitee to the space-wide keyring (if it exists) so
  they can decrypt `enc` nodes from the start. Silently skips if the keyring doesn't
  exist yet (no enc nodes in the space).
- **`createSpaceInviteLink`** adds the ephemeral KEM to the space keyring (if it exists).
- **`inviteToNode(enc=true)`** adds the invitee to the SPACE keyring (not a per-node
  keyring) — granting decryption access to ALL enc nodes in the space.
- **`createNodeInviteLink(enc=true)`** uses `spaceMemberScope` for the cap (so the bearer
  can reach the space keyring) and adds the ephemeral KEM to the space keyring.
- **`getNodeAccess`** / **`buildNodeAccess`** open the SPACE keyring (not a per-node
  keyring) when `node.enc` is true.
- **`startDevicePairing`** comment updated — post-pairing call `addDeviceToSpaceKeyring`
  rather than `inviteToNode` per enc node.

### Semantic note

The space keyring is coarse-grained: any keyring-holder with reach can decrypt ALL
`enc` nodes in the space. Inviting someone to one `enc` node grants them the space key
and thus access to all enc content. Per-node E2EE isolation requires per-node keyrings
(which are opt-in at the app level; the shared SDK no longer manages them).

---

## 0.4.0 (2026-06-12)

### Breaking changes

- **`SpaceVisibility` removed.** The type `'private' | 'public'` no longer exists; spaces
  are neutral containers. Visibility/encryption move to the node level (see below).
- **Space-level keyring removed.** `keyringName`, `keyringPull`, `keyringPush` are gone.
  There is no per-space CEK. Encryption is per-node.
- **`addDeviceToSpaceKeyring` removed.** Pairing no longer auto-grants a linked device
  access to E2EE nodes — the owner must call `inviteToNode` per node after pairing.
- **`getSpaceAccess` / `buildSpaceAccess` / `clearSpaceAccessCache` / `SpaceAccessHandle`
  removed.** Replaced by `getNodeAccess` / `buildNodeAccess` / `clearNodeAccessCache` /
  `NodeAccessHandle`.
- **`spaceIndexName` / `spaceIndexPull` removed.** Replaced by `objectDirName` /
  `objectDirPull` (target `_index/objects/{shard}`).
- **`createSpace(session, name, opts?)` — `opts` removed.** Spaces no longer have a
  `visibility` or `type`/`subtype`; call is now `createSpace(session, name)`.
- **`Space.visibility`, `Space.ownerId`, `Space.write` removed.** `Space` interface now
  carries only `{ id, name, short, image?, members, unread? }`.
- **`SpaceMeta.type` / `SpaceMeta.subtype` removed.**
- **`joinSpaceByLink` no longer sets `visibility`/`ownerId`/`write` on the returned Space.**
- **`acceptSpaceInvite` no longer requires `cap.iss`.** Keyring verification is gone.

### Added

- **`NodeAccess = 'public' | 'space' | 'invite'`** — per-node access axis. Absent ⇒ `'space'`.
- **`ObjectNode.access?: NodeAccess`** and **`ObjectNode.enc?: boolean`** — two orthogonal
  axes. The invalid combo `public+enc` is rejected at `createNode`/`setNodeAccess`.
- **Per-node keyrings**: `nodeKeyringName/Pull/Push(spaceId, nodeId)` at
  `spaces/{spaceId}/objects/n/{nodeId}/_keyring` (collection `nodekeyring`).
- **Public node content**: `objPubName/Pull/Push(spaceId, nodeId)` at
  `spaces/{spaceId}/objects/pub/{nodeId}` (collection `objpub`, `readRoles:['public']`).
- **Invite-only plaintext content**: `objInvName/Pull/Push(spaceId, nodeId)` at
  `spaces/{spaceId}/objects/n/{nodeId}/content` (collection `objinv`, excluded from
  `spaceMemberScope`).
- **Global object directory**: `objectDirName/Pull(shard?)` → `_index/objects/{shard}`.
- **`nodeMemberScope(spaceId, nodeId, canWrite)`** — narrow per-node cap covering
  `['nodekeyring', 'objinv']`. Only this scope reaches invite-plaintext content.
- **`OBJECT_COLLECTIONS`** updated: `spacekeyring` → `nodekeyring`; `objpub` added;
  `objinv` intentionally absent (excluded from broad scope by design).
- **`getSpaceClient(spaceId, session)`** — returns the member-gated client for index/access
  docs; always plaintext.
- **`getNodeAccess(spaceId, nodeId, node, session, reg?)`** — resolves `{ encryptor, client,
  isOwnerOpen }` for a specific node's content.
- **`buildNodeAccess(session, spaceId, nodeId, node)`** — soft variant (returns null instead
  of throwing on missing access).
- **`clearNodeAccessCache()`** — drop cached handles on account switch.
- **`getNodeAccessEntry / saveNodeAccessEntry / removeNodeAccessEntry`** — per-node entries
  in the unified space-access store (composite key `${spaceId}:${nodeId}`).
- **`readObjectTree(session, spaceId)`** — read-only pull of a space's node list.
- **`spaces/nodes.ts`** — new module:
  - `createNode(session, spaceId, input, reg?)` — creates a node; mints per-node keyring
    for `enc` nodes.
  - `setNodeAccess(session, spaceId, nodeId, patch, reg?)` — flips `access`/`enc` flags.
  - `inviteToNode(session, spaceId, nodeId, requestJson, node, nodeName?)` — owner-side
    direct invite; adds to keyring (`enc`) or mints narrow cap (`invite+plaintext`).
  - `acceptNodeInvite(session, bundleJson)` — invitee stores per-node access.
  - `createNodeInviteLink(…)` — shareable link invite for a specific node.
  - `joinNodeByLink(session, token)` — bearer stores per-node link entry.
- **`NewObjectInput.access?` / `NewObjectInput.enc?`** — `addObject` passes these through
  to the node; `patchObject` now accepts them in its patch type.
- **`pushIndexSeed` API simplified**: `pushIndexSeed(client, spaceId, nodes?)` — no
  encryptor argument (index is always plaintext).

### Changed

- Object index is **always plaintext**. `invite` node entries have `title` / `emoji`
  stripped before storage (non-invited members see a placeholder row only).
- **`inviteToSpace`** no longer adds the invitee to a space keyring (there is none).
- **`acceptSpaceInvite`** no longer verifies keyring access.
- **`startDevicePairing`** no longer auto-grants linked devices to space keyrings.

---

## 0.3.0 (2026-06-12)

### Added

- **`Space.type` / `Space.subtype`** — optional opaque string fields on the `Space` interface.
  App-owned; no builtins defined in the SDK (`'chat'`, `'vault'`, `'chat-only'`, etc. are yours
  to declare).
- **`SpaceMeta.type` / `SpaceMeta.subtype`** — same fields added to the write-side meta struct.
- **`writeSpaceAccess`** now persists `type` / `subtype` when truthy; `readSpaceAccess` reads them
  back (string | null). Both are threaded through `addSpaceMember` / `removeSpaceMember` so roster
  edits no longer drop them.
- **`createSpace`** accepts `opts.type` / `opts.subtype`; both are stored in `_access` and
  mirrored on the returned `Space` object.
- **`spaceIndexName` exported** from the barrel (`src/index.ts`). `spaceIndexPull` / `spaceIndexName`
  signatures generalised from `(shard: 'public')` to `(shard?: string)` — default `'public'`
  keeps existing call sites unchanged. Clients read a typed catalog via `spaceIndexPull('chat')`.

### Notes

`type` / `subtype` may be set on private spaces (stored in the member-gated `_access` doc, not
publicly visible). Only public spaces reach the world-readable directory; the server projection
shards on `type`. Treat `type` as set-at-create — changing it after the fact leaves a stale row
in the old shard (same caveat as public → private flips today).

---

## 0.2.0 (2026-06-12)

### Breaking changes

- **Domain object types removed.** `BuiltinObjectType`, `BUILTIN_OBJECT_TYPES`, `RoomKind`,
  `RoomSubtype`, `AutomationMeta`, `AutomationSchedule`, and `Room` are no longer exported.
  `ObjectType` is now `string`. Apps must declare their own type constants.
- **`ObjectNode` fields removed.** `subtype` and `automation` fields are gone; store
  app-specific node config in the existing `meta?: Record<string, unknown>` field instead.
- **Room/category bridge functions removed.** `categoryId`, `DEFAULT_CATEGORY`,
  `objectsToRoomCategories`, `excludeAutomatedRooms`, `roomKindToSubtype`, `subtypeToRoomKind`,
  `AdaptedCategory`, `SeedRoom`, `seedIndexNodes`, `normalizeCategories`, `CategoryError`.
- **Room projection functions removed.** `readIndexRooms`, `readSpaceIndexRooms`,
  `readSpaceRooms`. Use `updateObjectIndex(session, spaceId, nodes => nodes, reg)` as a
  read-only alternative.
- **Access-record helpers renamed.** `roomsRegistryPull`/`roomsRegistryPush` →
  `spaceAccessPull`/`spaceAccessPush`; `readRooms`/`writeRooms` →
  `readSpaceAccess`/`writeSpaceAccess`.
- **Storage leaf renamed.** Access records move from `spaces/{id}/_rooms` to
  `spaces/{id}/_access`. Apps that haven't adopted this migration continue to work via the
  Infra enricher's default `registry_path` param.
- **Collection names updated.** `rooms` → `spaceregistry`; `chatkeyring` → `spacekeyring`.
  `accountScope` and `linkedDeviceScope` updated accordingly.
- **`createSpace` no longer seeds a general channel.** The index is seeded empty; apps add
  their own initial nodes after creation.

### Migration

Adopting apps must declare their own type constants:

```ts
// e.g. in your own SDK package
export const MY_TYPES = { page: 'page', folder: 'folder' } as const;
```

Replace removed helpers:
- `readSpaceIndexRooms(session, spaceId, reg)` →
  `updateObjectIndex(session, spaceId, nodes => nodes, reg)`
- `roomsRegistryPull/Push` → `spaceAccessPull`/`spaceAccessPush`
- `readRooms/writeRooms` → `readSpaceAccess`/`writeSpaceAccess`
- `ObjectNode.subtype` → `ObjectNode.meta.subtype` (or a first-class type string)
- `ObjectNode.automation` → `ObjectNode.meta.automation`

See `OCTOCHAT_MIGRATION.md` and `OCTOVAULT_MIGRATION.md` at the repo root for full
per-app migration guides.

---

## 0.1.0 (initial)

Initial release — unified public/private spaces on one `spaces/{spaceId}/**` path family,
E2EE object index, link-based joins, cross-app keyring, and the generic `ObjectNode` tree
engine.
