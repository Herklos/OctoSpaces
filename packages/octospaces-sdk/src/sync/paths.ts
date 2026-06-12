/**
 * Collection path + cap-scope helpers for OctoSpaces.
 *
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push. Everything for a space is nested under
 * `spaces/{spaceId}/…` so the `{spaceId}` segment gates it all uniformly through the
 * space:owner/space:member enricher, and a single `spaces/{spaceId}/**` member cap
 * covers a whole space.
 *
 * **Generic object collections** — scopes use the `obj*` / `node*` collection names
 * (the domain-neutral storage layer). The access record lives at
 * `spaces/{spaceId}/_access` (collection `spaceregistry`); per-node keyrings at
 * `spaces/{spaceId}/objects/n/{nodeId}/_keyring` (collection `nodekeyring`).
 *
 * Note: `objinv` (invite-plaintext content) is intentionally EXCLUDED from
 * OBJECT_COLLECTIONS / spaceMemberScope — only a per-node cap can reach it.
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';

const pull = (rest: string) => `/pull/${rest}`;
const push = (rest: string) => `/push/${rest}`;

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Per-node keyring (one keyring per E2EE node) ──────────────────────────────
/** Base name used as the `collectionName` arg to `addCollectionRecipient`. */
export const nodeKeyringName = (spaceId: string, nodeId: string) =>
  `spaces/${spaceId}/objects/n/${nodeId}`;
export const nodeKeyringPull = (spaceId: string, nodeId: string) =>
  pull(`${nodeKeyringName(spaceId, nodeId)}/_keyring`);
export const nodeKeyringPush = (spaceId: string, nodeId: string) =>
  push(`${nodeKeyringName(spaceId, nodeId)}/_keyring`);

// ── Attachments (sealed blobs, in a per-space subtree keyed by room) ──────────
/** Storage path of one attachment blob — also the AAD bound into its seal. */
export const attachmentName = (roomId: string, blobId: string) =>
  `spaces/${spaceIdFromRoomId(roomId)}/attachments/${roomId}/${blobId}`;
export const attachmentPull = (roomId: string, blobId: string) => pull(attachmentName(roomId, blobId));
export const attachmentPush = (roomId: string, blobId: string) => push(attachmentName(roomId, blobId));

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
export const objIndexPull = (spaceId: string) => pull(objIndexName(spaceId));
export const objIndexPush = (spaceId: string) => push(objIndexName(spaceId));

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
export const objLogPull = (spaceId: string, objectId: string) => pull(objLogName(spaceId, objectId));
export const objLogPush = (spaceId: string, objectId: string) => push(objLogName(spaceId, objectId));

export const objDocName = (spaceId: string, objectId: string) => `spaces/${spaceId}/objects/docs/${objectId}`;
export const objDocPull = (spaceId: string, objectId: string) => pull(objDocName(spaceId, objectId));
export const objDocPush = (spaceId: string, objectId: string) => push(objDocName(spaceId, objectId));

/** Storage path of one sealed object blob — also the AAD bound into its seal. */
export const objectBlobName = (spaceId: string, blobId: string) => `spaces/${spaceId}/objects/blobs/${blobId}`;
export const objectBlobPull = (spaceId: string, blobId: string) => pull(objectBlobName(spaceId, blobId));
export const objectBlobPush = (spaceId: string, blobId: string) => push(objectBlobName(spaceId, blobId));

