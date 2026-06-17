/**
 * A single row in the Discover list — shows the object's emoji/icon, title,
 * and type. All app-specific behaviour is injected via props:
 *   - `renderIcon`  — render a type/emoji icon; receives the entry and must
 *                     return a ReactNode (null for no icon).
 *   - `onOpen`      — called when the row is pressed.
 *
 * Styled entirely from the injected {@link Theme} via `useOctoSpacesTheme()`.
 */
import React, { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
import type { DiscoverEntry } from './types.js';

export interface DiscoverRowProps {
  entry: DiscoverEntry;
  /** Render a leading icon for the entry. Return `null` to show nothing. */
  renderIcon?: (entry: DiscoverEntry) => React.ReactNode;
  /** Called when the user taps the row. */
  onOpen: (entry: DiscoverEntry) => void;
}

export function DiscoverRow({ entry, renderIcon, onOpen }: DiscoverRowProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();

  const handlePress = useCallback(() => {
    onOpen(entry);
  }, [entry, onOpen]);

  const icon = renderIcon ? renderIcon(entry) : null;
  const displayEmoji = !icon && entry.emoji ? entry.emoji : null;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: t.sp('3'),
        paddingHorizontal: t.sp('4'),
        backgroundColor: pressed
          ? (theme.colors.surface ?? '#f5f5f5')
          : 'transparent',
        borderRadius: t.rad('sm'),
      })}
      accessibilityRole="button"
      accessibilityLabel={entry.title || 'Untitled'}
    >
      {/* Leading icon / emoji */}
      {(icon || displayEmoji) && (
        <View
          style={{
            width: 28,
            height: 28,
            marginRight: t.sp('2'),
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon ?? (
            <Text style={{ fontSize: 18, lineHeight: 24 }}>{displayEmoji}</Text>
          )}
        </View>
      )}

      {/* Title + type subtitle */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: t.type('body').size,
            lineHeight: t.type('body').lineHeight,
            color: entry.title ? theme.colors.text : theme.colors.textTertiary,
            fontFamily: theme.fonts['body'] ?? undefined,
          }}
        >
          {entry.title || 'Untitled'}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontSize: t.type('caption').size,
            lineHeight: t.type('caption').lineHeight,
            color: theme.colors.textSecondary,
            marginTop: 1,
            textTransform: 'capitalize',
          }}
        >
          {entry.type}
        </Text>
      </View>
    </Pressable>
  );
}
