/**
 * Collection path + cap-scope helpers for OctoSpaces.
 *
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push. Everything for a space is nested under
 * `spaces/{spaceId}/…` so the `{spaceId}` segment gates it all uniformly through the
 * space:owner/space:member enricher, and a single `spaces/{spaceId}/**` member cap
 * covers a whole space.
 *
 * **Generic object collections** — scopes use the `obj*` collection names (the
 * domain-neutral storage layer). The access record lives at
 * `spaces/{spaceId}/_access` (collection `spaceregistry`); the space-wide keyring at
 * `spaces/{spaceId}/_keyring` (collection `spacekeyring`). ONE keyring per space
 * encrypts ALL the space's `enc` nodes.
 *
 * Note: `objinv` (invite-plaintext content) is intentionally EXCLUDED from
 * OBJECT_COLLECTIONS / spaceMemberScope — only a per-node cap can reach it.
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';
import { bytesToHex } from '@drakkar.software/starfish-protocol';
export { bytesToHex };

const pull = (rest: string) => `/pull/${rest}`;
const push = (rest: string) => `/push/${rest}`;

/**
 * Derive the `/pull` + `/push` path helpers from a collection's `…Name` helper,
 * for the common case where both are just the storage name under the respective
 * verb prefix. Generic over the name helper's argument tuple so each derived
 * helper keeps the same call signature.
 */
const pullPush = <A extends unknown[]>(name: (...args: A) => string) => ({
  pull: (...args: A) => pull(name(...args)),
  push: (...args: A) => push(name(...args)),
});

/** A node id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromNodeId = (nodeId: string) => nodeId.split('-').slice(0, 2).join('-');

// ── Space-wide keyring (one keyring per space, encrypts all enc nodes) ────────
/** Base name used as the `collectionName` arg to `addCollectionRecipient`.
 *  Appending `/_keyring` gives the full storage path. */
export const keyringName = (spaceId: string) => `spaces/${spaceId}`;
export const keyringPull = (spaceId: string) => pull(`${keyringName(spaceId)}/_keyring`);
export const keyringPush = (spaceId: string) => push(`${keyringName(spaceId)}/_keyring`);

// ── Per-node keyring (one keyring per E2EE invite node, e.g. an OctoDesk ticket) ─
// Unlike the space-wide keyring, this CEK is wrapped only to the node's own
// participants (requester + owner/bot + assigned agents) — an external requester
// never touches the space key. Lives at `spaces/{spaceId}/objects/n/{nodeId}/_keyring`
// (collection `nodekeyring`), a sibling of the node's `content` (objinv) and `log`
// (objinvlog). `nodeKeyringName` is the `collectionName` arg to addCollectionRecipient;
// appending `/_keyring` gives the storage path. Keep in sync with the `nodekeyring`
// collection in apps/server AND Infra collections.py.
export const nodeKeyringName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/n/${nodeId}`;
export const nodeKeyringPull = (spaceId: string, nodeId: string) => pull(`${nodeKeyringName(spaceId, nodeId)}/_keyring`);
export const nodeKeyringPush = (spaceId: string, nodeId: string) => push(`${nodeKeyringName(spaceId, nodeId)}/_keyring`);

// ── Profile + registries ──────────────────────────────────────────────────────
export const profilePull = (userId: string) => pull(`user/${userId}/profile`);
export const profilePush = (userId: string) => push(`user/${userId}/profile`);

export const spacesPull = (userId: string) => pull(`user/${userId}/_spaces`);
export const spacesPush = (userId: string) => push(`user/${userId}/_spaces`);

export const spaceAccessPull = (spaceId: string) => pull(`spaces/${spaceId}/_access`);
export const spaceAccessPush = (spaceId: string) => push(`spaces/${spaceId}/_access`);

// ── Object index (member-gated, always plaintext) ────────────────────────────
// The index lists every node with structural fields plaintext. For `invite`
// nodes the title/emoji are stripped before storage; only invited members read
// the real title from the node's content doc. Keep in sync with the objindex
// collection in apps/server AND Infra collections.py.
export const objIndexName = (spaceId: string) => `spaces/${spaceId}/objects/_index`;
export const { pull: objIndexPull, push: objIndexPush } = pullPush(objIndexName);

// ── Space-tier & general object content (space:member gated) ─────────────────
//
//   objects/logs/{id}             — WAL/CRDT append-only op-log (contentKind "append")
//   objects/logs/{id}__snapshot   — sibling LWW snapshot for fast cold-start
//   objects/docs/{id}             — LWW merge-doc (contentKind "merge")
//   objects/blobs/{id}            — sealed raw binary blob
//
// Keep in sync with the objlog/objsnap/objdoc/objblob collections in
// apps/server AND Infra collections.py.
export const objLogName = (spaceId: string, objectId: string) => `spaces/${spaceId}/objects/logs/${objectId}`;
export const { pull: objLogPull, push: objLogPush } = pullPush(objLogName);

export const objDocName = (spaceId: string, objectId: string) => `spaces/${spaceId}/objects/docs/${objectId}`;
export const { pull: objDocPull, push: objDocPush } = pullPush(objDocName);

/** Storage path of one sealed object blob — also the AAD bound into its seal. */
export const objectBlobName = (spaceId: string, blobId: string) => `spaces/${spaceId}/objects/blobs/${blobId}`;
export const { pull: objectBlobPull, push: objectBlobPush } = pullPush(objectBlobName);

// ── Per-node sealed blob (invite-node attachments, cap-gated) ─────────────────
// For `access:'invite'` nodes: the blob sits under the node prefix so the
// requester's existing per-node stream cap (`nodeStreamScope`, collection
// `objinvlog`) authorizes it via `cap:write:objinvlog` role synthesis +
// path-glob containment. The node path is bound as the seal AAD so a sealed
// node blob cannot be relocated to the space-level objblob tier.
// Keep in sync with the `objnodeblob` collection in apps/server AND Infra collections.py.
export const nodeObjectBlobName = (spaceId: string, nodeId: string, blobId: string) =>
  `spaces/${spaceId}/objects/n/${nodeId}/blobs/${blobId}`;
export const { pull: nodeObjectBlobPull, push: nodeObjectBlobPush } = pullPush(nodeObjectBlobName);

// ── Public node content (world-readable) ─────────────────────────────────────
// For `access:'public'` nodes, content is stored here so anonymous readers can
// fetch it without being a space member. Keep in sync with objpub in server config.
export const objPubName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/pub/${nodeId}`;
export const { pull: objPubPull, push: objPubPush } = pullPush(objPubName);

