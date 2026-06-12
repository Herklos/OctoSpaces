/**
 * Domain model for OctoSpaces — space + generic object-tree types shared by the SDK.
 *
 * A space's contents are modelled as a tree of typed {@link ObjectNode}s stored in
 * a union-merged index at `spaces/{spaceId}/objects/_index`. The SDK is deliberately
 * domain-agnostic: it defines only the generic {@link ObjectNode} envelope and the
 * {@link ObjectType} string alias. Apps (OctoChat, OctoVault, …) declare their own
 * type strings and descriptors — they are not defined here.
 *
 * Visibility and confidentiality are **per-node** properties, not per-space:
 *   - {@link NodeAccess} controls who may reach a node's content.
 *   - `enc` controls whether the node's content is E2EE under its own keyring.
 * A space is a neutral container; its `_access` record holds only the owner + roster.
 */

// Re-export SealedBlob so consumers get it from one place.
export type { SealedBlob } from '../sync/account-seal.js';

export type ID = string;

/** A user's presence indicator. The theme maps each to a color (app-side). */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

/** A security item's verification state. The theme maps each to a color (app-side). */
export type VerificationLevel = 'verified' | 'pending' | 'unverified';

/** Maps a joined space's id → its owner-issued member cap-cert (serialized JSON).
 *  Persisted both in device-local kv and, for durability, in the user's own synced
 *  `_spaces` doc so a fresh device re-hydrates it. */
export type CapMap = Record<string, string>;

/** Maps a joined link-access key → its sealed invitation credential (cap + ephemeral
 *  private key) SEALED to the account's own key. Keys are either `spaceId` (space-level
 *  link) or `${spaceId}:${nodeId}` (per-node invite link). Sealed because it embeds a
 *  bearer secret; recovered on any device with the same seed. */
export type PubAccessMap = Record<string, import('../sync/account-seal.js').SealedBlob>;

/** Maps a DM peer's userId → the private DM-space id shared with them. */
export type DmMap = Record<string, string>;

/** The set of DM-space ids the user has archived (hidden from the DM list). */
export type ArchivedDms = Record<string, true>;

/** A mute entry. `true` = muted indefinitely; a number = muted UNTIL that epoch-ms instant. */
export type MuteValue = true | number;

/** Per-user mute preferences: which rooms and which whole spaces are silenced. */
export interface MutePrefs {
  rooms: Record<string, MuteValue>;
  spaces: Record<string, MuteValue>;
}

/** A per-room read mark: the epoch-ms instant the viewer last read that room. */
export type ReadValue = number;

/** Per-user read marks — the timestamp each room was last read. */
export interface ReadPrefs {
  rooms: Record<string, ReadValue>;
}

/** A joined or listed space. Visibility and encryption are per-node (see ObjectNode),
 *  not per-space — a space is a neutral container. */
export interface Space {
  id: ID;
  name: string;
  /** 2-letter monogram used in the space rail. */
  short: string;
  /** Uploaded space image as a data URI; absent → render the `short` monogram. */
  image?: string;
  members: number;
  unread?: number;
}

// ── Object model ─────────────────────────────────────────────────────────────
// Everything in a space is an ObjectNode with a type string. Apps (OctoChat,
// OctoVault, …) define their own type strings; none are baked into the SDK.

/** Any string an app assigns as an object's type. No builtins are defined here —
 *  each app declares its own type strings in its local SDK. */
export type ObjectType = string;

/** How an object's content syncs. Apps may set this per-type explicitly. */
export type ObjectContentKind = 'merge' | 'append' | 'none';

/** Who may read a node's content (independent from whether it is E2EE):
 *  - `'public'`  — world-readable; anonymous users may access the content. The node
 *                  is listed in the global object directory (`_index/objects/{shard}`).
 *  - `'space'`   — any member of the parent space. The default for new nodes.
 *  - `'invite'`  — only members explicitly invited to this node (via its own per-node
 *                  keyring for E2EE nodes, or via a per-node cap for plaintext nodes).
 *                  Non-invited space members see a placeholder row (no title/emoji). */
export type NodeAccess = 'public' | 'space' | 'invite';

/**
 * One entry in a space's object index (`spaces/{spaceId}/objects/_index`).
 * Identity + tree position + light metadata ONLY — heavy content (messages, doc
 * blocks, event logs) lives in per-object content docs keyed by `id`.
 *
 * The index doc is always **plaintext** (member-gated). For `invite` nodes the
 * `title` and `emoji` fields are stored empty in the index — only invited members
 * can recover the real title from the node's content doc or encrypted keyring entry.
 */
export interface ObjectNode {
  id: ID;
  type: ObjectType;
  parentId: ID | null;
  order: number;
  title: string;
  emoji?: string;
  updatedAt: number;
  archived?: boolean;
  contentKind?: ObjectContentKind;
  /** Who may access this node's content. Absent ⇒ `'space'`. */
  access?: NodeAccess;
  /** True ⇒ this node's content is E2EE under its own per-node keyring at
   *  `objects/n/{id}/_keyring`. The combination `public + enc` is invalid. */
  enc?: boolean;
  /** App-specific fields. Apps store type-specific metadata here. */
  meta?: Record<string, unknown>;
}

/** The object-index doc stored at `spaces/{spaceId}/objects/_index`. */
export interface ObjectsIndex {
  v: 1 | 2;
  objects: ObjectNode[];
  updatedAt: number;
}
