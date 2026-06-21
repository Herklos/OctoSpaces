/**
 * Factory for per-identity READ MARKS. Returns an isolated store instance with
 * all debounce/flush state in the closure — safe to create one per app or per test.
 *
 * @param client       Extracts the Starfish client for registry doc updates.
 *                     Chat apps pass `s => s.spacesRegistryClient`;
 *                     vault apps pass `s => s.accountClient`.
 * @param kvNamespace  KV key prefix, e.g. `'octochat'` or `'octovault'`.
 *                     Drives `${kvNamespace}.reads.${userId}` and the legacy
 *                     `${kvNamespace}.lastread.${userId}` fold-in.
 * @param logTag       Console tag, e.g. `'[OctoChat]'`.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { ReadPrefs } from '../core/types.js';
import { kvGet, kvSet } from '../core/adapters.js';
import { updateReadsDoc } from '../spaces/registry.js';
import type { Session } from '../sync/identity.js';

const FLUSH_DELAY_MS = 8_000;

export interface ReadsStore {
  getReadPrefs: () => ReadPrefs;
  getNodeReadAt: (nodeId: string) => number;
  subscribeReads: (listener: () => void) => () => void;
  loadReadMarksFromKv: (userId: string) => Promise<Record<string, number>>;
  hydrateReads: (userId: string, serverPrefs: ReadPrefs) => Promise<void>;
  resetReads: () => void;
  flushReadsNow: () => Promise<void>;
  setNodeReadAt: (session: Session, nodeId: string, ts: number) => void;
}

export function createReadsStore(opts: {
  client: (s: Session) => StarfishClient;
  kvNamespace: string;
  logTag: string;
}): ReadsStore {
  const { client, kvNamespace, logTag } = opts;
  const EMPTY: ReadPrefs = { nodes: {} };
  const keyFor = (userId: string) => `${kvNamespace}.reads.${userId}`;
  const legacyKeyFor = (userId: string) => `${kvNamespace}.lastread.${userId}`;

  let cache: ReadPrefs = EMPTY;
  let activeKey: string | null = null;
  let flushSession: Session | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function maxMerge(base: ReadPrefs, over: ReadPrefs): ReadPrefs {
    let nodes: Record<string, number> | null = null;
    for (const [id, ts] of Object.entries(over.nodes)) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if (!(id in base.nodes) || ts > base.nodes[id]) {
        nodes ??= { ...base.nodes };
        nodes[id] = ts;
      }
    }
    return nodes ? { nodes } : base;
  }

  function emit(next: ReadPrefs): void {
    cache = next;
    for (const l of listeners) l();
  }

  function persist(): void {
    if (activeKey) void kvSet(activeKey, JSON.stringify(cache)).catch(() => {});
  }

  async function loadReadsKv(key: string): Promise<ReadPrefs> {
    const raw = await kvGet(key);
    if (!raw) return EMPTY;
    try {
      const parsed = JSON.parse(raw) as unknown;
      // Back-compat: pre-0.16 docs keyed marks under `rooms`; bare maps stay supported.
      const p = parsed as { nodes?: unknown; rooms?: unknown } | undefined;
      const marks = (p && typeof p === 'object' && ('nodes' in p || 'rooms' in p)
        ? p.nodes ?? p.rooms
        : parsed) as Record<string, unknown> | undefined;
      if (!marks || typeof marks !== 'object') return EMPTY;
      const out: Record<string, number> = {};
      for (const [id, v] of Object.entries(marks)) if (typeof v === 'number' && Number.isFinite(v)) out[id] = v;
      return { nodes: out };
    } catch {
      return EMPTY;
    }
  }

  async function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const session = flushSession;
    if (!session) return;
    const snapshot = cache;
    await updateReadsDoc(client(session), session.userId, (cur) => {
      const merged = maxMerge(cur, snapshot);
      return merged === cur ? null : merged;
    }).catch((err) => {
      console.error(`${logTag} reads: failed to sync read marks`, err);
    });
  }

  return {
    getReadPrefs: () => cache,
    getNodeReadAt: (nodeId) => cache.nodes[nodeId] ?? 0,
    subscribeReads(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async loadReadMarksFromKv(userId) {
      const [kvReads, legacy] = await Promise.all([loadReadsKv(keyFor(userId)), loadReadsKv(legacyKeyFor(userId))]);
      return maxMerge(kvReads, legacy).nodes;
    },
    async hydrateReads(userId, serverPrefs) {
      activeKey = keyFor(userId);
      let merged = cache;
      if (Object.keys(cache.nodes).length === 0) {
        const [kvReads, legacy] = await Promise.all([loadReadsKv(keyFor(userId)), loadReadsKv(legacyKeyFor(userId))]);
        merged = maxMerge(merged, kvReads);
        merged = maxMerge(merged, legacy);
      }
      merged = maxMerge(merged, serverPrefs);
      if (merged === cache) return;
      emit(merged);
      await kvSet(activeKey, JSON.stringify(merged));
    },
    resetReads() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      activeKey = null;
      flushSession = null;
      emit(EMPTY);
    },
    flushReadsNow: () => flush(),
    setNodeReadAt(session, nodeId, ts) {
      activeKey = keyFor(session.userId);
      flushSession = session;
      if (ts > (cache.nodes[nodeId] ?? 0)) {
        emit({ nodes: { ...cache.nodes, [nodeId]: ts } });
        persist();
      }
      if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
    },
  };
}
