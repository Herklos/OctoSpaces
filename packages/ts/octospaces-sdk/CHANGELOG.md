# Changelog — @drakkar.software/octospaces-sdk

## 0.14.3 (2026-06-20)

Keyed-store consolidation — **no public API or behaviour change** (`index.ts` byte-identical;
all 654 tests pass; net −17 source lines).

### Changed

- **`sync/keyed-store.ts`** — new `createComposedStore<T, K>(composeKey)` factory bundling a
  keyed store with a key-composer and exposing the shared `save`/`get`/`clear`/`serialize`/
  `hydrate` API.
- **`spaces/members.ts` (`spaceInviteStore`), `spaces/nodes.ts` (`nodeInviteStore`)** — the
  hand-rolled 5-function wrapper sets now delegate to `createComposedStore`; every export keeps
  its name and call signature (`function` → `const` arrow only). Internal `revoke*Access`
  callers use the public `get*InviteEntry` wrappers instead of the raw store.
- **`spaces/resource-requests.ts` (`reqIdOwnerStore`)** — kept on the raw keyed store (the
  `scanResourceGrants` sender-authenticity check reads it directly by `reqId`); only its
  `serialize`/`hydrate`/`clear` trio collapsed to direct method references.

### Notes

- A "generic crypto" layer was evaluated and **deliberately not done**: the seal/encryptor/
  keyring cores are already shared, and the thin per-tier wrappers are load-bearing — they
  enforce the ensure-before-add-recipient ordering, the rotate-only-vs-full-evict distinction,
  the device-pairing-must-not-ensure rule, and AAD shard/kind binding. Genericizing them would
  trade those safety guarantees and type-safety for ~5–15 cosmetic lines. Not worth it.

## 0.14.2 (2026-06-20)

Round-6 internal refactor — **no public API or behaviour change** (`index.ts`
byte-identical; all 654 tests pass).

### Changed

- **`objects/objects.ts`** — `patchObject` / `reparentObject` / `reorderObjects` /
  `archiveObject` all shared the same `nodes.map(n => match ? {…n, …changes, updatedAt:
  now} : n)` shape; they now route through one `updateNodes(nodes, match, changes, now)`
  helper. Pure tree functions, output byte-identical (covered by the objects vector tests).

## 0.14.1 (2026-06-20)

Round-5/6 internal refactors — **no public API or behaviour change** (`index.ts`
byte-identical; all 654 tests pass; no wire artifact changed).

### Changed

- **`spaces/nodes.ts`** — `acceptNodeInvite`'s per-node cap storage fan-out (content /
  stream / keyring) is driven by one `NODE_BUNDLE_TIERS` descriptor instead of three
  hand-written `if (bundle.xCap) saveX(...)` blocks. All caps are still validated for the
  recipient identity BEFORE any is stored (unchanged ordering); the read-only-keyring vs
  read/write distinction stays in the minting paths.
- **`sync/client.ts`** — new internal `makeAnonClient()` builds the cap-less
  `{ baseUrl, namespace, fetch }` client that `getProfileBatchClient`, `pairing.ts`
  (was a local `anonClient`), and `spaces/object-directory.ts` each constructed inline.
- **`spaces/registry.ts`** — `pullSpacesDoc`'s return mapping and `readSpaces`'s error
  fallback shared the same 8-field empty/coerced `_spaces` doc shape; both now route
  through one `coerceSpacesDoc(data, hash)` (per-field coerce semantics unchanged —
  `coerceMutes`/`coerceReads` keep their distinct value handling).

## 0.14.0 (2026-06-20)

**Wire-format change (breaking for pre-0.13 inbox items only).** Drops the legacy
shard-only inbox-AAD fallback.

### Changed

- **`spaces/resource-requests.ts`** — `inboxAad` is now single-form (always kind-bound:
  `octospaces:inbox:v1:${recipientId}:${shard}:${kind}`) and `tryUnsealInbox` makes a single
  kind-bound unseal attempt instead of falling back to the legacy shard-only AAD. Every
  accepted inbox item must now be kind-bound. The inbox is a 500-item monthly-sharded ring
  buffer, so any pre-0.13 (shard-only) seal has long since been evicted — this strengthens
  the AAD shard/kind-binding invariant rather than weakening it. Server is uninvolved (it
  never seals/unseals). Two AAD regression tests updated to expect one kind-bound attempt
  per item (the shard+kind binding assertion is preserved).

## 0.13.5 (2026-06-20)

Round-5 continuation — **no public API or behaviour change** (`index.ts` byte-identical;
all 654 tests pass, including the 27 resource-request security-regression tests; no wire
artifact changed).

