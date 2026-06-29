/**
 * Regression tests for createReadsStore — focuses on the crash where
 * maxMerge received a malformed server-side `reads` object (missing `.nodes`)
 * and threw: TypeError: Cannot use 'in' operator to search for '…' in undefined.
 *
 * Two entry-points that reach maxMerge are exercised:
 *  1. flushReadsNow() — the async Starfish CAS path
 *  2. hydrateReads()  — the boot-time hydration path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReadPrefs } from '../../src/core/types.js';

// vi.mock is hoisted before all imports by vitest — the mock is in place when
// reads.ts and adapters.ts import from @drakkar.software/starfish-spaces.
vi.mock('@drakkar.software/starfish-spaces', () => ({
  configureSpaces: vi.fn(),
  configureSpaceAccessStore: vi.fn(),
  updateSpacesExtraField: vi.fn(),
}));

import { createReadsStore } from '../../src/prefs/reads.js';
import { configureKv } from '../../src/core/adapters.js';
import { updateSpacesExtraField } from '@drakkar.software/starfish-spaces';

const mockUpdateFn = vi.mocked(updateSpacesExtraField);

// Minimal session stub — only userId is accessed by the store internals.
const SESSION = { userId: 'u1' } as any;

/** Fresh in-memory KV + isolated store instance for each test. */
function setup() {
  const mem = new Map<string, string>();
  configureKv({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => { mem.set(k, v); },
    remove: async (k) => { mem.delete(k); },
  });
  return createReadsStore({
    client: () => ({} as any),
    kvNamespace: 'test',
    logTag: '[Test]',
  });
}

// ── flush path — crash regression ────────────────────────────────────────────────
//
// In flush(), the server value `doc.extra['reads']` is passed as `cur` to the
// mutator.  The guard `cur ?? EMPTY` only substitutes EMPTY for null/undefined —
// a non-null object lacking `.nodes` went straight into maxMerge, causing the
// crash.  The mock simulates this by calling the mutator with each malformed shape.

describe('reads store — flush path with malformed server state', () => {
  beforeEach(() => { mockUpdateFn.mockReset(); });

  const malformedShapes: [string, unknown][] = [
    ['legacy {rooms:…} shape', { rooms: { 'dm-test-dm': 1000 } }],
    ['empty object {}', {}],
    ['bare map (no nodes key)', { 'dm-test-dm': 1000 }],
  ];

  for (const [label, cur] of malformedShapes) {
    it(`does not throw and does not log an error when server returns ${label}`, async () => {
      const store = setup();

      // Prime the cache so the snapshot is non-empty (triggers actual merge)
      store.setNodeReadAt(SESSION, 'dm-test-dm', 1_700_000_000_000);

      // Simulate updateSpacesExtraField calling the mutator with the malformed cur
      mockUpdateFn.mockImplementationOnce(async (_c, _s, _k, mutator) => {
        (mutator as (c: unknown) => unknown)(cur);
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await store.flushReadsNow();
        expect(consoleSpy).not.toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
        store.resetReads(); // cancel the debounced flush timer
      }
    });
  }
});

// ── hydrateReads — crash regression ──────────────────────────────────────────────
//
// hydrateReads() passes `serverPrefs` directly as `over` to maxMerge.
// If serverPrefs.nodes is missing, Object.entries(over.nodes) throws before the
// 'in' check is even reached.

describe('reads store — hydrateReads with malformed serverPrefs', () => {
  it('does not throw when serverPrefs has legacy {rooms:…} shape', async () => {
    const store = setup();
    await expect(
      store.hydrateReads('u1', { rooms: { 'r1': 1 } } as unknown as ReadPrefs),
    ).resolves.toBeUndefined();
  });

  it('does not throw when serverPrefs has no nodes key ({})', async () => {
    const store = setup();
    await expect(
      store.hydrateReads('u1', {} as unknown as ReadPrefs),
    ).resolves.toBeUndefined();
  });

  it('does not throw when serverPrefs is a bare map', async () => {
    const store = setup();
    await expect(
      store.hydrateReads('u1', { 'r1': 1 } as unknown as ReadPrefs),
    ).resolves.toBeUndefined();
  });
});

// ── merge correctness — happy path ───────────────────────────────────────────────

describe('reads store — merge correctness', () => {
  it('getNodeReadAt returns the max timestamp after hydration', async () => {
    const store = setup();
    await store.hydrateReads('u1', { nodes: { 'room-a': 1000 } });
    await store.hydrateReads('u1', { nodes: { 'room-a': 2000, 'room-b': 500 } });
    expect(store.getNodeReadAt('room-a')).toBe(2000);
    expect(store.getNodeReadAt('room-b')).toBe(500);
  });

  it('getNodeReadAt returns 0 for unknown nodes', () => {
    const store = setup();
    expect(store.getNodeReadAt('nonexistent')).toBe(0);
  });

  it('local setNodeReadAt win does not get downgraded by older server hydration', async () => {
    const store = setup();
    store.setNodeReadAt(SESSION, 'room-a', 3000);
    store.resetReads(); // cancel timer; keep cache via the test store isolation
    // Re-create to test via hydrateReads independently
    const store2 = setup();
    store2.setNodeReadAt(SESSION, 'room-a', 3000);
    await store2.hydrateReads('u1', { nodes: { 'room-a': 1000 } });
    expect(store2.getNodeReadAt('room-a')).toBe(3000);
    store2.resetReads();
  });
});
