/**
 * Headless horizontal rule driven entirely by the injected Theme.
 *
 * ```tsx
 * <Divider />                      // default: subtle borderSubtle line
 * <Divider tone="default" />       // border (lineSoft in OctoChat)
 * <Divider tone="strong" />        // borderStrong (line in OctoChat)
 * <Divider color="#ff0000" />      // explicit override
 * ```
 */
import React from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';

export interface DividerProps {
  /** Token tier to draw from. @default 'subtle' */
  tone?: 'subtle' | 'default' | 'strong';
  /** Explicit color override — wins over `tone`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function Divider({ tone = 'subtle', color, style }: DividerProps) {
  const { colors } = useOctoSpacesTheme();
  const resolvedColor =
    color ??
    (tone === 'strong'
      ? colors.borderStrong
      : tone === 'default'
        ? colors.border
        : colors.borderSubtle);
  return <View style={[{ height: 1, backgroundColor: resolvedColor }, style]} />;
}
