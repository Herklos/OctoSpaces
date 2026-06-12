/**
 * Collection path + cap-scope helpers (merged from OctoChat + OctoVault).
 *
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push. Everything for a space is nested under
 * `spaces/{spaceId}/…` so the `{spaceId}` segment gates it all uniformly through the
 * space:owner/space:member enricher, and a single `spaces/{spaceId}/**` member cap
 * covers a whole space.
 *
 * **Generic object collections** — scopes use the `obj*` collection names (the
 * domain-neutral storage layer both apps migrate onto). App-specific collection
 * names like `'chat'` are left for the consumer's own `paths.ts` extension until
 * that app finishes migrating.
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';

const pull = (rest: string) => `/pull/${rest}`;
const push = (rest: string) => `/push/${rest}`;

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Space-wide keyring (one per space, shared by all its channels) ────────────
export const keyringName = (spaceId: string) => `spaces/${spaceId}`;
export const keyringPull = (spaceId: string) => pull(`${keyringName(spaceId)}/_keyring`);
export const keyringPush = (spaceId: string) => push(`${keyringName(spaceId)}/_keyring`);

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

export const roomsRegistryPull = (spaceId: string) => pull(`spaces/${spaceId}/_rooms`);
export const roomsRegistryPush = (spaceId: string) => push(`spaces/${spaceId}/_rooms`);

// ── Unified Object index + content (private/E2EE) ─────────────────────────────
// ALL Object content lives in one generic path family — no type-specific prefixes:
//
//   objects/_index          — union-merged ObjectNode tree (every Object in the space)
//   objects/logs/{id}       — WAL/CRDT append-only op-log (contentKind "append")
//   objects/logs/{id}__snapshot — sibling LWW snapshot for fast cold-start
//   objects/docs/{id}       — LWW merge-doc (contentKind "merge": records, captions)
//   objects/blobs/{id}      — sealed raw binary blob (file/image objects)
//
// Keep in sync with the objindex/objlog/objsnap/objdoc/objblob collections in
// apps/server AND Infra collections.py.
export const objIndexName = (spaceId: string) => `spaces/${spaceId}/objects/_index`;
export const objIndexPull = (spaceId: string) => pull(objIndexName(spaceId));
export const objIndexPush = (spaceId: string) => push(objIndexName(spaceId));

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

// ── Per-space custom type registry (private/E2EE) ─────────────────────────────
export const typesIndexName = (spaceId: string) => `spaces/${spaceId}/types/_index`;
export const typesIndexPull = (spaceId: string) => pull(typesIndexName(spaceId));
export const typesIndexPush = (spaceId: string) => push(typesIndexName(spaceId));

// ── Public-space directory index (server-maintained projection) ───────────────
export const spaceIndexName = (shard: 'public') => `_index/spaces/${shard}`;
export const spaceIndexPull = (shard: 'public') => pull(spaceIndexName(shard));

// ── Generic object collections — used in cap scopes ──────────────────────────
// These are the domain-neutral storage collections both apps migrate onto. The
// server ignores unrecognized collection names, so a cap minted with this set still
// authorizes an app whose data currently lives under a legacy collection name during
// the migration transition.
export const OBJECT_COLLECTIONS: string[] = [
  'keyring', 'objindex', 'objlog', 'objsnap', 'objdoc', 'objblob', 'typeindex',
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
 * Member access to one SPACE — its keyring + every channel's messages and
 * attachments + the room registry, all under `spaces/{spaceId}/**`. One cap
 * covers current AND future channels.
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
 * Personal cap: profile + space registry + device directory + all spaces.
 * Note: app-specific collections like `'dminbox'` (chat) are NOT included here —
 * add them in the consumer's own `paths.ts` extension.
 */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'rooms'],
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
    collections: [...OBJECT_COLLECTIONS, 'profile', 'devices', 'spaces', 'rooms'],
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
