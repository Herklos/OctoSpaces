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
  nodeStreamScope,
  accountScope,
  linkedDeviceScope,
  keyringName,
  keyringPull,
  keyringPush,
  nodeKeyringName,
  nodeKeyringPull,
  nodeKeyringPush,
  nodeKeyringScope,
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
  spaceIdFromRoomId,
  userIdFromEdPub,
  bytesToHex,
  ED_PUB_HEX_RE,
  KEM_PUB_HEX_RE,
  KEM_SIG_HEX_RE,
  USER_ID_HEX_RE,
  RECIPIENT_LABEL_LEN,
} from './sync/paths.js';

// Object blobs (sealed files keyed by space)
export type { ByteSealer, ObjectBlobRef, ObjectBlobStore } from './sync/object-blobs.js';
export { attachmentKind, MAX_OBJECT_BLOB_BYTES, FileTooLargeError, uploadObjectBlob, loadObjectBlob, createObjectBlobStore } from './sync/object-blobs.js';

// Client
export {
  makeClient,
  capProviderFor,
  openEncryptor,
  buildEncryptor,
  ownerEnsureKeyring,
  isAlreadyPresentRecipient,
  addSpaceKeyringRecipient,
  ownerEnsureSpaceKeyring,
  ensureSpaceKeyringRecipient,
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

// Per-node keyring (E2EE invite nodes — OctoDesk tickets)
export {
  ownerEnsureNodeKeyring,
  openNodeEncryptor,
  buildNodeEncryptor,
  addNodeKeyringRecipient,
  ensureNodeKeyringRecipient,
  removeNodeKeyringRecipient,
} from './sync/node-keyring.js';
export type { NodeKeyringRecipient } from './sync/node-keyring.js';

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
  getNodeStreamClient,
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
  getNodeStreamAccessEntry,
  saveNodeStreamAccessEntry,
  removeNodeStreamAccessEntry,
  getNodeKeyringAccessEntry,
  saveNodeKeyringAccessEntry,
  removeNodeKeyringAccessEntry,
  localSpaceAccessEntries,
  memberCapsFromStore,
  linkAccessFromStore,
  clearSpaceAccessStore,
} from './sync/space-access-store.js';
export type { SpaceAccessEntry, SpaceAccessMap } from './sync/space-access-store.js';

// Registry
export {
  buildSpace,
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
  // space-tier eviction
  revokeSpaceAccess,
  saveSpaceInviteEntry,
  getSpaceInviteEntry,
  clearSpaceInviteStore,
  serializeSpaceInviteStore,
  hydrateSpaceInviteStore,
} from './spaces/members.js';
export type { JoinRequest, SpaceInviteLinkToken, StoredSpaceInvite } from './spaces/members.js';

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
  // revocation infrastructure for isolated per-node-keyring (OctoDesk ticket) nodes
  revokeNodeAccess,
  saveNodeInviteEntry,
  getNodeInviteEntry,
  clearNodeInviteStore,
  serializeNodeInviteStore,
  hydrateNodeInviteStore,
} from './spaces/nodes.js';
export type { CreateNodeInput, NodeInviteBundle, NodeInviteKind, NodeInviteLinkToken, StoredNodeInvite } from './spaces/nodes.js';

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
export type { PairResult, StartPairingOptions } from './sync/pairing.js';

// Pull cache
export { pullCache, PULL_CACHE_MAX_AGE_MS } from './sync/pull-cache.js';

// Profile cache
export { cacheProfile, loadCachedProfile } from './sync/profile-cache.js';

// Fetch
export { fetchWithTimeout, CONNECT_TIMEOUT_MS } from './sync/fetch-timeout.js';

// Inbox helpers (shard rotation + authenticated read)
export { inboxShard, inboxShards, pullInbox } from './sync/inbox.js';
export type { InboxElement } from './sync/inbox.js';

// Anonymous signed append (cap-less inbox write)
export { appendToInbox, postAnonymousAppend, AppendHttpError } from './sync/signed-append.js';

// Base64
export { starfishBase64, toBase64Url, fromBase64Url } from './sync/base64.js';

// Link token helpers (shared encode/decode for invite and identity link fragments)
export { encodeLinkFragment, decodeLinkFragment } from './sync/link-token.js';

// Utilities
export { matchTitle, rankResults, fold, isWordStart } from './utils/search-match.js';
export type { MatchRange, TitleMatch, RankedResult } from './utils/search-match.js';

export { registerPull, dispatchDocChange, emitSseStatus, onSseStatus, clearLiveSyncBus } from './utils/live-sync-bus.js';

// SSE events transport (generic, parse-injected)
export { buildSignedEventsRequest, parseSseFrames, subscribeChanges } from './sync/events.js';
export type { SubscribeChangesOptions } from './sync/events.js';

export { previewInvite } from './utils/invite-preview.js';
export type { InvitePreview } from './utils/invite-preview.js';

// Identity links (pure-identity tokens, no credential/cap)
export {
  encodeIdentityLink,
  decodeIdentityLink,
  verifyIdentityLinkBinding,
  verifyIdentityLinkKeys,
  myIdentityLink,
} from './spaces/identity-link.js';
export type { IdentityLink } from './spaces/identity-link.js';

// Resource-request inbox (sealed request → owner creates node → sealed grant-back)
export {
  submitResourceRequest,
  scanResourceRequests,
  acceptResourceRequest,
  rejectResourceRequest,
  scanResourceGrants,
  acceptResourceGrant,
  // reqId → owner-edPub store (sender-auth for scanResourceGrants, persistence across reloads)
  saveReqIdOwner,
  serializeReqIdOwnerStore,
  hydrateReqIdOwnerStore,
  clearReqIdOwnerStore,
} from './spaces/resource-requests.js';
export type {
  ResourceRequest,
  ResourceGrant,
  ResourceReject,
  PendingRequest,
  AcceptResult,
  SubmitResourceRequestOptions,
} from './spaces/resource-requests.js';

// Prefs
export { createMutesStore, isMuteActive } from './prefs/mutes.js';
export type { MutesStore } from './prefs/mutes.js';
export { createReadsStore } from './prefs/reads.js';
export type { ReadsStore } from './prefs/reads.js';

// Format
export { plural, clockTime, initialsFor, formatBytes, relativeTime, relativeTimeShort } from './format/format.js';
