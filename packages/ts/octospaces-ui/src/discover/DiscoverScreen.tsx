/**
 * Generic public-object discovery screen.
 *
 * Loads the world-readable public-object directory via `loadEntries`, renders a
 * search bar, and delegates row rendering + tap behaviour to the injected props.
 * No app-specific logic lives here — all customisation is via props:
 *
 * ```tsx
 * <DiscoverScreen
 *   loadEntries={readObjectDirectory}
 *   renderIcon={(e) => <TypeIcon entry={e} />}
 *   onOpen={(e) => router.push({ pathname: routeForNode(e), params: { id: e.id, spaceId: e.spaceId } })}
 * />
 * ```
 *
 * State machine:
 *   idle → loading → (ready | error)
 *   Any pull of `loadEntries` updates the entries; errors show a retry button.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextStyle } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
import { DiscoverList } from './DiscoverList.js';
import { filterDiscoverEntries, sortDiscoverEntries } from './filter.js';
import type { DiscoverEntry } from './types.js';

export interface DiscoverScreenProps {
  /**
   * Async function that resolves to the current public-object directory.
   * Typically `readObjectDirectory` from `@drakkar.software/octospaces-sdk`.
   * Called on mount and when `refresh()` is triggered.
   */
  loadEntries: () => Promise<DiscoverEntry[]>;
  /** Render a leading icon for each row. */
  renderIcon?: (entry: DiscoverEntry) => React.ReactNode;
  /** Called when the user taps a row — navigate to the object. */
  onOpen: (entry: DiscoverEntry) => void;
  /**
   * Optional heading text shown above the search bar.
   * @default "Discover"
   */
  title?: string;
  /**
   * Text shown when the directory is empty after loading.
   * @default "No public objects yet"
   */
  emptyMessage?: string;
  /**
   * Text shown when the directory is empty due to an active search query.
   * @default "No results for «query»"
   */
  emptySearchMessage?: string;
  /**
   * Whether to show the inline search bar.
   * @default true
   */
  searchEnabled?: boolean;
  /**
   * Optional ref whose `.current` is set to a `reload()` function once mounted.
   * Lets a host (e.g. a tab screen) trigger a soft-refresh on focus without
   * blanking the existing list — identical to pull-to-refresh behaviour.
   *
   * ```tsx
   * const reloadRef = useRef<() => void>(null);
   * useFocusEffect(useCallback(() => { reloadRef.current?.(); }, []));
   * <DiscoverScreen reloadRef={reloadRef} ... />
   * ```
   */
  reloadRef?: React.RefObject<(() => void) | null>;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; entries: DiscoverEntry[] }
  | { status: 'error'; message: string };

/** Stable empty reference for non-ready states so the filter memo doesn't recompute. */
const EMPTY_ENTRIES: DiscoverEntry[] = [];

export function DiscoverScreen({
  loadEntries,
  renderIcon,
  onOpen,
  title = 'Discover',
  emptyMessage = 'No public objects yet',
  emptySearchMessage,
  searchEnabled = true,
  reloadRef,
}: DiscoverScreenProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const raw = await loadEntries();
      if (cancelledRef.current) return;
      setState({ status: 'ready', entries: sortDiscoverEntries(raw) });
    } catch (err) {
      if (cancelledRef.current) return;
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to load directory',
      });
    }
  }, [loadEntries]);

  /** Pull-to-refresh: re-fetches without blanking the existing list. */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const raw = await loadEntries();
      if (cancelledRef.current) return;
      setState({ status: 'ready', entries: sortDiscoverEntries(raw) });
    } catch {
      // keep the existing list on refresh failure; the retry button remains for error state
    } finally {
      if (!cancelledRef.current) setRefreshing(false);
    }
  }, [loadEntries]);

  // Expose handleRefresh via reloadRef so a host can trigger a soft reload on focus.
  // useEffect is used instead of useImperativeHandle because reloadRef is a plain prop
  // ref (not forwarded via forwardRef), and RefObject.current is readonly in React 18 types.
  useEffect(() => {
    if (!reloadRef) return;
    (reloadRef as React.MutableRefObject<(() => void) | null>).current = handleRefresh;
    return () => {
      (reloadRef as React.MutableRefObject<(() => void) | null>).current = null;
    };
  }, [reloadRef, handleRefresh]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  // ── Derived list ─────────────────────────────────────────────────────────
  const allEntries = state.status === 'ready' ? state.entries : EMPTY_ENTRIES;
  const visibleEntries = useMemo(() => filterDiscoverEntries(allEntries, query), [allEntries, query]);
  const noSearchResults = !!query.trim() && visibleEntries.length === 0 && allEntries.length > 0;
  const resolvedEmptyMessage = noSearchResults
    ? (emptySearchMessage ?? `No results for "${query.trim()}"`)
    : emptyMessage;

  // ── Palette shortcuts ─────────────────────────────────────────────────────
  const sp2 = t.sp('2');
  const sp3 = t.sp('3');
  const sp4 = t.sp('4');
  const radMd = t.rad('md');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: sp4,
          paddingTop: sp4,
          paddingBottom: sp2,
        }}
      >
        <Text
          style={{
            fontSize: t.type('title2').size,
            fontWeight: t.type('title2').weight as TextStyle['fontWeight'],
            lineHeight: t.type('title2').lineHeight,
            color: theme.colors.text,
            fontFamily: theme.fonts['heading'] ?? undefined,
            marginBottom: sp3,
          }}
        >
          {title}
        </Text>

        {/* Search bar */}
        {searchEnabled && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: theme.colors.surfaceInput ?? theme.colors.surface,
              borderRadius: radMd,
              borderWidth: 1,
              borderColor: theme.colors.borderSubtle,
              paddingHorizontal: sp3,
              height: 40,
            }}
          >
            <TextInput
              placeholder="Search…"
              placeholderTextColor={theme.colors.textTertiary}
              value={query}
              onChangeText={setQuery}
              style={{
                flex: 1,
                fontSize: t.type('body').size,
                color: theme.colors.text,
                fontFamily: theme.fonts['body'] ?? undefined,
              }}
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search discover"
            />
          </View>
        )}
      </View>

      {/* Body */}
      {state.status === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : state.status === 'error' ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: sp4,
          }}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: t.type('body').size,
              textAlign: 'center',
              marginBottom: sp3,
            }}
          >
            {state.message}
          </Text>
          <Pressable
            onPress={load}
            style={{
              paddingHorizontal: sp4,
              paddingVertical: sp2,
              backgroundColor: theme.colors.primary,
              borderRadius: radMd,
            }}
          >
            <Text style={{ color: theme.colors.textOnPrimary, fontWeight: '600' }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <DiscoverList
          entries={visibleEntries}
          renderIcon={renderIcon}
          onOpen={onOpen}
          emptyMessage={resolvedEmptyMessage}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}
    </View>
  );
}