### Changed

- **`spaces/resource-requests.ts`** — `scanResourceRequests` and `scanResourceGrants` shared
  the same inbox-scan scaffold (walk both shards → `pullInbox` → sealed-check →
  `tryUnsealInbox` → JSON-parse). Factored into one generic `scanInbox(session, defaultKind,
  handle)` primitive; each scanner now supplies only its per-item validation as the handler.
  All security checks (sender-authenticity, `userId←edPub`, kemSig, dedup, grant
  sender-auth) are unchanged — they moved verbatim into the handlers.

## 0.13.4 (2026-06-19)

Fourth internal simplification pass — **no public API or behaviour change** (the
exported surface in `src/index.ts` is byte-identical to 0.13.3; all 654 tests pass
unchanged; no wire artifact — cap scope, AAD, path, KV key — changed). The safe,
wire-neutral structural cuts of an aggressive multi-round reduction campaign (target:
halve the SDK's logic over the next few rounds). Heavier merges (preference-store
unification, space/node duality consolidation, public-surface slimming) are staged for
the following rounds.

### Changed

- **base64 modules merged 3 → 1** — `sync/base64url.ts` and `sync/b64-primitives.ts`
  are folded into `sync/base64.ts`, which now exposes all three tiers (binary-string
  primitives, the chunked `starfishBase64` provider, and `toBase64Url`/`fromBase64Url`).
  Every exported symbol and its bytes are unchanged; only the import paths moved.
- **New `sync/cas-retry.ts`** — the identical pull → build → push → `ConflictError`-retry
  loop (`MAX_ATTEMPTS = 3`) that `spaces/registry.ts` (`runCas`) and
  `spaces/object-index.ts` (`updateObjectIndex`) each hand-rolled now shares one
  `casMutateWithRetry({ load, build, push })`. Push payloads (`{v:1,…}` / `{v:2,objects,
  updatedAt}`) and conflict semantics are unchanged.
- **`spaces/object-index.ts`** — the duplicated index push body is one `buildIndexPayload()`
  helper (used by both `pushIndexSeed` and `updateObjectIndex`).
- **`sync/client.ts`** — `emptyProfile()` folded into `coerceProfile(null)` (single source
  of the profile shape, still a fresh object per call) and the inline ed/kem key check
  extracted to `hasProfileKeys()`.

## 0.13.3 (2026-06-19)

Third internal simplification pass — **no public API or behaviour change** (the
exported surface in `src/index.ts` is byte-identical to 0.13.2; all 654 tests pass
unchanged). The package was already simplified hard in 0.13.1/0.13.2, so this pass
is a small structural top-up.

### Changed

- **`sync/space-access-store.ts`** — the nine near-identical per-node access-entry
  accessors (`get`/`save`/`remove` across the content / `:stream` / `:keyring` tiers)
  now share one `nodeEntryApi(suffix)` generator instead of nine hand-written
  declarations. Every exported name and call signature is unchanged (`removeNodeAccessEntry`
  keeps its explicit three-sibling fan-out).

## 0.13.2 (2026-06-19)

Second internal simplification pass — **no public API or behaviour change** (the
exported surface in `src/index.ts` is byte-identical to 0.13.1; all 654 tests pass
unchanged). Factors repeated invite/revoke/access *logic* into reusable building
blocks shared across the space and node tiers.

### Changed

- **New `src/spaces/invite-helpers.ts`** — one implementation per concept, reused by
  both `members.ts` (space tier) and `nodes.ts` (node tier):
  - `mintCap()` collapses the nine 7-line `mintMemberCap(...)` calls to one line each.
  - `parseJoinRequest()` (shape + `userId←edPub` + `verifyKemSig`), `capNonce()`,
    `ephemeralSubject()`, `assertCapForMe()` (the node accept flow wraps it per-label),
    and `adderOf()` (the `{edPriv,edPub,kemPriv}` signer triple).
  - `evictKeyringMember()` holds the byte-identical `evictMember` config shared by
    `revokeSpaceAccess` and `revokeNodeAccess`; each caller keeps its own store lookup,
    validation, collection, member-nonce source, and `priorRevoked` accumulation.
  - Result: `members.ts` 438→386, `nodes.ts` 755→668.
- **`sync/space-access.ts`** — `resolveEntryClient()` + `resolveTrustedAdders()` back
  `getSpaceClient` / `getNodeStreamClient` / `getNodeAccess` / `buildNodeAccess` /
  `resolveNodeKeyringHandle`, removing the redundant `clientFromEntry`, the four inline
  client-build blocks, and the three trusted-adder ternaries.
