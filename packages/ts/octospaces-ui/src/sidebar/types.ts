/**
 * Shared types for the SpacesRail component.
 *
 * Structurally compatible with `Space` from `@drakkar.software/octospaces-sdk` — apps can pass their domain objects directly
 * without a runtime conversion step.
 */

/** A minimal space descriptor for the rail: id + display info + badge state. */
export interface RailSpace {
  /** Unique space identifier. */
  id: string;
  /** Short display name or initials shown as a monogram when no image is available. */
  short: string;
  /** Optional image URI (data URI or URL) rendered as the tile background via
   *  `SpacesRailProps.renderTileImage`. */
  image?: string;
  /** Unread-message count shown as a badge overlay. */
  unread?: number;
  /** Whether the space is muted (shows a mute-corner icon when `renderIcon` is provided). */
  muted?: boolean;
}

/** Named icon slots injected into the rail via `SpacesRailProps.renderIcon`. */
export type RailIconName = 'dm' | 'lock' | 'mute' | 'add' | 'notes';

/** A pinned non-space tile (Notes, DMs, …) rendered above the space tiles. */
export interface RailSpecialTile {
  /** Stable React key. */
  key: string;
  /** Glyph slot — rendered by the host via `renderIcon`. */
  icon: RailIconName;
  onPress: () => void;
  /** Highlight this tile when its destination is the active route. */
  active?: boolean;
  /** Unread count badge (omit when there is no unread concept). */
  unread?: number;
  /** Accessibility label for the tile. */
  label?: string;
}
