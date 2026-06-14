/**
 * Headless themed sidebar panel shell.
 *
 * Renders the 240–248px wide panel: a background surface (colors.sidebarPanel),
 * a right border (colors.border), an optional header slot, the item list
 * (scrollable by default), and an optional footer slot.
 *
 * All content is delegated to the host via slots — only the chrome (bg, border,
 * width) and the ScrollView wrapper are shared.
 *
 * ```tsx
 * <Sidebar
 *   header={
 *     <SidebarHeader
 *       leading={<SpaceSwitcher variant="sidebar" />}
 *       actions={<>
 *         <IconButton name="search" ... />
 *         <IconButton name="plus" ... />
 *       </>}
 *     />
 *   }
 *   contentContainerStyle={{ paddingHorizontal: 8 }}
 * >
 *   <WorkObjects ... />
 * </Sidebar>
 * ```
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

export interface SidebarProps {
  /** Header slot — render a {@link SidebarHeader} or custom content above the list. */
  header?: React.ReactNode;
  /** Footer slot — pinned below the scroll area. */
  footer?: React.ReactNode;
  /** The item list. Wrapped in a ScrollView unless `scrollable` is `false`. */
  children: React.ReactNode;
  /** Panel width in pixels. Defaults to `theme.layout.sidebarWidth ?? 248`. */
  width?: number;
  /**
   * When `false`, children are rendered in a plain `View` instead of a `ScrollView`.
   * Use when the host manages its own scroll (e.g. multiple independent lists).
   * @default true
   */
  scrollable?: boolean;
  /**
   * Passed to the `ScrollView`'s `contentContainerStyle` (or to the body `View`
   * style when `scrollable` is `false`).
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Override the panel background color.
   * Defaults to `colors.sidebarPanel` from the injected theme.
   */
  background?: string;
}

export function Sidebar({
  header,
  footer,
  children,
  width,
  scrollable = true,
  contentContainerStyle,
  background,
}: SidebarProps) {
  const theme = useOctoSpacesTheme();
  const { colors, layout } = theme;

  const panelWidth = width ?? (layout['sidebarWidth'] as number | undefined) ?? 248;
  const bg = background ?? colors.sidebarPanel;

  return (
    <View
      style={{
        width: panelWidth,
        backgroundColor: bg,
        borderRightWidth: 1,
        borderRightColor: colors.border,
        flexDirection: 'column',
      }}
    >
      {header ?? null}
      {scrollable ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={contentContainerStyle ?? undefined}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentContainerStyle]}>{children}</View>
      )}
      {footer ?? null}
    </View>
  );
}