- **`spaces/registry.ts`** — `coerceRecord<T>()` backs the dms/reads/archived coercers;
  `addSpaceWithUpdates()` backs the `addJoinedSpace*` trio (the no-op-when-unchanged
  optimization preserved).

## 0.13.1 (2026-06-19)

Internal simplification release — **no public API or behaviour change** (the
exported surface in `src/index.ts` is byte-identical to 0.13.0, and all 654 tests
pass unchanged). Space/node revocation and every other feature are preserved.

### Changed

- **De-duplicated internal plumbing** (behaviour-preserving):
  - `createKeyedStore<T>()` now backs all three in-memory stores (space-invite,
    node-invite, reqId→owner) instead of three hand-rolled `Map` wrappers.
  - `computeOwnerTrustedAdders()` (a pure, cycle-safe leaf) replaces three inline
    copies of the owner trusted-adder branch across `client.ts` / `identity.ts`.
  - `addKeyringRecipientCore()` is shared by `addSpaceKeyringRecipient` and the
    per-node `addNodeKeyringRecipient`; `isKeyringMissing` is single-sourced.
  - `pullPush()` collapses the ten `…Name/…Pull/…Push` collection-path triples and
    `rwOps()` the repeated member op-set; `nodeKey()` collapses the nine per-node
    access-store accessors.
  - Registry: one `runCas()` retry loop + `toPayload()` (the 8-key `_spaces` push
    body) back both `casUpdateSpacesField` and `updateSpacesDoc`.
  - `client.ts`: `fetchProfileData()` + `coerceProfile()` fold the three
    profile-fetch blocks and three `PublicProfile` coercion literals; object-blob
    upload/load share `sealAndPush` / `pullStored` / `openStored`; the
    btoa/atob+Buffer base64 detection is shared via `b64FromBinaryString` /
    `b64ToBinaryString`.
  - `verifyKemSig()` single-sources the Ed25519 kemSig verification used by
    `inviteToSpace` / `inviteToNode` / `scanResourceRequests`; `recipientFor()`
    replaces six inlined keyring-recipient literals; `tryUnsealInbox()` /
    `sealAppend()` fold the duplicated inbox seal/unseal patterns (the
    `octospaces:inbox:v1` AAD shard+kind binding is preserved exactly).
  - `LinkAccessPayload` (internal) unifies the link-access credential shape used in
    five places; `readIndexObjects()` removes a duplicated index-doc cast.

### Removed

- Dead, unreferenced code: the unreachable `getWebBase` config getter + its
  `webBase` field (consumers define their own), a dead `SpaceBucket.ts` field, and
  several unused imports.

### Tooling

- Enabled `noUnusedLocals` / `noUnusedParameters` for the package so dead imports
  are caught going forward. `typecheck` / `lint` gate the shipped source; test
  files are validated at runtime by vitest.

## 0.13.0 (2026-06-17)

### Security fixes

- **Grant sender authenticity.** `scanResourceGrants` now verifies that a grant's
  `sealed.entry.addedBy` matches the owner edPub the requester originally messaged.
  Grants are delivered on the requester's public-write inbox, so previously a third party
  could forge a grant carrying a real `reqId`, burning it in `seenReqIds` and causing the
  legitimate grant to be silently skipped. The requester now records `reqId → ownerEdPub`
  at submit time (`saveReqIdOwner`, auto-called by `submitResourceRequest`); a grant from
  an unexpected sender is dropped **without** burning the reqId. New
  `saveReqIdOwner` / `serializeReqIdOwnerStore` / `hydrateReqIdOwnerStore` /
  `clearReqIdOwnerStore` exports persist this store across reloads.

- **Full space-tier eviction (`revokeSpaceAccess`).** The space-tier equivalent of
  `revokeNodeAccess`. `removeSpaceMember` alone only edits the roster — for `enc` spaces an
  evicted member kept the space CEK and could decrypt all current and future content.
  `revokeSpaceAccess(session, spaceId, userId, opts)` now performs full eviction via
  `evictMember`: submits a signed `RevocationList` for the member's `spaceMemberScope` cap
  (server immediately rejects their tokens), rotates the space keyring for forward secrecy,
  then drops them from the roster. `inviteToSpace` / `createSpaceInviteLink` auto-retain the
  member's `{edPub, kemPub, cap nonce}` in a new `spaceInviteStore`; new
  `saveSpaceInviteEntry` / `getSpaceInviteEntry` / `clearSpaceInviteStore` /
  `serializeSpaceInviteStore` / `hydrateSpaceInviteStore` exports manage and persist it.

### Fixes

