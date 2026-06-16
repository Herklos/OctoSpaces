/** @drakkar.software/octospaces-sdk — public surface */

// Configuration
export { configureOctoSpaces, getSyncBase, getSyncNamespace, getSyncPrefix, getSharedSpacesNamespace, getEventsUrl } from './core/config.js';
export type { OctoSpacesConfig } from './core/config.js';

// KV adapter
export { configureKv, kvGet, kvSet, kvRemove } from './core/adapters.js';
export type { KvAdapter } from './core/adapters.js';

// Domain types
export type {
  ID,
  NodeAccess,
  ObjectNode,
  ObjectType,
  ObjectsIndex,
  ObjectContentKind,
  Space,
  CapMap,
  PubAccessMap,
  DmMap,
  MuteValue,
  MutePrefs,
  ReadValue,
  ReadPrefs,
  ArchivedDms,
  PresenceStatus,
  VerificationLevel,
} from './core/types.js';

// Ids
export { randomId, roomSlug } from './core/ids.js';

// Paths / cap scopes
export {
  OBJECT_COLLECTIONS,
  ownerScope,
  spaceOwnerScope,
  spaceMemberScope,
  nodeMemberScope,
  accountScope,
  linkedDeviceScope,
  keyringName,
  keyringPull,
  keyringPush,
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
  streamRoomName,
  streamRoomPull,
  streamRoomPush,
  streamPubRoomName,
  streamPubRoomPull,
  streamPubRoomPush,
  streamInvRoomName,
  streamInvRoomPull,
  streamInvRoomPush,
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
  typesIndexName,
  typesIndexPull,
  typesIndexPush,
  attachmentName,
  attachmentPull,
  attachmentPush,
  spaceIdFromRoomId,
  userIdFromEdPub,
  bytesToHex,
} from './sync/paths.js';

// Attachments
export type { ByteSealer, AttachmentRef, AttachmentStore } from './sync/attachments.js';
export { MAX_ATTACHMENT_BYTES, attachmentKind, createAttachmentStore } from './sync/attachments.js';

// Client
export {
  makeClient,
  capProviderFor,
  openEncryptor,
  buildEncryptor,
  ownerEnsureKeyring,
  readProfile,
  readPseudo,
  readProfiles,
  writeProfile,
  writePseudo,
  ensureProfileKeys,
  buildAuthHeaders,
  ensurePseudo,
} from './sync/client.js';
export type { DeviceKeys, PublicProfile } from './sync/client.js';

// Identity / session
export {
  buildSession,
  buildLinkedSession,
  deriveSession,
  rootIdentityOf,
  ownerTrustedAdders,
  generateSeedWords,
  isValidSeed,
  fingerprintFromUserId,
  sessionFromPersisted,
  activeAccountOf,
} from './sync/identity.js';
export type { Session, LinkedIdentity } from './sync/identity.js';

// Storage types
export type {
  DerivedIdentity,
  PersistedSession,
  Vault,
  VaultLoad,
  UnlockMethod,
  PasskeyEnrollment,
  SeedLock,
} from './core/storage-types.js';

// Sealed blobs
export { sealToSelf, unsealFromSelf, sealToRecipient, unsealFromRecipient } from './sync/account-seal.js';
export type { SealedBlob } from './sync/account-seal.js';

// Node access (per-node encryptor + client resolver, replaces per-space access)
export {
  SpaceAccessError,
  getSpaceClient,
  getNodeAccess,
  buildNodeAccess,
  clearNodeAccessCache,
} from './sync/space-access.js';
export type { NodeAccessHandle } from './sync/space-access.js';

// Space access store (replaces member-caps + pubspace-caps)
export {
  hydrateSpaceAccessStore,
  getSpaceAccessEntry,
  saveSpaceAccessEntry,
  removeSpaceAccessEntry,
  getNodeAccessEntry,
  saveNodeAccessEntry,
  removeNodeAccessEntry,
  localSpaceAccessEntries,
  memberCapsFromStore,
  linkAccessFromStore,
  clearSpaceAccessStore,
} from './sync/space-access-store.js';
export type { SpaceAccessEntry, SpaceAccessMap } from './sync/space-access-store.js';

