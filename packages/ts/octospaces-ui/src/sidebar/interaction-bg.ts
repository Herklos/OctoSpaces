/**
 * Resolve the background color for an interactive surface (Pressable / row) from
 * its `pressed` / `hovered` state — the analogue of `railTileState` for the flat
 * sidebar/menu surfaces.
 *
 * Every sidebar/menu component had its own `pressed ? X : hovered ? Y : 'transparent'`
 * ladder with subtly different rgba fallbacks (hover 0.04 vs 0.05, pressed 0.08 vs
 * 0.10). This centralises the ladder and the canonical fallbacks; callers pass the
 * theme colors they want for each state, and the canonical rgba applies only when a
 * theme omits that color.
 */

/** Canonical fallbacks when the host theme doesn't supply an interaction color. */
export const INTERACTION_BG_PRESSED_FALLBACK = 'rgba(0,0,0,0.08)';
export const INTERACTION_BG_HOVERED_FALLBACK = 'rgba(0,0,0,0.05)';

export interface InteractionState {
  pressed?: boolean;
  hovered?: boolean;
}

export interface InteractionBgColors {
  /** Background while pressed (e.g. `colors.primaryMuted`). */
  pressed?: string;
  /** Background while hovered (e.g. `colors.primarySubtle`). */
  hovered?: string;
  /** Resting background. @default 'transparent' */
  base?: string;
}

/** Pressed wins over hovered wins over base. */
export function interactionBg(state: InteractionState, colors: InteractionBgColors): string {
  if (state.pressed) return colors.pressed ?? INTERACTION_BG_PRESSED_FALLBACK;
  if (state.hovered) return colors.hovered ?? INTERACTION_BG_HOVERED_FALLBACK;
  return colors.base ?? 'transparent';
}
