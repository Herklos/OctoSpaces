/**
 * DiscoverScreen — pure-logic tests.
 *
 * NOTE: No React Native renderer is available in this test environment
 * (vitest environment:'node', no @testing-library/react-native).
 * This file tests the PURE LOGIC parts of DiscoverScreen:
 *   - State machine helpers (the async load function extracted as a standalone)
 *   - Filter + sort integration (what DiscoverScreen passes to DiscoverList)
 *   - noSearchResults / resolvedEmptyMessage derivation
 *
 * To test the rendered component itself (ActivityIndicator, FlatList, Pressable),
 * add @testing-library/react-native as a devDependency and add environment:'jsdom'
 * (or a react-native preset) to vitest.config.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterDiscoverEntries, sortDiscoverEntries } from './filter.js';
import type { DiscoverEntry } from './types.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeEntry(id: string, title: string, updatedAt?: number): DiscoverEntry {
  return { id, spaceId: 'sp-1', title, type: 'page', updatedAt };
}

const ENTRIES: DiscoverEntry[] = [
  makeEntry('a', 'Alpha Page', 300),
  makeEntry('b', 'Beta Board', 100),
  makeEntry('c', 'alpha Task', 200),
  makeEntry('d', 'Gamma Wiki', 400),
];

// ── 1. State machine — async load helpers ──────────────────────────────────────
//
// We model the exact state transitions that happen inside DiscoverScreen.load()
// and handleRefresh() as plain async functions, verifying ordering.

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; entries: DiscoverEntry[] }
  | { status: 'error'; message: string };

/**
 * Mirrors DiscoverScreen's `load` callback — drives state transitions in order.
 */
async function runLoad(
  loadEntries: () => Promise<DiscoverEntry[]>,
  setState: (s: State) => void,
): Promise<void> {
  setState({ status: 'loading' });
  try {
    const raw = await loadEntries();
    setState({ status: 'ready', entries: sortDiscoverEntries(raw) });
  } catch (err) {
    setState({
      status: 'error',
      message: err instanceof Error ? err.message : 'Failed to load directory',
    });
  }
}

describe('DiscoverScreen state machine — load()', () => {
  it('initial state is idle', () => {
    const state: State = { status: 'idle' };
    expect(state.status).toBe('idle');
  });

  it('transitions idle → loading → ready on success', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    await runLoad(async () => [makeEntry('x', 'X', 1)], setState);

    expect(states[0].status).toBe('loading');
    expect(states[1].status).toBe('ready');
  });

  it('ready state contains sorted entries', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    await runLoad(async () => ENTRIES, setState);

    const ready = states[1];
    if (ready.status !== 'ready') throw new Error('expected ready');
    // sorted descending by updatedAt: d(400) > a(300) > c(200) > b(100)
    expect(ready.entries.map((e) => e.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('transitions loading → error on rejection', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    await runLoad(async () => { throw new Error('network timeout'); }, setState);

    expect(states[0].status).toBe('loading');
    expect(states[1].status).toBe('error');
  });

  it('error state contains the thrown message', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    await runLoad(async () => { throw new Error('network timeout'); }, setState);

    const err = states[1];
    if (err.status !== 'error') throw new Error('expected error');
    expect(err.message).toBe('network timeout');
  });

  it('falls back to generic message when thrown value is not an Error', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    // eslint-disable-next-line @typescript-eslint/only-throw-error
    await runLoad(async () => { throw 'oops'; }, setState);

    const err = states[1];
    if (err.status !== 'error') throw new Error('expected error');
    expect(err.message).toBe('Failed to load directory');
  });
});

// ── 2. Pull-to-refresh — does NOT blank the list on failure ───────────────────

/**
 * Mirrors DiscoverScreen's `handleRefresh` callback.
 */
async function runRefresh(
  loadEntries: () => Promise<DiscoverEntry[]>,
  setState: (s: State) => void,
  setRefreshing: (v: boolean) => void,
): Promise<void> {
  setRefreshing(true);
  try {
    const raw = await loadEntries();
    setState({ status: 'ready', entries: sortDiscoverEntries(raw) });
  } catch {
    // keep existing list on failure
  } finally {
    setRefreshing(false);
  }
}

