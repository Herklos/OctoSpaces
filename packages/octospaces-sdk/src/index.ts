/** @drakkar.software/octospaces-sdk — public surface */

// Configuration
export { configureOctoSpaces, getSyncBase, getSyncNamespace, getSyncPrefix, getSharedSpacesNamespace } from './core/config.js';
export type { OctoSpacesConfig } from './core/config.js';

// KV adapter
export { configureKv, kvGet, kvSet, kvRemove } from './core/adapters.js';
export type { KvAdapter } from './core/adapters.js';

// Domain types
export type {
  ID,
  ObjectNode,
  ObjectType,
  ObjectsIndex,
  ObjectContentKind,
  Space,
  SpaceVisibility,
  CapMap,
  PubAccessMap,
  DmMap,
  MutePrefs,
  ReadPrefs,
  ArchivedDms,
} from './core/types.js';

// Ids
export { randomId, roomSlug } from './core/ids.js';

// Paths / cap scopes
export {
  OBJECT_COLLECTIONS,
  ownerScope,
  spaceMemberScope,
  accountScope,
  linkedDeviceScope,
  keyringName,
  keyringPull,
  keyringPush,
  objIndexPull,
  objIndexPush,
  spacesPull,
  spacesPush,
  spaceAccessPull,
  spaceAccessPush,
  profilePull,
  profilePush,
  objLogPull,
  objLogPush,
  objDocPull,
  objDocPush,
  objectBlobPull,
  objectBlobPush,
  typesIndexPull,
  typesIndexPush,
  attachmentPull,
  attachmentPush,
  spaceIndexName,
  spaceIndexPull,
  userIdFromEdPub,
  bytesToHex,
} from './sync/paths.js';

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

// Space access (replaces SpaceEncryptor)
export { SpaceAccessError, getSpaceAccess, buildSpaceAccess, clearSpaceAccessCache } from './sync/space-access.js';
export type { SpaceAccessHandle } from './sync/space-access.js';

// Space access store (replaces member-caps + pubspace-caps)
export {
  hydrateSpaceAccessStore,
  getSpaceAccessEntry,
  saveSpaceAccessEntry,
  removeSpaceAccessEntry,
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
  addDeviceToSpaceKeyring,
  encodeSpaceInviteLink,
  decodeSpaceInviteLink,
  createSpaceInviteLink,
  joinSpaceByLink,
  recoverSpaceAccess,
} from './spaces/members.js';
export type { JoinRequest, SpaceInviteLinkToken } from './spaces/members.js';

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
} from './spaces/object-index.js';

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
