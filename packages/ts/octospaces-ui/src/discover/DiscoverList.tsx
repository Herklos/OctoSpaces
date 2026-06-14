/**
 * A themed FlatList wrapper that renders a list of {@link DiscoverEntry} rows.
 *
 * All app-specific behaviour is injected via props so this component has zero
 * imports from any specific OctoSpaces app.
 */
import React, { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { DiscoverRow } from './DiscoverRow.js';
import type { DiscoverEntry } from './types.js';

export interface DiscoverListProps {
  entries: DiscoverEntry[];
  /** Render a leading icon for each row — see {@link DiscoverRowProps.renderIcon}. */
  renderIcon?: (entry: DiscoverEntry) => React.ReactNode;
  /** Called when a row is tapped. */
  onOpen: (entry: DiscoverEntry) => void;
  /** Text shown when `entries` is empty (default: "No public objects found"). */
  emptyMessage?: string;
}

export function DiscoverList({
  entries,
  renderIcon,
  onOpen,
  emptyMessage = 'No public objects found',
}: DiscoverListProps) {
  const theme = useOctoSpacesTheme();

  const renderItem = useCallback(
    ({ item }: { item: DiscoverEntry }) => (
      <DiscoverRow entry={item} renderIcon={renderIcon} onOpen={onOpen} />
    ),
    [renderIcon, onOpen],
  );

  const keyExtractor = useCallback(
    (item: DiscoverEntry) => `${item.spaceId}:${item.id}`,
    [],
  );

  if (entries.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: (theme.spacing['6'] as number) ?? 24,
        }}
      >
        <Text
          style={{
            fontSize: theme.type['body']?.size ?? 15,
            color: theme.colors.textSecondary,
            textAlign: 'center',
          }}
        >
          {emptyMessage}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={{ paddingVertical: (theme.spacing['1'] as number) ?? 4 }}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews
    />
  );
}
