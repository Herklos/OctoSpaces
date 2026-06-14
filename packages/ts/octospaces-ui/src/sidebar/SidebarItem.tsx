/**
 * Generic themed sidebar navigation row.
 *
 * The headless analog of `DiscoverRow` for the sidebar panel. Suitable for
 * simple link-style rows (explore, threads, pinned, …). Complex item lists
 * (OctoVault's `ObjectTree`, OctoChat's `RoomCategoryList`) use their own row
 * components — this primitive is for straightforward nav items.
 *
 * Active rows are highlighted with `colors.sidebarActive`. Hovered rows receive
 * a subtle `colors.primarySubtle` wash.
 *
 * ```tsx
 * <SidebarItem
 *   label="Threads"
 *   icon={<Icon name="thread" size={15} color={colors.textSecondary} />}
 *   active={threadsActive}
 *   onPress={onOpenThreads}
 * />
 * ```
 */
import React, { useState } from 'react';
import { Pressable as RNPressable, StyleSheet, Text, View } from 'react-native';
import type { PressableProps, TextStyle, View as RNView } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

type HoverProps = { onMouseEnter?: () => void; onMouseLeave?: () => void };
const Pressable = RNPressable as React.ForwardRefExoticComponent<
  PressableProps & HoverProps & React.RefAttributes<RNView>
>;

export interface SidebarItemProps {
  label: string;
  /** Leading icon element — the host provides the icon component. */
  icon?: React.ReactNode;
  /** Highlight the row as the current destination. */
  active?: boolean;
  /** Badge shown at the trailing edge — a number or short string. */
  badge?: number | string;
  onPress: () => void;
  onLongPress?: () => void;
  /** Additional trailing element (e.g. an action button). */
  trailing?: React.ReactNode;
  /**
   * Left indentation level for nested items. Each level adds 16 px.
   * @default 0
   */
  indent?: number;
}

export function SidebarItem({
  label,
  icon,
  active = false,
  badge,
  onPress,
  onLongPress,
  trailing,
  indent = 0,
}: SidebarItemProps) {
  const theme = useOctoSpacesTheme();
  const { colors, type: typeScale, fonts, spacing, radii } = theme;

  const [hovered, setHovered] = useState(false);

  const sp1 = (spacing['1'] as number | undefined) ?? 4;
  const sp2 = (spacing['2'] as number | undefined) ?? 8;
  const sp3 = (spacing['3'] as number | undefined) ?? 12;
  const radSm = (radii['sm'] as number | undefined) ?? 4;
  const indentPx = indent * 16;

  const bg = active
    ? colors.sidebarActive
    : hovered
      ? (colors.primarySubtle ?? 'rgba(0,0,0,0.04)')
      : 'transparent';

  const textColor = active ? colors.primary : colors.text;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp2,
        paddingVertical: sp1 + 2,
        paddingLeft: sp3 + indentPx,
        paddingRight: sp3,
        borderRadius: radSm,
        backgroundColor: bg,
      }}
    >
      {icon != null ? <View style={styles.iconSlot}>{icon}</View> : null}
      <Text
        style={
          {
            flex: 1,
            fontSize: typeScale['callout']?.size ?? 13,
            lineHeight: typeScale['callout']?.lineHeight ?? 18,
            fontWeight: active ? '600' : '400',
            color: textColor,
            fontFamily: fonts['body'] ?? undefined,
          } as TextStyle
        }
        numberOfLines={1}
      >
        {label}
      </Text>
      {badge != null ? (
        <View
          style={{
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: active ? colors.primary : colors.textTertiary,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: sp1,
          }}
        >
          <Text
            style={
              {
                fontSize: typeScale['micro']?.size ?? 10,
                lineHeight: typeScale['micro']?.lineHeight ?? 14,
                fontWeight: '700',
                color: active ? colors.textOnPrimary : colors.textInverse,
              } as TextStyle
            }
          >
            {String(badge)}
          </Text>
        </View>
      ) : null}
      {trailing != null ? trailing : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconSlot: { width: 18, alignItems: 'center', justifyContent: 'center' },
});
