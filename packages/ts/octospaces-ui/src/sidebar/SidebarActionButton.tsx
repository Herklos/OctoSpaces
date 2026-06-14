/**
 * Headless themed icon-button primitive for sidebar action slots.
 *
 * Renders a square `Pressable` with hover/press wash from the injected theme.
 * The icon is provided by the host app as a `ReactNode` — this keeps the package
 * free of `@expo/vector-icons`, `Tooltip`, and keyboard-shortcut concerns.
 *
 * Host apps with richer icon buttons (OctoVault's `IconButton` has tooltips,
 * keyboard-shortcut labels, and haptics) can slot those directly into
 * `SidebarHeader.actions` instead — this primitive is for simpler headless
 * consumers.
 *
 * ```tsx
 * <SidebarActionButton
 *   icon={<Icon name="search" size={15} color={theme.colors.textSecondary} />}
 *   onPress={openSearch}
 *   accessibilityLabel="Search"
 * />
 * ```
 */
import React, { useState } from 'react';
import { Pressable as RNPressable } from 'react-native';
import type { PressableProps, View as RNView } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

// React Native Web supports onMouseEnter/onMouseLeave.
type HoverProps = { onMouseEnter?: () => void; onMouseLeave?: () => void };
const Pressable = RNPressable as React.ForwardRefExoticComponent<
  PressableProps & HoverProps & React.RefAttributes<RNView>
>;

export interface SidebarActionButtonProps {
  /** Icon element to render — the host provides the icon component, size, and color. */
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  /**
   * Width and height of the pressable target in pixels.
   * @default 32
   */
  size?: number;
}

export function SidebarActionButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 32,
}: SidebarActionButtonProps) {
  const theme = useOctoSpacesTheme();
  const { colors, radii } = theme;

  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const bg = pressed
    ? (colors.primaryMuted ?? 'rgba(0,0,0,0.10)')
    : hovered
      ? (colors.primarySubtle ?? 'rgba(0,0,0,0.05)')
      : 'transparent';

  const radius = (radii['sm'] as number | undefined) ?? 4;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius,
        backgroundColor: bg,
      }}
    >
      {icon}
    </Pressable>
  );
}
