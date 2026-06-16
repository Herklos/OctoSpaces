/**
 * Pure palette-helper functions over a {@link Palette}. No theme values live here —
 * only functions that DERIVE from the injected palette (or from passed-in colors).
 *
 * Import these from `@drakkar.software/octospaces-ui` (re-exported by `src/index.ts`).
 */
import type { Palette, ShadowToken, Theme } from './types.js';

// ── Presence ──────────────────────────────────────────────────────────────────

/** Map a presence status string to the corresponding palette color. */
export function presenceColor(
  palette: Palette,
  status: 'online' | 'away' | 'busy' | 'offline' | string,
): string {
  switch (status) {
    case 'online': return palette.presenceOnline;
    case 'away':   return palette.presenceAway;
    case 'busy':   return palette.presenceBusy;
    default:       return palette.presenceOffline;
  }
}

// ── Verification ──────────────────────────────────────────────────────────────

/** Map a verification level to the corresponding palette color. */
export function verificationColor(
  palette: Palette,
  level: 'verified' | 'partial' | 'none' | string,
): string {
  switch (level) {
    case 'verified': return palette.verificationVerified;
    case 'partial':  return palette.verificationPartial;
    default:         return palette.verificationNone;
  }
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_TINT_KEYS = [
  'primary', 'success', 'warning', 'danger', 'info',
] as const;

/** Stable avatar background tint derived from a userId string. */
export function avatarTint(palette: Palette, userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const key = AVATAR_TINT_KEYS[Math.abs(hash) % AVATAR_TINT_KEYS.length];
  return (palette as unknown as Record<string, string>)[key] ?? palette.primary;
}

// ── Swatch ────────────────────────────────────────────────────────────────────

/** Look up a named swatch; falls back to `palette.primary` if absent. */
export function swatch(theme: Theme, name: string): string {
  return theme.swatches[name] ?? theme.colors.primary;
}

// ── Borders ───────────────────────────────────────────────────────────────────

/** Derive a `borderColor` value for a "paper" (elevated surface) border. */
export function paperBorder(palette: Palette): string {
  return palette.borderSubtle;
}

// ── Shadows ───────────────────────────────────────────────────────────────────

/** Build a glow shadow token from a base color (used for focus rings, highlights). */
export function glowShadow(color: string, radius = 8, opacity = 0.4): ShadowToken {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: 4,
  };
}

// Preset sizes mirror the standard sm/md/lg shadow scale so callers can choose
// a size by name rather than specifying raw opacity/radius values. These values
// were chosen to match typical elevation steps in the OctoVault + OctoChat apps.
const DROP_SHADOW_SIZES = {
  sm: { opacity: 0.10, radius: 6,  height: 2,  elevation: 2  },
  md: { opacity: 0.14, radius: 16, height: 6,  elevation: 6  },
  lg: { opacity: 0.20, radius: 28, height: 12, elevation: 14 },
} as const;

/**
 * Build a scheme-aware drop shadow token.
 *
 * Pass the active palette's `shadow` color (e.g. `colors.shadow`) so the
 * tint stays correct in both light and dark modes — warm near-black in light,
 * pure black in dark. Choose `size` to match the surface's elevation.
 *
 * ```ts
 * // In a component that reads the active palette:
 * const { colors } = useOctoSpacesTheme();
 * // …
 * style={[styles.card, dropShadow(colors.shadow, 'md')]}
 * ```
 */
export function dropShadow(shadowColor: string, size: 'sm' | 'md' | 'lg' = 'md'): ShadowToken {
  const s = DROP_SHADOW_SIZES[size];
  return {
    shadowColor,
    shadowOpacity: s.opacity,
    shadowRadius: s.radius,
    shadowOffset: { width: 0, height: s.height },
    elevation: s.elevation,
  };
}

// ── Focus ring ────────────────────────────────────────────────────────────────

/** Style object for a keyboard-focus indicator (web + React Native). */
export function focusRingStyle(
  palette: Palette,
  width = 2,
): {
  borderWidth: number;
  borderColor: string;
  borderStyle: 'solid';
} {
  return { borderWidth: width, borderColor: palette.focus, borderStyle: 'solid' };
}

// ── Status color ──────────────────────────────────────────────────────────────

/** Map a semantic status name to its palette color. */
export function statusColor(
  palette: Palette,
  status: 'success' | 'warning' | 'danger' | 'info' | string,
  muted = false,
): string {
  if (muted) {
    switch (status) {
      case 'success': return palette.successMuted;
      case 'warning': return palette.warningMuted;
      case 'danger':  return palette.dangerMuted;
      default:        return palette.infoMuted;
    }
  }
  switch (status) {
    case 'success': return palette.success;
    case 'warning': return palette.warning;
    case 'danger':  return palette.danger;
    default:        return palette.info;
  }
}
