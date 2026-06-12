# Changelog — @octospaces/server

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