// ── Invite-only plaintext content (cap-gated) ────────────────────────────────
// For `access:'invite' + enc:false` nodes, content is stored here. The `objinv`
// collection is intentionally excluded from spaceMemberScope — only a per-node cap
// (nodeMemberScope) can reach it. Keep in sync with objinv in server config.
export const objInvName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/n/${nodeId}/content`;
export const { pull: objInvPull, push: objInvPush } = pullPush(objInvName);

// ── Per-space custom type registry ────────────────────────────────────────────
export const typesIndexName = (spaceId: string) => `spaces/${spaceId}/types/_index`;
export const { pull: typesIndexPull, push: typesIndexPush } = pullPush(typesIndexName);

// ── Global object directory (server-maintained projection) ───────────────────
// Pull `_index/objects/{shard}` to discover world-readable public nodes.
// Default shard 'public'; future: sharded by app-supplied type string.
export const objectDirName = (shard: string = 'public') => `_index/objects/${shard}`;
export const objectDirPull = (shard: string = 'public') => pull(objectDirName(shard));

// ── Global space directory (server-maintained projection) ────────────────────
// Pull `_index/spaces/{shard}` to discover public spaces (Explore screen).
// Shard 'public' = spaces with at least one public node; 'meta' = name+image for all spaces.
export const spaceDirName = (shard: string = 'public') => `_index/spaces/${shard}`;
export const spaceDirPull = (shard: string = 'public') => pull(spaceDirName(shard));

// ── Public append-log (access:'public' streams) ───────────────────────────────
// For access:'public' nodes with an append-log content kind (e.g. public streams).
// Path sits under objects/pub/{nodeId}/log — sibling of the objpub merge-doc.
// Public-read + member-write. Keep in sync with objpublog in server collections.
export const objPubLogName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/pub/${nodeId}/log`;
export const { pull: objPubLogPull, push: objPubLogPush } = pullPush(objPubLogName);

