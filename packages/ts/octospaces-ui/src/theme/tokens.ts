/**
 * `useTokens()` — typed, fallback-safe accessors for numeric theme tokens.
 *
 * Centralises the `(theme.spacing['N'] as number) ?? n` idiom that was copy-
 * pasted across ~42 call sites. Single source of truth for canonical fallback
 * values, which eliminates the `radii['sm']` 4-vs-6 drift that caused
 * inconsistent corner radii between components.
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   const t = useTokens();
 *   return <View style={{ padding: t.sp('2'), borderRadius: t.rad('sm') }} />;
 * }
 * ```
 */
import { useOctoSpacesTheme } from './provider.js';

/**
 * Canonical fallback values used when the host theme does not supply a token.
 * Centralised here so all components default consistently (fixes radii.sm 4 vs 6 drift).
 *
 * These are FALLBACKS only — the host app's `Theme` values always take precedence.
 */
const SPACING_FALLBACKS: Record<string, number> = {
  '0':  0,
  '0.5': 2,
  '1':  4,
  '2':  8,
  '3':  12,
  '4':  16,
  '5':  20,
  '6':  24,
  '8':  32,
  '10': 40,
  '12': 48,
  '16': 64,
};

const RADII_FALLBACKS: Record<string, number> = {
  none:  0,
  xs:    2,
  sm:    4,   // canonical: 4 (was inconsistently 4 or 6 — standardised here)
  md:    6,
  lg:    8,
  xl:    12,
  '2xl': 16,
  '3xl': 24,
  full:  9999,
};

const LAYOUT_FALLBACKS: Record<string, number> = {
  railWidth:    64,
  sidebarWidth: 248,
  headerHeight: 56,
  tabBarHeight: 56,
  modalMaxWidth: 480,
};

const OPACITY_FALLBACKS: Record<string, number> = {
  disabled: 0.5,
  subtle:   0.7,
  muted:    0.4,
};

/**
 * Typed accessor helpers for the active theme's numeric tokens.
 *
 * - `t.sp(key)` — `theme.spacing[key]` with a canonical fallback
 * - `t.rad(key)` — `theme.radii[key]` with a canonical fallback
 * - `t.lay(key)` — `theme.layout[key]` with a canonical fallback
 * - `t.opa(key)` — `theme.opacity[key]` with a canonical fallback
 *
 * All functions accept an optional explicit fallback that overrides the
 * canonical default when you need a non-standard value.
 */
export interface ThemeTokens {
  /** Spacing token: `theme.spacing[key]`. Canonical fallbacks from the 4-step scale. */
  sp: (key: string, fallback?: number) => number;
  /** Border-radius token: `theme.radii[key]`. Canonical: sm=4, md=6, lg=8, xl=12. */
  rad: (key: string, fallback?: number) => number;
  /** Layout constant: `theme.layout[key]`. Canonical: railWidth=64, sidebarWidth=248. */
  lay: (key: string, fallback?: number) => number;
  /** Opacity token: `theme.opacity[key]`. Canonical: disabled=0.5, subtle=0.7. */
  opa: (key: string, fallback?: number) => number;
}

/**
 * Returns typed, fallback-safe accessors for the active theme's numeric tokens.
 * Must be called inside an `<OctoSpacesThemeProvider>`.
 */
export function useTokens(): ThemeTokens {
  const theme = useOctoSpacesTheme();
  return {
    sp:  (key, fallback) => (theme.spacing[key]        as number | undefined) ?? fallback ?? SPACING_FALLBACKS[key] ?? 0,
    rad: (key, fallback) => (theme.radii[key]          as number | undefined) ?? fallback ?? RADII_FALLBACKS[key]   ?? 0,
    lay: (key, fallback) => (theme.layout[key]         as number | undefined) ?? fallback ?? LAYOUT_FALLBACKS[key]  ?? 0,
    opa: (key, fallback) => (theme.opacity[key]        as number | undefined) ?? fallback ?? OPACITY_FALLBACKS[key] ?? 1,
  };
}