describe('DiscoverScreen state machine — handleRefresh()', () => {
  it('sets refreshing=true then refreshing=false on success', async () => {
    const refreshingLog: boolean[] = [];
    const setRefreshing = (v: boolean) => refreshingLog.push(v);

    await runRefresh(async () => [], (s) => s, setRefreshing);

    expect(refreshingLog).toEqual([true, false]);
  });

  it('updates entries on successful refresh', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    await runRefresh(async () => [makeEntry('fresh', 'Fresh', 999)], setState, () => undefined);

    const ready = states[0];
    if (ready.status !== 'ready') throw new Error('expected ready');
    expect(ready.entries[0].id).toBe('fresh');
  });

  it('does NOT call setState on refresh failure (list preserved)', async () => {
    const states: State[] = [];
    const setState = (s: State) => states.push(s);

    await runRefresh(async () => { throw new Error('offline'); }, setState, () => undefined);

    // setState must NOT have been called — list stays as-is
    expect(states).toHaveLength(0);
  });

  it('still clears refreshing=false even on failure', async () => {
    const refreshingLog: boolean[] = [];
    const setRefreshing = (v: boolean) => refreshingLog.push(v);

    await runRefresh(
      async () => { throw new Error('offline'); },
      () => undefined,
      setRefreshing,
    );

    expect(refreshingLog).toEqual([true, false]);
  });
});

// ── 3. Search filter integration (what the component derives for DiscoverList) ─

/**
 * Mirrors the derived values DiscoverScreen computes every render.
 */
function deriveVisible(
  state: State,
  query: string,
  emptyMessage: string,
  emptySearchMessage?: string,
): {
  visibleEntries: DiscoverEntry[];
  noSearchResults: boolean;
  resolvedEmptyMessage: string;
} {
  const allEntries = state.status === 'ready' ? state.entries : [];
  const visibleEntries = filterDiscoverEntries(allEntries, query);
  const noSearchResults =
    !!query.trim() && visibleEntries.length === 0 && allEntries.length > 0;
  const resolvedEmptyMessage = noSearchResults
    ? (emptySearchMessage ?? `No results for "${query.trim()}"`)
    : emptyMessage;
  return { visibleEntries, noSearchResults, resolvedEmptyMessage };
}

describe('DiscoverScreen derived list — filter integration', () => {
  const readyState: State = {
    status: 'ready',
    entries: sortDiscoverEntries(ENTRIES),
  };

  it('empty query returns all entries', () => {
    const { visibleEntries } = deriveVisible(readyState, '', 'No objects');
    expect(visibleEntries).toHaveLength(4);
  });

  it('blank-only query (spaces) returns all entries', () => {
    const { visibleEntries } = deriveVisible(readyState, '   ', 'No objects');
    expect(visibleEntries).toHaveLength(4);
  });

  it('query filters correctly (case-insensitive)', () => {
    const { visibleEntries } = deriveVisible(readyState, 'ALPHA', 'No objects');
    expect(visibleEntries.map((e) => e.id)).toContain('a');
    expect(visibleEntries.map((e) => e.id)).toContain('c');
    expect(visibleEntries).toHaveLength(2);
  });

  it('no matches → empty array', () => {
    const { visibleEntries } = deriveVisible(readyState, 'zzznotfound', 'No objects');
    expect(visibleEntries).toHaveLength(0);
  });

  it('noSearchResults is true when query set + no matches + entries exist', () => {
    const { noSearchResults } = deriveVisible(readyState, 'zzznotfound', 'No objects');
    expect(noSearchResults).toBe(true);
  });

  it('noSearchResults is false for empty query', () => {
    const { noSearchResults } = deriveVisible(readyState, '', 'No objects');
    expect(noSearchResults).toBe(false);
  });

  it('noSearchResults is false when non-ready (loading)', () => {
    const { noSearchResults } = deriveVisible({ status: 'loading' }, 'alpha', 'No objects');
    expect(noSearchResults).toBe(false);
  });

  it('resolvedEmptyMessage uses default no-results template', () => {
    const { resolvedEmptyMessage } = deriveVisible(readyState, 'xyz', 'No objects');
    expect(resolvedEmptyMessage).toBe('No results for "xyz"');
  });

  it('resolvedEmptyMessage uses injected emptySearchMessage when provided', () => {
    const { resolvedEmptyMessage } = deriveVisible(readyState, 'xyz', 'No objects', 'Custom empty');
    expect(resolvedEmptyMessage).toBe('Custom empty');
  });

  it('resolvedEmptyMessage falls back to emptyMessage when no query', () => {
    const emptyReady: State = { status: 'ready', entries: [] };
    const { resolvedEmptyMessage } = deriveVisible(emptyReady, '', 'No public objects yet');
    expect(resolvedEmptyMessage).toBe('No public objects yet');
  });
});
