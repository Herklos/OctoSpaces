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
  RoomSubtype,
  AutomationMeta,
  Room,
  RoomKind,
  Space,
  CapMap,
  PubAccessMap,
  DmMap,
  MutePrefs,
  ReadPrefs,
  ArchivedDms,
  BUILTIN_OBJECT_TYPES,
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
  pubspaceScope,
  keyringName,
  keyringPull,
  keyringPush,
  objIndexPull,
  objIndexPush,
  pubObjIndexPull,
  pubObjIndexPush,
  spacesPull,
  spacesPush,
  roomsRegistryPull,
  roomsRegistryPush,
  profilePull,
  profilePush,
  pubspaceRoomsPull,
  pubspaceRoomsPush,
  objLogPull,
  objLogPush,
  objDocPull,
  objDocPush,
  objectBlobPull,
  objectBlobPush,
  typesIndexPull,
  typesIndexPush,
  pubObjDocPull,
  pubObjDocPush,
  pubObjLogPull,
  pubObjLogPush,
  attachmentPull,
  attachmentPush,
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

// Space access
export { SpaceAccessError } from './core/space-access-error.js';
export { getSpaceEncryptor, buildSpaceEncryptor, clearSpaceEncryptors } from './sync/space-encryptor.js';
export type { SpaceEncryptor } from './sync/space-encryptor.js';

// Registry
export {
  DEFAULT_CATEGORY,
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
  readRooms,
  writeRooms,
  addSpaceMember,
  addJoinedSpace,
  addJoinedSpaceWithCap,
  addJoinedPublicSpaceWithAccess,
  createSpace,
  normalizeCategories,
  reconcileSpaceMeta,
  onSpaceMeta,
  broadcastSpaceMeta,
  CategoryError,
} from './spaces/registry.js';
export type { SpaceMeta, SpaceMetaUpdate } from './spaces/registry.js';

// Members
export {
  makeJoinRequest,
  inviteToSpace,
  acceptSpaceInvite,
  addDeviceToSpaceKeyring,
  getMemberCap,
} from './spaces/members.js';
export type { JoinRequest } from './spaces/members.js';

// Member caps
export {
  hydrateMemberCaps,
  saveMemberCap,
  removeMemberCap,
  clearMemberCaps,
} from './sync/member-caps.js';

// Pubspace caps
export {
  hydratePubspaceCaps,
  mergePubspaceAccess,
  localPubspaceEntries,
  getPubspaceAccess,
  savePubspaceAccess,
  removePubspaceAccess,
  clearPubspaceCaps,
} from './sync/pubspace-caps.js';
export type { PubspaceAccess, AccessMap } from './sync/pubspace-caps.js';

// Public spaces
export {
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  encodePublicInviteLink,
  decodePublicInvite,
  createPublicSpace,
  createPublicInvite,
  joinPublicSpace,
  recoverPubspaceAccess,
  readPublicRooms,
  readPublicRoomsDoc,
  createPublicRoom,
  updatePublicSpaceMeta,
  updatePublicRoomsRegistry,
  updatePublicObjectIndex,
} from './spaces/pubspace.js';
export type { PublicInviteToken } from './spaces/pubspace.js';

// Object core
export {
  categoryId,
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
  seedIndexNodes,
  objectsToRoomCategories,
  excludeAutomatedRooms,
  roomKindToSubtype,
  subtypeToRoomKind,
} from './objects/objects.js';
export type { ObjectTreeNode, NewObjectInput, AdaptedCategory, SeedRoom } from './objects/objects.js';

// Object index
export {
  readIndexRooms,
  readPublicIndexRooms,
  readPrivateIndexRooms,
  readPrivateSpaceRooms,
  pushIndexSeed,
  seedSpaceObjectIndex,
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
