/** @drakkar.software/octospaces-ui — public surface */

// Theme plumbing — inject the host app's resolved Theme via provider, read it via hook.
export { OctoSpacesThemeProvider, useOctoSpacesTheme } from './theme/provider.js';
export type { OctoSpacesThemeProviderProps } from './theme/provider.js';

// Token accessors — typed fallback-safe helpers for numeric theme tokens.
export { useTokens } from './theme/tokens.js';
export type { ThemeTokens } from './theme/tokens.js';

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
  dropShadow,
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

// Sidebar surface — the vertical spaces rail (icon tiles + DM home + add + foot)
// AND the sidebar panel shell + header strip (Sidebar / SidebarHeader / SidebarItem).
// Headless: icons, images, badges and the account foot are injected via props so
// the package stays free of expo-image / @expo/vector-icons / reanimated.
export type { RailSpace, RailIconName, RailSpecialTile } from './sidebar/types.js';
export type { SpacesRailProps } from './sidebar/SpacesRail.js';
export { SpacesRail } from './sidebar/SpacesRail.js';
export type { SidebarProps } from './sidebar/Sidebar.js';
export { Sidebar } from './sidebar/Sidebar.js';
export type { SidebarHeaderProps } from './sidebar/SidebarHeader.js';
export { SidebarHeader } from './sidebar/SidebarHeader.js';
export type { SidebarActionButtonProps } from './sidebar/SidebarActionButton.js';
export { SidebarActionButton } from './sidebar/SidebarActionButton.js';
export type { SidebarItemProps } from './sidebar/SidebarItem.js';
export { SidebarItem } from './sidebar/SidebarItem.js';
export type { SwitcherSpace, SwitcherIconName, SpaceSwitcherProps } from './sidebar/SpaceSwitcher.js';
export { SpaceSwitcher } from './sidebar/SpaceSwitcher.js';

// Lightbox surface — full-screen scrim overlay for media previews.
// Headless: the image and all button chrome are injected by the host app so
// this package stays free of expo-image / @expo/vector-icons / reanimated.
export type { LightboxProps } from './lightbox/Lightbox.js';
export { Lightbox } from './lightbox/Lightbox.js';

// Primitives — headless UI building blocks that read from the injected Theme.
// These are dependency-free (only React Native core) so they work in any RN
// project regardless of Expo version or icon library.
export type { DividerProps } from './primitives/Divider.js';
export { Divider } from './primitives/Divider.js';
export type { BadgeProps, BadgeTone, BadgeSize } from './primitives/Badge.js';
export { Badge } from './primitives/Badge.js';
export type { ToggleProps } from './primitives/Toggle.js';
export { Toggle } from './primitives/Toggle.js';
export type { ToggleRowProps } from './primitives/ToggleRow.js';
export { ToggleRow } from './primitives/ToggleRow.js';

// Calendar surface — pure month-grid math + a headless themed MonthGrid component.
// The math helpers (buildMonthMatrix, bucketEventsByDay, matrixDayKey) are pure
// functions with no RN dependency; MonthGrid is headless, reading only the injected
// Theme via useOctoSpacesTheme().
export type { MatrixDay, WeekRow, MonthMatrix, BuildMonthMatrixOptions } from './calendar/index.js';
export { buildMonthMatrix, matrixDayKey, bucketEventsByDay } from './calendar/index.js';
export type { MonthGridProps } from './calendar/index.js';
export { MonthGrid } from './calendar/index.js';