// ── Public node content (world-readable) ─────────────────────────────────────
// For `access:'public'` nodes, content is stored here so anonymous readers can
// fetch it without being a space member. Keep in sync with objpub in server config.
export const objPubName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/pub/${nodeId}`;
export const objPubPull = (spaceId: string, nodeId: string) => pull(objPubName(spaceId, nodeId));
export const objPubPush = (spaceId: string, nodeId: string) => push(objPubName(spaceId, nodeId));

// ── Invite-only plaintext content (cap-gated) ────────────────────────────────
// For `access:'invite' + enc:false` nodes, content is stored here. The `objinv`
// collection is intentionally excluded from spaceMemberScope — only a per-node cap
// (nodeMemberScope) can reach it. Keep in sync with objinv in server config.
export const objInvName = (spaceId: string, nodeId: string) => `spaces/${spaceId}/objects/n/${nodeId}/content`;
export const objInvPull = (spaceId: string, nodeId: string) => pull(objInvName(spaceId, nodeId));
export const objInvPush = (spaceId: string, nodeId: string) => push(objInvName(spaceId, nodeId));

// ── Per-space custom type registry ────────────────────────────────────────────
export const typesIndexName = (spaceId: string) => `spaces/${spaceId}/types/_index`;
export const typesIndexPull = (spaceId: string) => pull(typesIndexName(spaceId));
export const typesIndexPush = (spaceId: string) => push(typesIndexName(spaceId));

// ── Global object directory (server-maintained projection) ───────────────────
// Pull `_index/objects/{shard}` to discover world-readable public nodes.
// Default shard 'public'; future: sharded by app-supplied type string.
export const objectDirName = (shard: string = 'public') => `_index/objects/${shard}`;
export const objectDirPull = (shard: string = 'public') => pull(objectDirName(shard));

// ── Generic object collections — used in cap scopes ──────────────────────────
// These are the domain-neutral storage collections both apps migrate onto.
// IMPORTANT: `objinv` is NOT included here — it is excluded from the broad space
// member scope so that only per-node caps (nodeMemberScope) can reach it.
export const OBJECT_COLLECTIONS: string[] = [
  'nodekeyring', 'objindex', 'objlog', 'objsnap', 'objdoc', 'objblob', 'typeindex', 'objpub',
];

// ── Cap scopes ────────────────────────────────────────────────────────────────

/** Full owner/device access to every space the identity owns. */
export function ownerScope(): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: OBJECT_COLLECTIONS,
    paths: ['spaces/**'],
  };
}

/**
 * Member access to one SPACE — its node keyrings, every node's content docs and
 * attachments, all under `spaces/{spaceId}/**`. Does NOT cover `objinv` (invite-
 * plaintext content) — use `nodeMemberScope` for that. One cap covers current AND
 * future nodes.
 */
export function spaceMemberScope(spaceId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: OBJECT_COLLECTIONS,
    paths: [`spaces/${spaceId}/**`],
  };
}

/**
 * Narrow per-node cap for `invite+plaintext` nodes. Covers the node's keyring
 * (for future promotion to E2EE) and its `objinv` content path only.
 */
export function nodeMemberScope(spaceId: string, nodeId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['nodekeyring', 'objinv'],
    paths: [`spaces/${spaceId}/objects/n/${nodeId}/**`],
  };
}

/**
 * Personal cap: profile + space registry + device directory + all spaces.
 * Note: app-specific collections like `'dminbox'` (chat) are NOT included here —
 * add them in the consumer's own `paths.ts` extension.
 */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'spaceregistry'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
    ],
  };
}

/**
 * The single cap-cert scope granted to a PAIRED (linked) device. Covers both the
 * object-store client (ownerScope) and the account client (accountScope), deduped,
 * because a paired device cannot self-mint — it presents one root-signed cap-cert.
 */
export function linkedDeviceScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: [...OBJECT_COLLECTIONS, 'profile', 'devices', 'spaces', 'spaceregistry'],
    paths: [
      'spaces/**',
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
    ],
  };
}

/** Extract the single space id a member cap is scoped to (from its `spaces/<id>/**`).
 *  Returns null if the cap names no space path OR more than one distinct space. */
export function spaceIdFromCap(cap: { scope?: { paths?: string[] } }): string | null {
  let found: string | null = null;
  for (const p of cap.scope?.paths ?? []) {
    const m = /^spaces\/([^/]+)\//.exec(p);
    if (!m) continue;
    if (found !== null && found !== m[1]) return null;
    found = m[1]!;
  }
  return found;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** The canonical identity derivation: `userId = sha256(edPub)[0:32]` (hex). */
export async function userIdFromEdPub(edPubHex: string): Promise<string> {
  const bytes = new Uint8Array(edPubHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(edPubHex.slice(i * 2, i * 2 + 2), 16);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}