- **Re-sync after a newly-granted cap is no longer a silent no-op.**
  `hydrateSpaceAccessStore` early-returned when the active account key was unchanged,
  **before** the server-cap merge loop — so a second call carrying a freshly-granted cap
  never reached the cache, producing spurious `SpaceAccessError` until sign-out/in. The
  kv reload + cache reset is now gated on first-load only; the (idempotent, "server wins")
  merge always runs.

### Hardening

- **`userIdFromEdPub` validates its input** against an anchored `^[0-9a-f]{64}$` regex
  (non-hex previously coerced to `NaN`→`0` bytes). The hex-format regexes
  (`ED_PUB_HEX_RE`, `KEM_PUB_HEX_RE`, `KEM_SIG_HEX_RE`, `USER_ID_HEX_RE`) are now shared
  constants in `paths.ts`; `identity-link.ts` reuses them so key sizes live in one place.

- **Inbox seal AAD includes the message kind** (`octospaces:inbox:v1:${id}:${shard}:${kind}`,
  where kind is `request` | `grant` | `reject`). Trial-unseal tries the kind-bound AAD first
  and falls back to the legacy shard-only AAD, so blobs sealed by ≤0.12.x still open
  (no wire break). Defense-in-depth against cross-kind blob relocation.

- **WAL snapshot writes use a CAS retry loop.** `createWalSnapshotStore().write` now re-pulls
  the base hash and retries up to 3× on a `409/412/conflict/stale` push, so concurrent
  snapshot writers no longer permanently conflict.

- **Owner per-node invite-stream cap.** `createNode` now mints the owner's own per-node
  `objinvlog` (invite-stream) cap and saves it to the node-stream access store, so the owner
  can read a node's invite/ticket log without relying on the broad `ownerScope` cap (which
  the server's sharing plugin does not honour for `objinvlog`). `objinvlog` is added to
  `OWNER_COLLECTIONS` (and thus `ownerScope` / `linkedDeviceScope`).

### Internal

- **Space-keyring helper consolidation.** New `ownerEnsureSpaceKeyring(session, spaceId)`
  and `ensureSpaceKeyringRecipient(session, spaceId, recipient)` wrappers (analogues of the
  per-node-keyring helpers) replace the repeated `ownerEnsureKeyring(...keyringPull/Push)` +
  `addSpaceKeyringRecipient` call sites across `nodes.ts` and `members.ts`. The
  ensure-before-add invariant is now encapsulated in one place. New `RECIPIENT_LABEL_LEN`
  constant replaces the hardcoded `8` for keyring recipient labels.

- **Tests.** New `members.revoke.test.ts` (space-tier eviction + invite-store
  serialize/hydrate), grant sender-authenticity regression tests in
  `resource-requests.regression.test.ts`, and `unsealFromSelf` provenance-tamper tests in
  `account-seal.test.ts`. 649 tests passing.

## 0.12.10 (2026-06-17)

### Fixes

- **Space keyring `trustedAdders` corrected for paired devices.** `ownerEnsureKeyring`
  calls in `inviteToSpace` and `createSpaceInviteLink` now pass `ownerTrustedAdders(session)`
  (the owner + paired-device key pair) instead of defaulting to only the current device's key.
  `addSpaceKeyringRecipient` derives trusted adders from `session.ownerEdPub` so rotation on a
  non-root paired device no longer silently drops recipients added by the root device.

- **`nodeInviteStore` serialization helpers.** New `serializeNodeInviteStore()` and
  `hydrateNodeInviteStore(entries)` exports let callers persist the invite-nonce store
  (e.g. to IndexedDB or AsyncStorage) and restore it on startup — preventing revocation
  from becoming impossible after a page reload or process restart.

- **`node-keyring.ts`: internal `revokeNodeAccess` renamed to `revokeNodeKeyringRecipients`**
  to avoid confusion with the higher-level `revokeNodeAccess` exported from `spaces/nodes.ts`.
  The lower-level function was never in `index.ts`; only path-import callers are affected.

- **`revokeNodeKeyringRecipients` generation default changed to `Date.now()` (milliseconds)**
  from `Math.floor(Date.now() / 1000)` (seconds). Two revocations within the same wall-clock
  second no longer produce a duplicate generation number that the server's monotonicity check
  would reject.

## 0.12.9 (2026-06-17)

### Security fixes

