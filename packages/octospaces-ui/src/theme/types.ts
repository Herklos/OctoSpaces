/**
 * Theme contract for `@drakkar.software/octospaces-ui`.
 *
 * The package ships NO theme VALUES — only these type definitions. The host app
 * constructs a concrete {@link Theme} object (with its own palette, tokens, and
 * scheme logic) and passes it to `<OctoSpacesThemeProvider theme={…}>` at the root.
 *
 * The {@link Palette} interface is the SUPERSET of OctoChat + OctoVault so the UI
 * primitives work correctly in both apps. Apps that don't use vault-specific keys
 * (like `editorCanvas`) can safely set them to a sensible default.
 */

/** The active color scheme. Passed as part of `Theme.scheme`. */
export type ColorScheme = 'light' | 'dark';

/**
 * Full color palette contract. OctoVault's palette is the superset. OctoChat apps
 * add `editorCanvas`, `tooltipBg`, `onTooltip` as they migrate to the shared UI.
 *
 * All colors are CSS/RN color strings (hex, rgba, or named color tokens).
 */
export interface Palette {
  // ── Background layers ─────────────────────────────────────────────────────
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceModal: string;
  surfaceInput: string;
  sidebar: string;
  sidebarActive: string;

  // ── Borders + dividers ────────────────────────────────────────────────────
  border: string;
  borderSubtle: string;
  borderStrong: string;

  // ── Text ─────────────────────────────────────────────────────────────────
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  textInverse: string;
  textOnPrimary: string;

  // ── Brand + interactive ───────────────────────────────────────────────────
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  primarySubtle: string;

  // ── Semantic ──────────────────────────────────────────────────────────────
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  info: string;
  infoMuted: string;

  // ── Presence + verification ───────────────────────────────────────────────
  presenceOnline: string;
  presenceAway: string;
  presenceBusy: string;
  presenceOffline: string;

  verificationVerified: string;
  verificationPartial: string;
  verificationNone: string;

  // ── Misc ──────────────────────────────────────────────────────────────────
  overlay: string;
  shadow: string;
  focus: string;
  skeleton: string;
  skeletonShimmer: string;

  // ── Vault-specific extras (superset) ─────────────────────────────────────
  editorCanvas: string;
  tooltipBg: string;
  onTooltip: string;
}

/**
 * Static spacing scale. Host app provides an object with numeric pixel values
 * keyed by token name. E.g. `{ '0': 0, '1': 4, '2': 8, '3': 12, '4': 16, … }`.
 */
export type Spacing = Record<string, number>;

/**
 * Border-radius scale.
 */
export type Radii = Record<string, number | string>;

/**
 * Typography scale: font sizes, line heights, weights — keyed by variant name.
 */
export interface TypeScale {
  size: number;
  lineHeight: number;
  weight?: string | number;
  letterSpacing?: number;
}
export type Typography = Record<string, TypeScale>;

/**
 * Font family config. Keys are semantic names; values are font-family strings.
 */
export type Fonts = Record<string, string>;

/** Easing curve definitions (e.g. for Reanimated `withTiming`). */
export type Easing = Record<string, number[]>;

/**
 * Motion token: duration + easing pairs keyed by animation name.
 */
export interface MotionToken {
  duration: number;
  easing?: number[];
}
export type Motion = Record<string, MotionToken>;

/** Shadow / elevation definitions. */
export interface ShadowToken {
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
}
export type Shadows = Record<string, ShadowToken>;

/** Layout constants (screen margins, nav heights, etc.). */
export type Layout = Record<string, number>;

/** Opacity scale. */
export type Opacity = Record<string, number>;

/** Named color swatches (beyond the palette — brand accents, label colors). */
export type Swatches = Record<string, string>;

/** z-index layers. */
export type Layers = Record<string, number>;

/** Letter-spacing presets keyed by variant name. */
export type LabelTracking = Record<string, number>;

/**
 * The complete Theme object the host app constructs and injects.
 * All primitives in this package read ONLY from this injected Theme.
 */
export interface Theme {
  scheme: ColorScheme;
  colors: Palette;
  spacing: Spacing;
  radii: Radii;
  type: Typography;
  fonts: Fonts;
  motion: Motion;
  shadows: Shadows;
  layout: Layout;
  opacity: Opacity;
  swatches: Swatches;
  layers: Layers;
  easing: Easing;
  labelTracking: LabelTracking;
}