// ── Invite-only append-log (cap-gated) ───────────────────────────────────────
// For access:'invite'+enc:false nodes with an append-log content kind. Gated by per-node
// cap via the sharing plugin — NOT space:member. Excluded from spaceMemberScope.
// Keep in sync with objinvlog in server collections.
export const objInvLogName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/n/${nodeId}/log`;
export const { pull: objInvLogPull, push: objInvLogPush } = pullPush(objInvLogName);

// ── Node-scoped stream path shortcuts (nodeId encodes spaceId) ────────────────
// Convenience wrappers for callers that have a nodeId and want to route to the
// correct log tier without extracting the spaceId separately.
// Node ids use `sp-<spaceId>-<local>` so spaceIdFromNodeId extracts the space portion.
export const streamNodeName = (nodeId: string) => objLogName(spaceIdFromNodeId(nodeId), nodeId);
export const streamNodePull = (nodeId: string) => objLogPull(spaceIdFromNodeId(nodeId), nodeId);
export const streamNodePush = (nodeId: string) => objLogPush(spaceIdFromNodeId(nodeId), nodeId);
export const streamPubNodeName = (nodeId: string) => objPubLogName(spaceIdFromNodeId(nodeId), nodeId);
export const streamPubNodePull = (nodeId: string) => objPubLogPull(spaceIdFromNodeId(nodeId), nodeId);
export const streamPubNodePush = (nodeId: string) => objPubLogPush(spaceIdFromNodeId(nodeId), nodeId);
export const streamInvNodeName = (nodeId: string) => objInvLogName(spaceIdFromNodeId(nodeId), nodeId);
export const streamInvNodePull = (nodeId: string) => objInvLogPull(spaceIdFromNodeId(nodeId), nodeId);
export const streamInvNodePush = (nodeId: string) => objInvLogPush(spaceIdFromNodeId(nodeId), nodeId);

// ── Owner-only node content (access:'owner') ──────────────────────────────────
// For access:'owner' nodes — readable and writable only by the space owner.
// The owner tier of the generic object model (webhooks, private config, etc.).
// Excluded from spaceMemberScope; covered by ownerScope / spaceOwnerScope.
// Keep in sync with objowner in server collections.
export const objOwnerName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/owner/${nodeId}`;
export const { pull: objOwnerPull, push: objOwnerPush } = pullPush(objOwnerName);

// ── Identity inbox (public-write, cap-read) ───────────────────────────────────
// Per-identity drop-box (resource requests/grants, etc). Anyone appends; only the recipient reads via cap:read:inbox.
// Time-sharded by UTC month (shard = 'YYYY-MM'). Path is identity-scoped, NOT under spaces/.
// Keep in sync with inbox in server collections.
export const inboxName = (identity: string, shard: string = 'default') => `inbox/${identity}/${shard}`;
export const inboxPull = (identity: string, shard?: string) => pull(inboxName(identity, shard));
export const inboxPush = (identity: string, shard?: string) => push(inboxName(identity, shard));

// ── Generic object collections — used in cap scopes ──────────────────────────
// Domain-neutral storage collections covered by the broad space:member scope.
// EXCLUDED (intentionally, require narrower caps):
//   objinv    — invite-only content (per-node cap via nodeMemberScope)
//   objinvlog — invite-only append-log (per-node cap)
//   objowner  — owner-only content (spaceOwnerScope / ownerScope only)
//   inbox     — identity-scoped, not under spaces/**
// `spacekeyring` IS included — space members need the keyring to decrypt enc content.
// `objpublog` IS included — space members may write to public append-logs.
export const OBJECT_COLLECTIONS: string[] = [
  'spacekeyring', 'objindex', 'objlog', 'objsnap', 'objdoc', 'objblob', 'typeindex', 'objpub', 'objpublog',
];

// OWNER_COLLECTIONS extends member collections with objowner (webhook registry) and
// objinvlog so the space owner can read all per-node invite streams (e.g. ticket inbox).
const OWNER_COLLECTIONS: string[] = [...OBJECT_COLLECTIONS, 'objowner', 'objinvlog'];

// ── Cap scopes ────────────────────────────────────────────────────────────────

/** Read/list, plus write when `canWrite`. The standard member op-set. */
const rwOps = (canWrite: boolean): ('read' | 'write' | 'list')[] =>
  canWrite ? ['read', 'list', 'write'] : ['read', 'list'];

/** Full owner/device access to every space the identity owns (all tiers). */
export function ownerScope(): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: OWNER_COLLECTIONS,
    paths: ['spaces/**'],
  };
}

/**
 * Owner access to ONE space — covers all member collections plus the owner-only
 * content tier (`objowner`). Use when minting a per-space cap for a space owner
 * (e.g. webhook config, private-config nodes).
 */
export function spaceOwnerScope(spaceId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: OWNER_COLLECTIONS,
    paths: [`spaces/${spaceId}/**`],
  };
}

/**
 * Member access to one SPACE — the space keyring, every node's content docs and
 * attachments, all under `spaces/{spaceId}/**`. Does NOT cover `objinv` (invite-
 * plaintext content) — use `nodeMemberScope` for that. One cap covers current AND
 * future nodes.
 */
export function spaceMemberScope(spaceId: string, canWrite: boolean): ScopePreset {
  return {
    ops: rwOps(canWrite),
    collections: OBJECT_COLLECTIONS,
    paths: [`spaces/${spaceId}/**`],
  };
}

/**
 * Narrow per-node cap for `invite+plaintext` nodes. Covers ONLY the node's `objinv`
 * content path — the space keyring is space-wide and is covered by the broader space
 * member scope. Use `spaceMemberScope` when the bearer also needs to decrypt enc content.
 */
