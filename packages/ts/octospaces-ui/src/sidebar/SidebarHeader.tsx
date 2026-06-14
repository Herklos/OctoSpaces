/**
 * Headless themed sidebar header strip.
 *
 * Row 1: a `leading` slot (flex:1, typically a space selector or name) + an
 * optional `actions` row (right-aligned command buttons). An optional `extra`
 * slot below row 1 accepts additional controls (OctoChat uses this for its
 * `ModeSwitcher` + jump-to search bar). An optional bottom hairline divider.
 *
 * ```tsx
 * // OctoVault — space switcher + command icons
 * <SidebarHeader
 *   leading={<SpaceSwitcher variant="sidebar" />}
 *   actions={<>
 *     <IconButton name="search" onPress={openSearch} tooltip="Search" shortcut="⌘K" />
 *     <IconButton name="plus"   onPress={newPage}    tooltip="New page" shortcut="⌘N" />
 *     <IconButton name="sidebar" onPress={collapse}  tooltip="Hide sidebar" shortcut="⌘\\" />
 *   </>}
 * />
 *
 * // OctoChat — space menu + mode switcher + jump-to bar
 * <SidebarHeader
 *   leading={<Pressable onPress={onOpenSpaceMenu}>…</Pressable>}
 *   extra={<><ModeSwitcher /><JumpToBar /></>}
 *   divider
 * />
 * ```
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

export interface SidebarHeaderProps {
  /** Leading content (flex:1) — typically the space selector / space name. */
  leading: React.ReactNode;
  /**
   * Right-aligned action buttons row.
   * OctoVault passes its own `IconButton` components here (with tooltips +
   * keyboard shortcuts). For simpler headless consumers use `SidebarActionButton`.
   */
  actions?: React.ReactNode;
  /**
   * Extra slot rendered below the leading+actions row.
   * Use for secondary controls like a mode switcher or a search bar.
   */
  extra?: React.ReactNode;
  /**
   * Render a hairline bottom divider in `colors.borderSubtle`.
   * @default false
   */
  divider?: boolean;
  /**
   * Style applied to the outer container. Use to set host-specific padding,
   * gap, background override, etc.
   */
  style?: StyleProp<ViewStyle>;
}

export function SidebarHeader({
  leading,
  actions,
  extra,
  divider = false,
  style,
}: SidebarHeaderProps) {
  const theme = useOctoSpacesTheme();
  const { colors } = theme;

  return (
    <View
      style={[
        styles.root,
        style,
        divider
          ? {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.borderSubtle,
            }
          : undefined,
      ]}
    >
      {/* Row 1: leading + actions */}
      <View style={styles.row}>
        <View style={styles.leading}>{leading}</View>
        {actions != null ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {/* Extra slot (ModeSwitcher, jump-to bar, etc.) */}
      {extra != null ? <View>{extra}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leading: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
});