// Registry
export {
  readSpaces,
  updateSpacesDoc,
  updateMutesDoc,
  updateReadsDoc,
  updateDmsDoc,
  updateQuickReactionsDoc,
  updateArchivedDmsDoc,
  setDmMapping,
  writeSpaces,
  reorderSpaces,
  removeJoinedSpace,
  moveSpace,
  readSpaceAccess,
  writeSpaceAccess,
  addSpaceMember,
  removeSpaceMember,
  addJoinedSpace,
  addJoinedSpaceWithCap,
  addJoinedSpaceWithLinkAccess,
  createSpace,
  reconcileSpaceMeta,
  onSpaceMeta,
  broadcastSpaceMeta,
} from './spaces/registry.js';
export type { SpaceMeta, SpaceMetaUpdate } from './spaces/registry.js';

// Members
export {
  makeJoinRequest,
  inviteToSpace,
  acceptSpaceInvite,
  encodeSpaceInviteLink,
  decodeSpaceInviteLink,
  createSpaceInviteLink,
  joinSpaceByLink,
  recoverSpaceAccess,
  addDeviceToSpaceKeyring,
} from './spaces/members.js';
export type { JoinRequest, SpaceInviteLinkToken } from './spaces/members.js';

// Nodes (per-node creation + access management + invite flows)
export {
  createNode,
  setNodeAccess,
  inviteToNode,
  acceptNodeInvite,
  createNodeInviteLink,
  decodeNodeInviteLink,
  encodeNodeInviteLink,
  joinNodeByLink,
} from './spaces/nodes.js';
export type { CreateNodeInput, NodeInviteBundle, NodeInviteLinkToken } from './spaces/nodes.js';

// Object core
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
} from './objects/objects.js';
export type { ObjectTreeNode, NewObjectInput } from './objects/objects.js';

// Object index
export {
  pushIndexSeed,
  seedSpaceObjectIndex,
  updateObjectIndex,
  readObjectTree,
} from './spaces/object-index.js';

// Public object directory (world-readable, server-maintained projection)
export { readObjectDirectory, parseObjectDirectoryDoc } from './spaces/object-directory.js';
export type { PublicObjectDirEntry } from './spaces/object-directory.js';

// Pairing
export { startDevicePairing, completeDevicePairing, PAIR_PREFIX } from './sync/pairing.js';
export type { PairResult } from './sync/pairing.js';

// Pull cache
export { pullCache, PULL_CACHE_MAX_AGE_MS } from './sync/pull-cache.js';

// Profile cache
export { cacheProfile, loadCachedProfile } from './sync/profile-cache.js';

// Fetch
export { fetchWithTimeout, CONNECT_TIMEOUT_MS } from './sync/fetch-timeout.js';

// Base64
export { starfishBase64 } from './sync/base64.js';
export { toBase64Url, fromBase64Url } from './sync/base64url.js';

// Utilities
export { matchTitle, rankResults, fold, isWordStart } from './utils/search-match.js';
export type { MatchRange, TitleMatch, RankedResult } from './utils/search-match.js';

export { registerPull, dispatchDocChange, emitSseStatus, onSseStatus, clearLiveSyncBus } from './utils/live-sync-bus.js';

// SSE events transport (generic, parse-injected)
export { buildSignedEventsRequest, parseSseFrames, subscribeChanges } from './sync/events.js';
export type { SubscribeChangesOptions } from './sync/events.js';

export { previewInvite } from './utils/invite-preview.js';
export type { InvitePreview } from './utils/invite-preview.js';

// Prefs
export { createMutesStore, isMuteActive } from './prefs/mutes.js';
export type { MutesStore } from './prefs/mutes.js';
export { createReadsStore } from './prefs/reads.js';
export type { ReadsStore } from './prefs/reads.js';

// Format
export { plural, clockTime, initialsFor, formatBytes } from './format/format.js';
export { relativeTime, relativeTimeShort } from './format/relative-time.js';
