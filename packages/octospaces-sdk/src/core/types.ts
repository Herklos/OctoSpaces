/**
 * Domain model for OctoSpaces — space + object types shared by the SDK and any UI.
 *
 * A space's contents are modelled as a tree of typed {@link ObjectNode}s stored in
 * a union-merged index at `spaces/{spaceId}/objects/_index`. Everything —  rooms,
 * categories, docs, projects, tasks — is an `ObjectNode` discriminated by `type`.
 * Apps extend the model by adding their own `ObjectType` strings; the generic
 * primitives here are app-neutral.
 */

// Re-export SealedBlob so consumers get it from one place.
export type { SealedBlob } from '../sync/account-seal.js';

export type ID = string;

/** A user's presence indicator. The theme maps each to a color (app-side). */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

/** A security item's verification state. The theme maps each to a color (app-side). */
export type VerificationLevel = 'verified' | 'pending' | 'unverified';

/** Maps a joined private space's id → its owner-issued member cap-cert (serialized
 *  JSON). Persisted both in device-local kv (`member-caps.ts`) and, for durability,
 *  in the user's own synced `_spaces` doc so a fresh device re-hydrates it. */
export type CapMap = Record<string, string>;

/** Maps a joined PUBLIC space's id → its invitation credential (the owner-signed cap
 *  plus the link's ephemeral private key) SEALED to the account's own key. Unlike a
 *  member cap (safe in the clear — see {@link CapMap}), a public-join credential
 *  embeds a bearer secret, so it is sealed before riding in the plaintext `_spaces`
 *  doc. Recovered on any device with the same seed. See `account-seal.ts` and
 *  `space-access-store.ts`. */
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

/** Whether a space encrypts its content client-side. */
export type SpaceVisibility = 'private' | 'public';

export interface Space {
  id: ID;
  name: string;
  /** 2-letter monogram used in the space rail. */
  short: string;
  /** Uploaded space image as a data URI; absent → render the `short` monogram. */
  image?: string;
  members: number;
  unread?: number;
  /** 'private' (E2EE keyring, the default) or 'public' (plaintext, joined via a
   *  space-wide invitation link). Absent ⇒ treat as 'private' (back-compat). */
  visibility?: SpaceVisibility;
  /** Public spaces only: the owner's userId (derived from the cap issuer). */
  ownerId?: string;
  /** Public spaces only (joiner side): whether this identity's invite link grants write. */
  write?: boolean;
}

/** Legacy room kind — used while apps migrate their content onto objects.
 *  New code should use {@link RoomSubtype} directly. */
export type RoomKind = 'channel' | 'dm' | 'automated';

/** Scheduled-fetch cadence for automated rooms. */
export type AutomationSchedule =
  | { kind: 'interval'; everyMin: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'cron'; expression: string };

/** Stored, synced configuration of an `automated` room. */
export interface AutomationMeta {
  providerId: string;
  params: Record<string, unknown>;
  intervalMin: number;
  schedule?: AutomationSchedule;
  onOpen?: boolean;
  enabled: boolean;
  credential: import('../sync/account-seal.js').SealedBlob;
  botUserId?: string;
  runOnDeviceId: string | null;
  lastRunAt: number | null;
  lastFetchHash?: string | null;
  lastError: string | null;
}

/** A transitional Room shape (used while apps migrate onto the object model). */
export interface Room {
  id: ID;
  spaceId: ID;
  category: string;
  name: string;
  kind: RoomKind;
  topic?: string;
  unread?: number;
  mention?: boolean;
  avatar?: string;
  automation?: AutomationMeta;
}

// ── Object model ─────────────────────────────────────────────────────────────
// Everything in a space — rooms, categories, docs, projects, etc. — is an
// ObjectNode with a type. Apps extend ObjectType with their own strings.

/** The builtin object types. Custom types ride the same `string` field. */
export type BuiltinObjectType = 'room' | 'category' | 'automation' | 'doc' | 'project' | 'task';
export type ObjectType = BuiltinObjectType | (string & {});

/** Runtime set of builtin type strings for renderer branching. */
export const BUILTIN_OBJECT_TYPES: readonly BuiltinObjectType[] = ['room', 'category', 'automation', 'doc', 'project', 'task'];

/** How an object's content syncs. Builtins infer this; custom types set it explicitly. */
export type ObjectContentKind = 'merge' | 'append' | 'none';

/** When `type === 'room'`, the room flavour. */
export type RoomSubtype = 'channel' | 'dm' | 'automation';

/**
 * One entry in a space's object index (`spaces/{spaceId}/objects/_index`).
 * Identity + tree position + light metadata ONLY — heavy content (messages, doc
 * blocks, project event log) lives in a per-object content doc keyed by `id`.
 */
export interface ObjectNode {
  id: ID;
  type: ObjectType;
  subtype?: RoomSubtype;
  parentId: ID | null;
  order: number;
  title: string;
  emoji?: string;
  updatedAt: number;
  archived?: boolean;
  automation?: AutomationMeta;
  contentKind?: ObjectContentKind;
  meta?: Record<string, unknown>;
}

/** The object-index doc: the union-merged list of every object in a space. */
export interface ObjectsIndex {
  v: 1;
  objects: ObjectNode[];
  updatedAt: number;
}
