# Changelog — @octospaces/server

## 0.3.0 (2026-06-12)

### Breaking changes

- **`spacekeyring` collection removed.** Per-space CEK is gone; encryption is now per-node.
  Replaced by `nodekeyring` (see below).
- **`spaceindex` collection renamed to `objectindex`** (`storagePath: _index/objects/{shard}`).
  The `/pull/_index/spaces/public` endpoint no longer exists; use `/pull/_index/objects/public`.
- **Projection source changed.** The public directory projection now sources `objindex`
  writes (not `spaceregistry`) and indexes per-node access flags. Directory rows are now
  per-space lists of public nodes (not per-space metadata entries).

### Added

- **`nodekeyring` collection** — per-node multi-recipient keyring at
  `spaces/{spaceId}/objects/n/{nodeId}/_keyring`. `readRoles: ['space:member']`,
  `writeRoles: ['space:owner']`.
- **`objindex` collection** — member-readable unified object index at
  `spaces/{spaceId}/objects/_index`. `readRoles/writeRoles: ['space:member']`.
- **`objpub` collection** — world-readable public-node content at
  `spaces/{spaceId}/objects/pub/{nodeId}`. `readRoles: ['public']`,
  `writeRoles: ['space:member']`.
- **`objinv` collection** — invite-only plaintext node content at
  `spaces/{spaceId}/objects/n/{nodeId}/content`. Excluded from the broad
  `spaceMemberScope`; only per-node caps (nodeMemberScope) can reach it.
- **`objectindex` (pull-only) collection** — world-readable public-node directory at
  `_index/objects/{shard}`. Maintained by the server projection.
- **Object storage collections** (`objlog`, `objsnap`, `objdoc`, `objblob`, `typeindex`)
  now explicitly declared in `config.ts` for end-to-end dev testing.
- **Queuing** now covers `nodekeyring` and `objindex` (in addition to `spaceregistry`),
  all publishing `octospaces.space.changed` events.

### Changed

- `space-role.ts` unchanged — `makeSpaceRoleEnricher` still grants roles from `_access`.
- The projection (`projections.ts`) sources `objindex` writes, emits per-space rows
  `{ spaceId, nodes: [...], ts }` for spaces with at least one `access:'public'` node.
  A space with no public nodes emits a REMOVE tombstone.

---

## 0.2.0 (2026-06-12)

### Changed

- **Typed + subtyped public directory.** `projectSpaceRegistry` now stamps `subtype` on each
  directory row. `spaceTarget` derives the destination shard from `body.type` instead of always
  writing to `_index/spaces/public`:
  - `_index/spaces/public` — untyped public spaces (back-compat, unchanged).
  - `_index/spaces/{type}` — typed public spaces, one aggregate doc per app-owned type string.
  - `type` is owner-controlled, so it is sanitised before use as a path segment: only
    `^[a-z0-9-]{1,32}$` is accepted; anything outside that alphabet falls back to `'public'`.
  - The existing `readRoles: ["public"]` / `pullOnly` config on the `spaceindex` collection is
    unchanged — the `{shard}` param in `storagePath` already supports arbitrary shard names.

---

## 0.1.0 (2026-06-12)

Initial meaningful release. Development Starfish sync server for the OctoSpaces namespace.

### Changes

- **Collection renames.** `rooms` → `spaceregistry` (storage leaf `_rooms` → `_access`);
  `chatkeyring` → `spacekeyring`. Retained collections: `spaces`, `spaceindex`, `profile`,
  `devices`, `pairing`.
- **Space-role enricher** now reads the access record from `spaces/{spaceId}/_access`.
- **Public-space projection** (`projectSpaceRegistry`) watches `spaceregistry` writes with
  `visibility:'public'` and upserts entries into `_index/spaces/public`.
- **Event queuing** keys updated to `spaceregistry` and `spacekeyring`.
