/**
 * @drakkar.software/octospaces-sdk — residual peripherals surface (0.23+)
 *
 * The spaces domain (registry, members, nodes, keyrings, sessions, access store,
 * sealed inbox, resource requests, identity links, object index, object directory,
 * client helpers) has been removed and now lives in:
 *
 *   @drakkar.software/starfish-spaces
 *
 * This package retains ONLY the unique peripherals starfish-spaces does not provide:
 * prefs, format/search, blobs, pairing, inbox signed-append, base64, paths, storage
 * types, connection config, KV adapter, and the full 10-algorithm object tree.
 *
 * Group-A delegations (now in starfish): WAL (→ starfish-wal/client), fetch-timeout
 * (→ createTimeoutFetch in starfish-client/fetch), pull-cache (→ createKvPullCache
 * in starfish-client), postAnonymousAppend (→ StarfishClient.appendAnonymous).
 *
 * See CHANGELOG.md for the full migration guide.
 */

// ── Connection config (still needed for residuals + identity bridge) ──────────
export { configureOctoSpaces, getSyncBase, getSyncNamespace, getSyncPrefix, getSharedSpacesNamespace, getEventsUrl, getOnServerReachable, getCache, getCacheMaxAgeMs, getCacheFallbackStatuses } from './core/config.js';
export type { OctoSpacesConfig } from './core/config.js';

// ── KV adapter (bridges into starfish-spaces on configureKv) ─────────────────
export { configureKv, kvGet, kvSet, kvRemove } from './core/adapters.js';
export type { KvAdapter } from './core/adapters.js';

// ── Residual domain types (spaces types are now in starfish-spaces) ───────────
export type {
  ID,
  NodeAccess,
  ObjectNode,
  ObjectType,
  ObjectsIndex,
  ObjectContentKind,
  CapMap,
  PubAccessMap,
  MuteValue,
  MutePrefs,
  ReadValue,
  ReadPrefs,
  PresenceStatus,
  VerificationLevel,
  SealedBlob,
} from './core/types.js';

// ── Ids (re-exported from starfish-protocol since alpha.30) ──────────────────
export { randomId, slugify } from '@drakkar.software/starfish-protocol';

// ── Paths / cap scopes ────────────────────────────────────────────────────────
export {
  OBJECT_COLLECTIONS,
  ownerScope,
  spaceOwnerScope,
  spaceMemberScope,
  nodeMemberScope,
  nodeStreamScope,
  accountScope,
  linkedDeviceScope,
  keyringName,
  keyringPull,
  keyringPush,
  nodeKeyringName,
  nodeKeyringPull,
  nodeKeyringPush,
  objIndexName,
  objIndexPull,
  objIndexPush,
  objPubName,
  objPubPull,
  objPubPush,
  objInvName,
  objInvPull,
  objInvPush,
  objPubLogName,
  objPubLogPull,
  objPubLogPush,
  objInvLogName,
  objInvLogPull,
  objInvLogPush,
  streamNodeName,
  streamNodePull,
  streamNodePush,
  streamPubNodeName,
  streamPubNodePull,
  streamPubNodePush,
  streamInvNodeName,
  streamInvNodePull,
  streamInvNodePush,
  objOwnerName,
  objOwnerPull,
  objOwnerPush,
  inboxName,
  inboxPull,
  inboxPush,
  objectDirName,
  objectDirPull,
  spaceDirName,
  spaceDirPull,
  spacesPull,
  spacesPush,
  spaceAccessPull,
  spaceAccessPush,
  profilePull,
  profilePush,
  objLogName,
  objLogPull,
  objLogPush,
  objDocName,
  objDocPull,
  objDocPush,
  objectBlobName,
  objectBlobPull,
  objectBlobPush,
  objectParquetName,
  objectParquetPull,
  objectParquetPush,
  objectParquetPubName,
  objectParquetPubPull,
  objectParquetPubPush,
  objectParquetEncName,
  objectParquetEncPull,
  objectParquetEncPush,
  nodeObjectBlobName,
  nodeObjectBlobPull,
  nodeObjectBlobPush,
  typesIndexName,
  typesIndexPull,
  typesIndexPush,
  spaceIdFromNodeId,
  userIdFromEdPub,
  bytesToHex,
  ED_PUB_HEX_RE,
  KEM_PUB_HEX_RE,
  KEM_SIG_HEX_RE,
  USER_ID_HEX_RE,
  RECIPIENT_LABEL_LEN,
} from './sync/paths.js';

