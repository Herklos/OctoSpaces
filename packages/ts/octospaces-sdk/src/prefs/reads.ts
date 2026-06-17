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
  getRoomReadAt: (roomId: string) => number;
  subscribeReads: (listener: () => void) => () => void;
  loadReadMarksFromKv: (userId: string) => Promise<Record<string, number>>;
  hydrateReads: (userId: string, serverPrefs: ReadPrefs) => Promise<void>;
  resetReads: () => void;
  flushReadsNow: () => Promise<void>;
  setRoomReadAt: (session: Session, roomId: string, ts: number) => void;
}

export function createReadsStore(opts: {
  client: (s: Session) => StarfishClient;
  kvNamespace: string;
  logTag: string;
}): ReadsStore {
  const { client, kvNamespace, logTag } = opts;
  const EMPTY: ReadPrefs = { rooms: {} };
  const keyFor = (userId: string) => `${kvNamespace}.reads.${userId}`;
  const legacyKeyFor = (userId: string) => `${kvNamespace}.lastread.${userId}`;

  let cache: ReadPrefs = EMPTY;
  let activeKey: string | null = null;
  let flushSession: Session | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function maxMerge(base: ReadPrefs, over: ReadPrefs): ReadPrefs {
    let rooms: Record<string, number> | null = null;
    for (const [id, ts] of Object.entries(over.rooms)) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if (!(id in base.rooms) || ts > base.rooms[id]) {
        rooms ??= { ...base.rooms };
        rooms[id] = ts;
      }
    }
    return rooms ? { rooms } : base;
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
      const rooms = (parsed && typeof parsed === 'object' && 'rooms' in (parsed as object)
        ? (parsed as { rooms?: unknown }).rooms
        : parsed) as Record<string, unknown> | undefined;
      if (!rooms || typeof rooms !== 'object') return EMPTY;
      const out: Record<string, number> = {};
      for (const [id, v] of Object.entries(rooms)) if (typeof v === 'number' && Number.isFinite(v)) out[id] = v;
      return { rooms: out };
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
    getRoomReadAt: (roomId) => cache.rooms[roomId] ?? 0,
    subscribeReads(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async loadReadMarksFromKv(userId) {
      const [kvReads, legacy] = await Promise.all([loadReadsKv(keyFor(userId)), loadReadsKv(legacyKeyFor(userId))]);
      return maxMerge(kvReads, legacy).rooms;
    },
    async hydrateReads(userId, serverPrefs) {
      activeKey = keyFor(userId);
      let merged = cache;
      if (Object.keys(cache.rooms).length === 0) {
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
    setRoomReadAt(session, roomId, ts) {
      activeKey = keyFor(session.userId);
      flushSession = session;
      if (ts > (cache.rooms[roomId] ?? 0)) {
        emit({ rooms: { ...cache.rooms, [roomId]: ts } });
        persist();
      }
      if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
    },
  };
}
