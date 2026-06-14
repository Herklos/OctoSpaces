/**
 * Pure helper: maps tile interaction state + resolved theme tokens → visual style.
 * No React or React Native imports — fully testable in isolation.
 */
import type { ShadowToken } from '../theme/types.js';
import { glowShadow } from '../theme/helpers.js';

// ── Token contract ─────────────────────────────────────────────────────────────

/**
 * Resolved color tokens consumed by {@link railTileState}. Built from a `Theme`
 * object in the component layer (see `resolveRailTokens` in `SpacesRail.tsx`).
 * Swatch entries fall back to palette tokens when the host app hasn't set them.
 */
export interface RailTileTokens {
  // Core palette tokens
  primary: string;
  primaryMuted: string;
  primarySubtle: string;
  surfaceInput: string;
  borderSubtle: string;
  textOnPrimary: string;
  textSecondary: string;
  textTertiary: string;
  // Optional swatch overrides (host app can tune rail-specific colors)
  railTile: string;           // swatch 'railTile'    ?? surfaceInput
  railTileHoverBorder: string; // swatch 'railTileHoverBorder' ?? primarySubtle
  railGlow: string;           // swatch 'railGlow'    ?? primary
  railTileHoverInk: string;   // swatch 'railTileHoverInk' ?? primary
}

// ── Output ─────────────────────────────────────────────────────────────────────

/** Resolved visual properties for a single rail tile. */
export interface RailTileStyle {
  /** Tile background color. */
  bg: string;
  /** Tile border color. */
  borderColor: string;
  /** Tile border width (0 when active, 1 otherwise). */
  borderWidth: number;
  /** Tile border-radius in pixels (squared-off when active/hovered, rounded otherwise). */
  radius: number;
  /** Monogram label color. */
  labelColor: string;
  /** Active glow shadow, or `null` when not active. */
  shadow: ShadowToken | null;
}

// ── Mapping ────────────────────────────────────────────────────────────────────

/**
 * Map tile interaction state to visual style tokens.
 *
 * @param state     Current interaction state.
 * @param tokens    Resolved color tokens (see {@link RailTileTokens}).
 * @param radiusActive   Border-radius when the tile is active or hovered (squarer look).
 * @param radiusDefault  Border-radius for the resting state (rounder look).
 */
export function railTileState(
  state: { active: boolean; hovered: boolean; over: boolean },
  tokens: RailTileTokens,
  radiusActive: number,
  radiusDefault: number,
): RailTileStyle {
  const { active, hovered, over } = state;

  let bg: string;
  let borderColor: string;
  let borderWidth: number;
  let labelColor: string;

  if (active) {
    bg = tokens.primary;
    borderColor = 'transparent';
    borderWidth = 0;
    labelColor = tokens.textOnPrimary;
  } else if (hovered) {
    bg = tokens.primaryMuted;
    borderColor = tokens.railTileHoverBorder;
    borderWidth = 1;
    labelColor = tokens.railTileHoverInk;
  } else {
    bg = tokens.railTile;
    borderColor = tokens.borderSubtle;
    borderWidth = 1;
    labelColor = tokens.textSecondary;
  }

  // Drop-target overlay: accent border when a dragged tile is over this one.
  if (over && !active) {
    borderColor = tokens.primary;
    borderWidth = 1;
  }

  const radius = active || hovered || over ? radiusActive : radiusDefault;
  const shadow: ShadowToken | null = active ? glowShadow(tokens.railGlow, 8, 0.3) : null;

  return { bg, borderColor, borderWidth, radius, labelColor, shadow };
}