// ── Object blobs (sealed files keyed by space) ────────────────────────────────
export type { ByteSealer, ObjectBlobRef, ObjectBlobStore } from './sync/object-blobs.js';
export { attachmentKind, MAX_OBJECT_BLOB_BYTES, FileTooLargeError, uploadObjectBlob, loadObjectBlob, createObjectBlobStore } from './sync/object-blobs.js';

// ── E2EE sealed Parquet datasets ──────────────────────────────────────────────
export { MAX_OBJECT_PARQUET_ENC_BYTES, uploadObjectParquetEnc, loadObjectParquetEnc } from './sync/object-parquet.js';

// ── Identity persistence bridge ───────────────────────────────────────────────
// Session builders, seed helpers, fingerprint, ownerTrustedAdders →
//   import from '@drakkar.software/starfish-spaces' directly.
export { rootIdentityOf, sessionFromPersisted, activeAccountOf } from './sync/identity.js';
export type { Session, LinkedIdentity } from './sync/identity.js';

// ── Storage types (now in starfish-spaces) ────────────────────────────────────
export type {
  DerivedIdentity,
  PersistedSession,
  Vault,
  VaultLoad,
  UnlockMethod,
  PasskeyEnrollment,
  SeedLock,
} from '@drakkar.software/starfish-spaces';

// ── Pairing ───────────────────────────────────────────────────────────────────
export { startDevicePairing, completeDevicePairing, PAIR_PREFIX } from './sync/pairing.js';
export type { PairResult, StartPairingOptions } from './sync/pairing.js';

// ── Profile cache ─────────────────────────────────────────────────────────────
export { cacheProfile, loadCachedProfile } from './sync/profile-cache.js';

// ── Anonymous signed-append (cap-less inbox write) ────────────────────────────
// postAnonymousAppend removed — use StarfishClient.appendAnonymous directly.
// fetchWithTimeout removed — use createTimeoutFetch from @drakkar.software/starfish-client/fetch.
// pullCache removed — use createKvPullCache from @drakkar.software/starfish-client.
export { appendToInbox, AppendHttpError } from './sync/signed-append.js';

// ── Base64 ────────────────────────────────────────────────────────────────────
export { starfishBase64, toBase64Url, fromBase64Url } from './sync/base64.js';

// ── Link token helpers (from starfish-protocol since alpha.30) ────────────────
export { encodeLinkFragment, decodeLinkFragment } from '@drakkar.software/starfish-protocol';

// ── Object tree — full 10-algorithm surface (now in starfish-spaces) ─────────
export {
  buildTree,
  breadcrumbs,
  ancestors,
  subtreeIds,
  nextOrder,
  addObject,
  patchObject,
  reparentObject,
  reorderObjects,
  archiveObject,
} from '@drakkar.software/starfish-spaces';
export type { ObjectTreeNode, NewObjectInput } from '@drakkar.software/starfish-spaces';

// ── Utilities ─────────────────────────────────────────────────────────────────
export { matchTitle, rankResults, fold, isWordStart } from './utils/search-match.js';
export type { MatchRange, TitleMatch, RankedResult } from './utils/search-match.js';

export { registerPull, dispatchDocChange, emitSseStatus, onSseStatus, clearLiveSyncBus } from './utils/live-sync-bus.js';

// ── SSE events transport ──────────────────────────────────────────────────────
export { buildSignedEventsRequest, parseSseFrames, subscribeChanges } from './sync/events.js';
export type { SubscribeChangesOptions } from './sync/events.js';

// ── Invite preview ────────────────────────────────────────────────────────────
// SpaceInviteLinkToken + NodeInviteLinkToken are from starfish-spaces; re-exported
// here for backwards compat at the type level.
export { previewInvite } from './utils/invite-preview.js';
export type { InvitePreview, SpaceInviteLinkToken, NodeInviteLinkToken } from './utils/invite-preview.js';

// ── Prefs ─────────────────────────────────────────────────────────────────────
export { createMutesStore, isMuteActive } from './prefs/mutes.js';
export type { MutesStore } from './prefs/mutes.js';
export { createReadsStore } from './prefs/reads.js';
export type { ReadsStore } from './prefs/reads.js';

// ── Format ────────────────────────────────────────────────────────────────────
export { plural, clockTime, initialsFor, formatBytes, relativeTime, relativeTimeShort } from './format/format.js';
