/** @drakkar.software/octospaces-ui — public surface */

// Theme plumbing — inject the host app's resolved Theme via provider, read it via hook.
export { OctoSpacesThemeProvider, useOctoSpacesTheme } from './theme/provider.js';
export type { OctoSpacesThemeProviderProps } from './theme/provider.js';

// Theme types — host apps use these to type their resolved Theme object.
export type {
  ColorScheme,
  Palette,
  Theme,
  Spacing,
  Radii,
  TypeScale,
  Typography,
  Fonts,
  Easing,
  MotionToken,
  Motion,
  ShadowToken,
  Shadows,
  Layout,
  Opacity,
  Swatches,
  Layers,
  LabelTracking,
} from './theme/types.js';

// Pure palette helpers — import and call with a Palette (or Theme) from useOctoSpacesTheme().
export {
  presenceColor,
  verificationColor,
  avatarTint,
  swatch,
  paperBorder,
  glowShadow,
  focusRingStyle,
  statusColor,
} from './theme/helpers.js';

// Discover surface — generic themed components for browsing public-object directories.
// Components are headless: they read the injected Theme via useOctoSpacesTheme() and
// delegate all app-specific behaviour (icon rendering, navigation) to props.
export type { DiscoverEntry } from './discover/types.js';
export { filterDiscoverEntries, sortDiscoverEntries } from './discover/filter.js';
export type { DiscoverRowProps } from './discover/DiscoverRow.js';
export { DiscoverRow } from './discover/DiscoverRow.js';
export type { DiscoverListProps } from './discover/DiscoverList.js';
export { DiscoverList } from './discover/DiscoverList.js';
export type { DiscoverScreenProps } from './discover/DiscoverScreen.js';
export { DiscoverScreen } from './discover/DiscoverScreen.js';