- **Full revocation infrastructure for per-node-keyring nodes.**
  - Server: `POST /revocations` route (added in 0.12.8) accepts signed `RevocationList`
    objects and calls `revocationStore.acceptList`; the role-resolver already rejects any
    cap whose nonce appears in the store.
  - SDK: `inviteToNode` (isolated + enc) now auto-stores all three cap nonces (keyring,
    content, stream) in a module-level `nodeInviteStore` keyed by
    `${spaceId}:${nodeId}:${userId}`.
  - SDK: New `revokeNodeAccess(session, spaceId, nodeId, userId, opts)` performs full
    two-step eviction via `evictMember`: (1) submits a signed `RevocationList` containing
    all three cap nonces in one `generation` so the server immediately rejects the
    invitee's tokens; (2) rotates the node keyring (removes the invitee's KEM, mints a
    fresh CEK) for forward secrecy.
  - SDK: New `saveNodeInviteEntry` / `getNodeInviteEntry` / `clearNodeInviteStore` for
    callers that need to hydrate the store from their own durable storage across reloads.

### Added

- **`NodeInviteBundle` carries a `kind` discriminator** (`'plaintext' | 'space-enc' |
  'node-enc'`). `inviteToNode` now stamps the bundle with the E2EE model so the invitee can
  handle the bundle correctly without reverse-engineering which caps are present.
- **Inbox AAD widened to include the shard** (`octospaces:inbox:v1:${recipientId}:${shard}`).
  A sealed grant/request from one shard cannot be relocated to another shard by a
  public-write adversary (cross-shard replay prevention). **Wire-format break.**
- **`scanResourceGrants` accepts `opts.seenReqIds`** for persistent cross-call dedup.
  A caller-provided `Set<string>` is mutated in-place so processed reqIds survive across
  multiple scan invocations.

## 0.12.8 (2026-06-16)

### BREAKING CHANGES

