# Changelog — @octospaces/server

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
