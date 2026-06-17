/**
 * A themed FlatList wrapper that renders a list of {@link DiscoverEntry} rows.
 *
 * All app-specific behaviour is injected via props so this component has zero
 * imports from any specific OctoSpaces app.
 */
import React, { useCallback } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
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
  /** Whether a pull-to-refresh is currently in progress. */
  refreshing?: boolean;
  /** Called when the user pulls to refresh. */
  onRefresh?: () => void;
}

export function DiscoverList({
  entries,
  renderIcon,
  onOpen,
  emptyMessage = 'No public objects found',
  refreshing,
  onRefresh,
}: DiscoverListProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();

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
          paddingHorizontal: t.sp('6'),
        }}
      >
        <Text
          style={{
            fontSize: t.type('body').size,
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
      contentContainerStyle={{ paddingVertical: t.sp('1') }}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        ) : undefined
      }
    />
  );
}