- **BREAKING: Identity links (IdentityLink) are now v:2.** `kemPub` is now signed by
  `edPriv` (`kemSig`: an Ed25519 signature of `kemPub` by the identity's signing key).
  `verifyIdentityLinkBinding` verifies BOTH `ownerId === sha256(edPub)[0:32]` AND the
  `kemSig` offline. Old v:1 links are no longer accepted — re-generate all
  shared identity links after upgrading.
- **BREAKING: Inbox seals are now context-bound.** AES-GCM AAD
  (`octospaces:inbox:v1:${recipientUserId}`) is applied to all resource-request, grant,
  and reject seals. Sealed messages produced by earlier versions cannot be decrypted
  and must be re-submitted.

### Security fixes

- ** `acceptResourceRequest` now uses `isolated: true`** when calling `inviteToNode`.
  Requesters now receive a `nodeMemberScope` cap (reach only their own node) instead of a
  `spaceMemberScope` cap (space-wide access). All existing grant flows must be re-invited
  to downscope the cap.
- ** Pairing rendezvous push is now hash-guarded.** The base hash is pulled first so
  the push is a compare-and-swap; the slot is cleared after `completeDevicePairing`
  succeeds, preventing replay attacks on the pairing channel.
- ** `inviteToSpace` / `inviteToNode` / `scanResourceRequests` now verify
  `userId === await userIdFromEdPub(edPub)`** before trusting a requester's `userId`
  claim. An attacker that substitutes a mismatched `userId` in the join request is
  rejected rather than granted a cap under the wrong identity.

### Fixed

- **`loadObjectBlob` now accepts `string | ObjectBlobRef`** (previously only
  `ObjectBlobRef`). All `persist()` call sites now properly handle the returned promise
  (unhandled rejections fixed).

### Changed

- **Link-token encoding/decoding centralized** in `sync/link-token.ts`
  (`encodeLinkFragment` / `decodeLinkFragment`). All invite-link builders now go through
  this module.
- **`addSpaceKeyringRecipient` extracted** from inline call sites into a named
  helper in `sync/client.ts`.
- **`buildSpace` factory added** to `spaces/registry.ts` for constructing `Space`
  objects without duplicating field defaults.
- **`updateSpacesField` CAS helper extracted** from `updateSpacesDoc` callers.

### Internal

- Dead code removed: `spaceIdFromCap` (paths.ts) and `reg` parameter from
  `updateObjectIndex` / `createNode` / `setNodeAccess` (migration debt cleared).

## 0.12.7 (2026-06-16)

### Added

- **Per-node keyring revocation + rotation (E2EE tickets, Phase 5).**
  - `removeNodeKeyringRecipient(session, spaceId, nodeId, removeSubKems, opts?)` — rotates the
    node keyring to a NEW epoch, mints a fresh CEK, and re-wraps it ONLY to the retained
    recipients (wraps `removeRecipient`). A revoked party (e.g. an unassigned agent) loses
    access to FUTURE messages; already-seen messages stay readable (forward secrecy only).
  - `listNodeKeyringRecipients(session, spaceId, nodeId, opts?)` — provenance-filtered list of
    the node keyring's current recipients (wraps `listRecipients`).
  - Both default `trustedAdders` to the caller (correct when the desk owner/bot manages the
    keyring); pass explicit adders to retain recipients granted by other keys.

## 0.12.6 (2026-06-16)

### Changed

- **E2EE invite nodes can now use the per-node keyring (E2EE tickets, Phase 2).** For an
  `access:'invite'` node, passing `isolated: true` to `inviteToNode` / `createNodeInviteLink`
  on an `enc` node now routes through the **per-node** keyring instead of the space-wide one:
  - The owner seeds the node keyring and adds the invitee's KEM as a recipient
    (`ensureNodeKeyringRecipient`, ensure-before-add), and mints a READ-only `nodeKeyringScope`
    cap alongside the per-node content (`objinv`) and stream (`objinvlog`) caps.
  - The invitee is **isolated**: no space membership, no space cap — they reach only their
    own node, and decrypt via the per-node keyring, never the space key. This closes the
    prior footgun where an `enc` invite added the invitee to the space-wide keyring.
  - `NodeInviteBundle` / `NodeInviteLinkToken` carry an optional `keyringCap`;
    `acceptNodeInvite` / `joinNodeByLink` persist it under `${spaceId}:${nodeId}:keyring`.
  - `getNodeAccess` / `buildNodeAccess` open the **node** keyring for `access:'invite' && enc`
    nodes (requester via their keyring cap client; space members/owner via `session.chatClient`
    as keyring recipients). `buildNodeAccess` gained an optional `node.access` to select this.
  - **Back-compat preserved:** a NON-isolated `enc` invite keeps the legacy space-wide keyring
    behaviour, and `access:'space'` enc nodes are unchanged. Existing content stays decryptable.
- New store helpers `getNodeKeyringAccessEntry` / `saveNodeKeyringAccessEntry` /
  `removeNodeKeyringAccessEntry`; `removeNodeAccessEntry` now also drops the `:keyring` sibling.

## 0.12.5 (2026-06-16)

### Added

- **Per-node keyring primitive (E2EE tickets, Phase 1).** Each `invite+enc` node (e.g. an
  OctoDesk ticket) can carry its OWN keyring at `spaces/{spaceId}/objects/n/{nodeId}/_keyring`
  (collection `nodekeyring`), wrapping the content CEK to ONLY that node's participants —
  not the space-wide keyring. An isolated external requester can therefore read/write their
  ticket E2EE without ever holding the space key.
  - New path helpers `nodeKeyringName/Pull/Push` and the single-collection, READ-only cap
    scope `nodeKeyringScope(spaceId, nodeId)` (`['nodekeyring']`).
  - New wrappers in `sync/node-keyring.ts`: `ownerEnsureNodeKeyring`, `openNodeEncryptor`,
    `buildNodeEncryptor`, `addNodeKeyringRecipient`, and `ensureNodeKeyringRecipient` (which
    enforces the `ensure`-before-`addRecipient` ordering invariant). These are thin
    specialisations of the existing path-generic `ownerEnsureKeyring`/`openEncryptor`/
    `buildEncryptor` + `addCollectionRecipient`, so the proven keyring crypto is unchanged.
  - Requires the new `nodekeyring` collection in the Starfish server config
    (`readRoles:["space:member","cap:read:nodekeyring"]`, `writeRoles:["space:member"]`,
    `encryption:"none"`) — mirrored in OctoSpaces `apps/server` and Infra `collections.py`.

## 0.12.4 (2026-06-16)

### Fixed

- **`ownerEnsureKeyring` now called before `addCollectionRecipient` in both `inviteToNode`
  and `createNodeInviteLink` enc branches.** Previously, `addCollectionRecipient` was called
  directly against the keyring, violating the `ownerEnsureKeyring`-first invariant. On spaces
  created before the eager-mint fix (or where enc was enabled post-creation), the keyring
  might not exist and the call would fail rather than mint it first.
- **`getNodeStreamClient` fallback chain corrected.** The second and third fallbacks
  (`getNodeAccessEntry`/`getSpaceAccessEntry`) both cover collections that exclude `objinvlog`
  — presenting either cap to the stream collection produces a server 403. The fallback is now
  `session.chatClient` only, which authenticates at the identity level (same as space members
  accessing `objlog`). Isolated invite members without a stream entry correctly receive a
  server auth error rather than a misleading wrong-collection 403.
- **`inviteToNode` now accepts `opts.write?: boolean` (default `true`).** Previously all
  three `mintMemberCap` calls (space, content, stream) hardcoded `canWrite=true`, granting
  unconditional write access regardless of caller intent. Pass `{ write: false }` for
  read-only invitations.
- **`removeNodeAccessEntry` now also removes the sibling `:stream` entry.** The stream cap
  is stored under a distinct `${spaceId}:${nodeId}:stream` key; callers that revoke a node's
  access entry now atomically revoke stream access too, preventing orphaned stream caps.
- **`createTicket` (OctoChat) passes `{ isolated: !enc }` to `createNodeInviteLink`.** The
  non-member ticket link was granting the bearer full space-index membership, exposing all
  ticket metadata. Isolated links scope the bearer to the single ticket node only.

## 0.12.3 (2026-06-16)

### Added

- **Per-node stream cap (`nodeStreamScope`) + dual-cap invite flow.** A `member` cap
  covers exactly one collection, so an `invite+plaintext` node's append-log STREAM
  (`objinvlog`) needs its OWN cap separate from the content cap (`objinv`,
  `nodeMemberScope`). Previously only the content cap was minted, leaving the stream
  collection unreachable by every party (the desk-ticket messaging path was inert).
  - New `nodeStreamScope(spaceId, nodeId, canWrite)` — single-collection (`objinvlog`)
    per-node scope.
  - `inviteToNode` and `createNodeInviteLink` now also mint a `streamCap` for plaintext
    nodes and carry it in the bundle / link token. `acceptNodeInvite` and
    `joinNodeByLink` persist it under a distinct `${spaceId}:${nodeId}:stream` access
    entry (and seal it into `_spaces.pubAccess` for link invites).
  - New `getNodeStreamClient(spaceId, nodeId, session)` resolves the right client for a
    node's stream (stream entry → content entry → space client fallback).
  - New store helpers `getNodeStreamAccessEntry` / `saveNodeStreamAccessEntry` /
    `removeNodeStreamAccessEntry` (separate entry key — no entry-shape/sync change).
- **`isolated` invite option** on `inviteToNode` / `createNodeInviteLink`. When set for a
  plaintext node, the invitee is NOT added as a space member and receives NO space-level
  cap — only the per-node content + stream caps. This withholds index/metadata access to
  the rest of the space (e.g. an external OctoDesk ticket requester reaches only their own
  ticket). Ignored for `enc` nodes (they require the space-wide keyring). `NodeInviteBundle.cap`
  is now optional to reflect isolated bundles.

## 0.12.2 (2026-06-16)

### Removed

- **`sync/attachments.ts` deleted** — the legacy `attachments` collection is gone from
  all octospaces deploys. `ByteSealer` and `attachmentKind` are now exported directly
  from `./sync/object-blobs.ts` (same public API surface, new home).
  `AttachmentRef`, `AttachmentStore`, `MAX_ATTACHMENT_BYTES`, `createAttachmentStore`,
  `attachmentName`, `attachmentPull`, `attachmentPush` are fully removed.
  Consumers must migrate to `createObjectBlobStore` (introduced in 0.12.1).

## 0.12.1 (2026-06-16)

### Changed

- **`createObjectBlobStore`** gains the full in-memory + KV-persisted cache layer from
  the legacy `createAttachmentStore` (64 MB in-memory LRU, 4 MB KV ciphertext budget).
  The factory now takes `{ persistPrefix, persistIndex }` instead of `{ sealer }`, and
  each store method accepts `enc: ByteSealer | null` per-call (null = plaintext path).
  The returned store now also exposes `clearObjectBlobCache()`.
  Standalone `uploadObjectBlob` / `loadObjectBlob` updated to accept nullable `enc`.
- **`sync/attachments.ts`** marked `@deprecated` — `createAttachmentStore`,
  `AttachmentRef`, `AttachmentStore`, `MAX_ATTACHMENT_BYTES` all carry `@deprecated`
  JSDoc. The `attachments` server collection has been removed from all octospaces
  deployments (replaced by `objblob`). `ByteSealer` and `attachmentKind` remain
  non-deprecated. Existing exports are kept for this minor; removal is a later major.

## 0.12.0 (2026-06-16)

### Added

- **Sealed resource-request inbox** — generic "request-to-create" primitive that lets
  a requester holding only an owner's public identity (no credential) deliver a sealed
  node-creation request to the owner's inbox; the owner accepts or rejects and seals a
  narrow per-node cap back. Four new modules + barrel exports:
  - **`sync/inbox.ts`** — `inboxShard()`, `inboxShards()`, `pullInbox()`,
    `InboxElement`. Adds the shard-rotation helpers and authenticated read wrapper
    that were missing from the path-string builders in `paths.ts`.
  - **`sync/signed-append.ts`** — `appendToInbox()`, `postAnonymousAppend()`,
    `AppendHttpError`. Cap-less POST to the public-write `inbox` collection, signed
    with the sender's own Ed25519 key.
  - **`spaces/identity-link.ts`** — `IdentityLink` token type (no credential, safe to
    share), `encodeIdentityLink()` / `decodeIdentityLink()`, `verifyIdentityLinkBinding()`
    (offline `ownerId = sha256(edPub)[0:32]` check), `verifyIdentityLinkKeys()` (live
    profile cross-check), `myIdentityLink()`.
  - **`spaces/resource-requests.ts`** — requester side: `submitResourceRequest()`,
    `scanResourceGrants()`, `acceptResourceGrant()`; owner side: `scanResourceRequests()`,
    `acceptResourceRequest()` (with optional app-specific `create` hook for room/ticket/page),
    `rejectResourceRequest()`. Types: `ResourceRequest`, `ResourceGrant`, `ResourceReject`,
    `PendingRequest`, `AcceptResult`, `SubmitResourceRequestOptions`.
  - No server-side changes — the existing `inbox/{identity}/{shard}` collection
    (`writeRoles:["public"]`, `readRoles:["cap:read:inbox"]`, 500-item ring buffer)
    is reused as-is.

## 0.11.0 (2026-06-16)

### Added

- **`StartPairingOptions`** — optional third argument to `startDevicePairing(session, pin, opts?)`:
  - `opts.prefix?: string` — QR URI prefix (default `'octospaces-pair:'`). Apps use their own
    prefix (e.g. `'octochat-pair:'`) so cross-app scans are rejected rather than silently attempted.
  - `opts.onProvisioned?: (device: { kemPub, edPub, userId }) => void | Promise<void>` — hook
    called after the new device's keypair is provisioned but BEFORE the sealed blob is pushed to
    the rendezvous. Use for post-provision side-effects (e.g. granting keyring access to owned
    spaces). If the hook throws the error propagates; wrap in try/catch for best-effort use.
- **`createObjectBlobStore({ sealer })`** — factory that pre-binds a `ByteSealer` for repeated
  space-scoped blob operations. Mirrors `createAttachmentStore` but keyed by `spaceId` rather
  than room. Also exports `uploadObjectBlob`, `loadObjectBlob`, `MAX_OBJECT_BLOB_BYTES`,
  `FileTooLargeError`, and `ObjectBlobRef` / `ObjectBlobStore` types from the main barrel.
- **`./wal` subpath** — WAL wiring behind a separate entry point (never pulled into the main
  barrel so OctoChat's web bundle stays free of `starfish-wal`). Exports:
  `createWalDocument` (+ `CreateWalDocumentOptions`), `createWalTransport`,
  `createWalSnapshotStore`, `walEncryptorFromKeyring`, `walSignerFromKeys`,
  `noopEncryptor`, `WalDocument`.
  `@drakkar.software/starfish-wal` is listed as an optional peer dep.

## 0.8.6 (2026-06-15)

### Fixed

- **Space invite links now grant E2EE (private room) access (Fix C).** When an owner
  created an invite link via `createSpaceInviteLink`, the ephemeral X25519 KEM keypair
  was added to the space keyring as a recipient but the private key (`kemPriv`) was
  discarded — so the link joiner's decrypt path used their own device KEM (not a
  keyring recipient) and `createKeyringEncryptor` threw a `SpaceAccessError`, surfaced
  as "No access to room. Try again." Public (plaintext) rooms were unaffected.
  The fix threads `kemPriv`/`kemPub` through the full chain:
  - `SpaceInviteLinkToken` now carries `kemPriv?` and `kemPub?` (optional, back-compat).
  - `createSpaceInviteLink` populates them; `decodeSpaceInviteLink` preserves them.
  - `joinSpaceByLink` persists them in both the sealed `_spaces.pubAccess` blob and the
    local `saveSpaceAccessEntry`.
  - `recoverSpaceAccess` unseals and threads them through `hydrateSpaceAccessStore`.
  - `decryptKeysFor` (new internal helper in `space-access.ts`) selects the ephemeral
    KEM when the access entry has it; falls back to `session.keys` for legacy entries
    (pre-0.8.6 links, which still fail on E2EE rooms — re-issue the link to fix).

**Migration:** existing invite links issued before 0.8.6 carry no `kemPriv` and continue
to fail on private rooms (same behaviour as before). Re-issue the link after upgrading.

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
