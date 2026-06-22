/**
 * Domain model for OctoSpaces — types shared by the SDK.
 *
 * Core object-tree types (`ID`, `ObjectNode`, `ObjectsIndex`, `ObjectType`,
 * `ObjectContentKind`, `NodeAccess`, `SealedBlob`) are now defined in
 * `@drakkar.software/starfish-spaces` and re-exported from here for backwards
 * compatibility. OctoSpaces-specific types (presence, verification, prefs) remain.
 */

// ── Re-exports from starfish-spaces (single source of truth) ─────────────────
export type {
  ID,
  ObjectType,
  ObjectContentKind,
  NodeAccess,
  ObjectNode,
  ObjectsIndex,
  SealedBlob,
} from '@drakkar.software/starfish-spaces';

// ── OctoSpaces-specific types ─────────────────────────────────────────────────

/** A user's presence indicator. The theme maps each to a color (app-side). */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

/** A security item's verification state. The theme maps each to a color (app-side).
 *  `none` = unknown / not yet verified; maps to a neutral/muted color in the theme. */
export type VerificationLevel = 'verified' | 'pending' | 'unverified' | 'none';

/** Maps a joined space's id → its owner-issued member cap-cert (serialized JSON).
 *  Persisted both in device-local kv and, for durability, in the user's own synced
 *  `_spaces` doc so a fresh device re-hydrates it. */
export type CapMap = Record<string, string>;

/** Maps a joined link-access key → its sealed invitation credential (cap + ephemeral
 *  private key) SEALED to the account's own key. Keys are either `spaceId` (space-level
 *  link) or `${spaceId}:${nodeId}` (per-node invite link). Sealed because it embeds a
 *  bearer secret; recovered on any device with the same seed. */
export type PubAccessMap = Record<string, import('@drakkar.software/starfish-spaces').SealedBlob>;

/** A mute entry. `true` = muted indefinitely; a number = muted UNTIL that epoch-ms instant. */
export type MuteValue = true | number;

/** Per-user mute preferences: which nodes and which whole spaces are silenced. */
export interface MutePrefs {
  nodes: Record<string, MuteValue>;
  spaces: Record<string, MuteValue>;
}

/** A per-node read mark: the epoch-ms instant the viewer last read that node. */
export type ReadValue = number;

/** Per-user read marks — the timestamp each node was last read. */
export interface ReadPrefs {
  nodes: Record<string, ReadValue>;
}