export function nodeMemberScope(spaceId: string, nodeId: string, canWrite: boolean): ScopePreset {
  return {
    ops: rwOps(canWrite),
    collections: ['objinv'],
    paths: [`spaces/${spaceId}/objects/n/${nodeId}/**`],
  };
}

/**
 * Narrow per-node cap for an `invite+plaintext` node's append-log STREAM
 * (`objinvlog`). A `member` cap-cert covers exactly one collection (the sharing
 * plugin enforces this), so the stream needs its OWN cap separate from
 * `nodeMemberScope` (which covers `objinv` content). Mint both for a node that has
 * both content and a message stream; the bearer presents whichever matches the
 * collection it is reaching.
 */
export function nodeStreamScope(spaceId: string, nodeId: string, canWrite: boolean): ScopePreset {
  return {
    ops: rwOps(canWrite),
    collections: ['objinvlog'],
    paths: [`spaces/${spaceId}/objects/n/${nodeId}/**`],
  };
}

/**
 * Narrow per-node cap for an `invite+enc` node's KEYRING (`nodekeyring`). The
 * per-node keyring's CEK is wrapped to the node's participants; an isolated
 * requester presents this cap to READ the keyring blob and decrypt content. It is
 * deliberately READ-only: only the owner/bot/agents (as `space:member`) write the
 * keyring, and a write scope reaching `<col>/_keyring` would also trip the cap-mint
 * barrier. Single-collection, like every other `member` cap.
 */
export function nodeKeyringScope(spaceId: string, nodeId: string): ScopePreset {
  return {
    ops: ['read', 'list'],
    collections: ['nodekeyring'],
    paths: [`spaces/${spaceId}/objects/n/${nodeId}/**`],
  };
}

/**
 * Personal cap: profile + space registry + device directory + all spaces + inbox.
 * Covers reading the identity's own inbox (`cap:read:inbox` via `inbox/{userId}/**`).
 */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'spaceregistry', 'inbox'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
      `inbox/${userId}/**`,
    ],
  };
}

/**
 * The single cap-cert scope granted to a PAIRED (linked) device. Covers both the
 * object-store client (ownerScope) and the account client (accountScope), deduped,
 * because a paired device cannot self-mint — it presents one root-signed cap-cert.
 * Includes `objowner` (linked device acts as owner) and `inbox` (reads requests).
 */
export function linkedDeviceScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: [...OWNER_COLLECTIONS, 'profile', 'devices', 'spaces', 'spaceregistry', 'inbox'],
    paths: [
      'spaces/**',
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      `inbox/${userId}/**`,
    ],
  };
}

/** A 32-byte key as 64 hex chars — shared by Ed25519 + X25519 KEM public keys. */
const HEX64 = /^[0-9a-f]{64}$/i;
/** Ed25519 public key: 32 bytes = 64 lowercase hex chars. */
export const ED_PUB_HEX_RE = HEX64;
/** X25519 KEM public key: 32 bytes = 64 lowercase hex chars. */
export const KEM_PUB_HEX_RE = HEX64;
/** Ed25519 signature: 64 bytes = 128 lowercase hex chars. */
export const KEM_SIG_HEX_RE = /^[0-9a-f]{128}$/i;
/** Length (in hex chars) of an OctoSpaces userId (first 16 bytes of sha256(edPub)). */
export const USER_ID_HEX_LENGTH = 32;
/** Short label length (hex chars) used for human-readable keyring recipient labels. */
export const RECIPIENT_LABEL_LEN = 8;

/** Build a keyring-recipient descriptor with the standard short label from a userId. */
export const recipientFor = (subKem: string, userId: string) => ({
  subKem,
  userId,
  label: userId.slice(0, RECIPIENT_LABEL_LEN),
});
/** OctoSpaces userId regex: first {@link USER_ID_HEX_LENGTH} hex chars of sha256(edPub). */
export const USER_ID_HEX_RE = new RegExp(`^[0-9a-f]{${USER_ID_HEX_LENGTH}}$`, 'i');

/** The canonical identity derivation: `userId = sha256(edPub)[0:${USER_ID_HEX_LENGTH}]` (hex). */
export async function userIdFromEdPub(edPubHex: string): Promise<string> {
  if (!ED_PUB_HEX_RE.test(edPubHex)) {
    throw new Error(`userIdFromEdPub: invalid edPub — expected 64 hex chars, got length ${edPubHex.length}`);
  }
  const bytes = new Uint8Array(edPubHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(edPubHex.slice(i * 2, i * 2 + 2), 16);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, USER_ID_HEX_LENGTH);
}
