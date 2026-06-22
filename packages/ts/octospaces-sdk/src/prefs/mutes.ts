/**
 * Factory for per-identity MUTE preferences. Returns an isolated store instance
 * (per-instance closure state — safe to create one per app or per test).
 *
 * @param client     Extracts the Starfish client used for registry doc updates.
 *                   Chat apps pass `s => s.spacesRegistryClient`;
 *                   vault apps pass `s => s.accountClient`.
 * @param kvNamespace KV key prefix, e.g. `'octochat'` or `'octovault'`.
 *                   Drives `${kvNamespace}.mutes.${userId}` — must match the
 *                   existing on-disk prefix or the cache is orphaned.
 * @param logTag     Console tag for error messages, e.g. `'[OctoChat]'`.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { Session } from '@drakkar.software/starfish-spaces';
import { updateSpacesExtraField } from '@drakkar.software/starfish-spaces';

import type { MutePrefs, MuteValue } from '../core/types.js';
import { kvGet, kvSet } from '../core/adapters.js';

/** A mute is active when set to `true` (forever) or to a future epoch-ms instant. */
export function isMuteActive(v: MuteValue | undefined): boolean {
  return v === true || (typeof v === 'number' && v > Date.now());
}

export interface MutesStore {
  isMuteActive: (v: MuteValue | undefined) => boolean;
  getMutePrefs: () => MutePrefs;
  isNodeMuted: (nodeId: string) => boolean;
  isSpaceMuted: (spaceId: string) => boolean;
  isMuted: (nodeId: string, spaceId: string) => boolean;
  subscribeMutes: (listener: () => void) => () => void;
  hydrateMutes: (userId: string, serverPrefs: MutePrefs) => Promise<void>;
  resetMutes: () => void;
  loadMutesFromKv: (userId: string) => Promise<MutePrefs>;
  setNodeMute: (session: Session, nodeId: string, muted: boolean) => Promise<void>;
  setSpaceMute: (session: Session, spaceId: string, muted: boolean) => Promise<void>;
}

export function createMutesStore(opts: {
  client: (s: Session) => StarfishClient;
  kvNamespace: string;
  logTag: string;
}): MutesStore {
  const { client, kvNamespace, logTag } = opts;
  const EMPTY: MutePrefs = { nodes: {}, spaces: {} };
  const keyFor = (userId: string) => `${kvNamespace}.mutes.${userId}`;

  let cache: MutePrefs = EMPTY;
  let activeKey: string | null = null;
  let pending = 0;
  const listeners = new Set<() => void>();

  function coerce(raw: unknown): MutePrefs {
    // Back-compat: pre-0.16 docs keyed node mutes under `rooms`; new wins on overlap.
    const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown; nodes?: unknown; spaces?: unknown };
    const pick = (v: unknown): Record<string, MuteValue> =>
      v && typeof v === 'object' ? (v as Record<string, MuteValue>) : {};
    return { nodes: { ...pick(r.rooms), ...pick(r.nodes) }, spaces: pick(r.spaces) };
  }

  function mapEqual(a: Record<string, MuteValue>, b: Record<string, MuteValue>): boolean {
    const ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
  }
  function prefsEqual(a: MutePrefs, b: MutePrefs): boolean {
    return mapEqual(a.nodes, b.nodes) && mapEqual(a.spaces, b.spaces);
  }

  function emit(next: MutePrefs): void {
    cache = next;
    for (const l of listeners) l();
  }

  function persist(): void {
    if (activeKey) void kvSet(activeKey, JSON.stringify(cache)).catch(() => {});
  }

  function applyMute(prefs: MutePrefs, field: 'nodes' | 'spaces', id: string, muted: boolean): MutePrefs | null {
    const already = isMuteActive(prefs[field][id]);
    if (muted === already && !(muted === false && id in prefs[field])) return null;
    const sub = { ...prefs[field] };
    if (muted) sub[id] = true;
    else delete sub[id];
    return { ...prefs, [field]: sub };
  }

  async function setMute(session: Session, field: 'nodes' | 'spaces', id: string, muted: boolean): Promise<void> {
    activeKey = keyFor(session.userId);
    const next = applyMute(cache, field, id, muted);
    if (next) {
      emit(next);
      persist();
    }
    pending++;
    try {
      await updateSpacesExtraField<MutePrefs>(
        client(session),
        session,
        'mutes',
        (cur) => applyMute(cur ?? EMPTY, field, id, muted),
      );
    } catch (err) {
      console.error(`${logTag} mutes: failed to sync mute change`, err);
    } finally {
      pending--;
    }
  }

  return {
    isMuteActive,
    getMutePrefs: () => cache,
    isNodeMuted: (nodeId) => isMuteActive(cache.nodes[nodeId]),
    isSpaceMuted: (spaceId) => isMuteActive(cache.spaces[spaceId]),
    isMuted: (nodeId, spaceId) => isMuteActive(cache.nodes[nodeId]) || isMuteActive(cache.spaces[spaceId]),
    subscribeMutes: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async hydrateMutes(userId, serverPrefs) {
      activeKey = keyFor(userId);
      if (pending > 0) return;
      if (prefsEqual(cache, serverPrefs)) return;
      emit(serverPrefs);
      await kvSet(activeKey, JSON.stringify(serverPrefs));
    },
    resetMutes() {
      activeKey = null;
      emit(EMPTY);
    },
    async loadMutesFromKv(userId) {
      const raw = await kvGet(keyFor(userId));
      if (!raw) return EMPTY;
      try { return coerce(JSON.parse(raw)); } catch { return EMPTY; }
    },
    setNodeMute: (session, nodeId, muted) => setMute(session, 'nodes', nodeId, muted),
    setSpaceMute: (session, spaceId, muted) => setMute(session, 'spaces', spaceId, muted),
  };
}
