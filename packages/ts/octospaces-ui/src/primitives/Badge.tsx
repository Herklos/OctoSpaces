/**
 * Headless count / dot badge driven by the injected Theme.
 *
 * ```tsx
 * <Badge count={3} />                    // accent pill with count
 * <Badge count={0} dot />               // dot-only presence indicator
 * <Badge count={12} tone="danger" />    // danger-colored count
 * <Badge count={5} tone="neutral" />    // muted neutral count
 * ```
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { TextStyle } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';

export type BadgeTone = 'accent' | 'danger' | 'neutral';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  /** Numeric count to display. A value of 0 hides the badge (unless `dot` is set). */
  count?: number;
  /** Clamp display at 99+. @default true */
  clamp?: boolean;
  /** Render as a dot with no text (e.g. a "new" presence indicator). */
  dot?: boolean;
  /** Color scheme for the badge. @default 'accent' */
  tone?: BadgeTone;
  /** Visual size tier. @default 'sm' */
  size?: BadgeSize;
}

export function Badge({ count = 0, clamp = true, dot = false, tone = 'accent', size = 'sm' }: BadgeProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();
  const { colors } = theme;

  if (!dot && count <= 0) return null;

  const bg =
    tone === 'danger'
      ? colors.danger
      : tone === 'neutral'
        ? colors.textSecondary
        : colors.primary;

  const fg = tone === 'neutral' ? colors.textInverse : colors.textOnPrimary;

  const sp1 = t.sp('1');
  const radFull = t.rad('full');

  if (dot) {
    const dotSize = size === 'md' ? 10 : 8;
    return (
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: bg,
        }}
      />
    );
  }

  const h = size === 'md' ? 20 : 17;
  const minW = h;
  const px = size === 'md' ? sp1 + 2 : sp1;
  const typeKey = size === 'md' ? 'footnote' : 'caption';
  const fontSize = (theme.type[typeKey]?.size as number | undefined) ?? (size === 'md' ? 12 : 11);
  const lineH = (theme.type[typeKey]?.lineHeight as number | undefined) ?? (size === 'md' ? 16 : 14);

  const label = clamp && count > 99 ? '99+' : String(count);

  return (
    <View
      style={{
        minWidth: minW,
        height: h,
        borderRadius: radFull,
        paddingHorizontal: px,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={
          {
            fontSize,
            lineHeight: lineH,
            fontWeight: '700',
            color: fg,
            fontFamily: theme.fonts['mono'] ?? undefined,
            includeFontPadding: false,
          } as TextStyle
        }
      >
        {label}
      </Text>
    </View>
  );
}

