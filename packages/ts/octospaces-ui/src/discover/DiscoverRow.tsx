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
        paddingVertical: (theme.spacing['3'] as number) ?? 12,
        paddingHorizontal: (theme.spacing['4'] as number) ?? 16,
        backgroundColor: pressed
          ? (theme.colors.surface ?? '#f5f5f5')
          : 'transparent',
        borderRadius: (theme.radii['sm'] as number) ?? 6,
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
            marginRight: (theme.spacing['2'] as number) ?? 8,
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
            fontSize: (theme.type['body']?.size ?? 15),
            lineHeight: (theme.type['body']?.lineHeight ?? 22),
            color: entry.title ? theme.colors.text : theme.colors.textTertiary,
            fontFamily: theme.fonts['body'] ?? undefined,
          }}
        >
          {entry.title || 'Untitled'}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontSize: (theme.type['caption']?.size ?? 12),
            lineHeight: (theme.type['caption']?.lineHeight ?? 18),
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
