# Changelog — @drakkar.software/octospaces-sdk

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
