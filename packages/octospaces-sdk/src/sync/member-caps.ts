/**
 * Member caps for spaces this identity has JOINED (vs. owns). Maps spaceId →
 * space member cap-cert JSON so a room hook can open a joined space's channels as
 * a keyring recipient (one cap covers every channel in the space).
 *
 * TWO tiers: the durable source of truth is the user's own synced `_spaces` doc
 * (see `registry.ts` — `caps` key); the platform kv is a fast, offline cache.
 * Both are keyed PER-USER so accounts never see each other's memberships.
 */
import type { CapMap } from '../core/types.js';

import { kvGet, kvRemove, kvSet } from '../core/adapters.js';

const LEGACY_KEY = 'octospaces.membercaps.v1';
const keyFor = (userId: string) => `octospaces.membercaps.${userId}`;

let cache: CapMap = {};
let activeKey: string | null = null;

/**
 * Load the active account's joined-space caps into memory. Call (and await) on
 * sign-in and on every account switch, before opening rooms.
 *
 * Two-tier load: the local kv first (fast, offline), then the caps from the user's
 * own synced `_spaces` doc merged OVER it (the durable source of truth).
 */
export async function hydrateMemberCaps(userId: string, serverCaps: CapMap): Promise<void> {
  const key = keyFor(userId);
  if (activeKey === key) return;
  activeKey = key;
  cache = {};
  let raw = await kvGet(key);
  if (raw === null) {
    const legacy = await kvGet(LEGACY_KEY);
    if (legacy !== null) {
      raw = legacy;
      await kvSet(key, legacy);
      await kvRemove(LEGACY_KEY);
    }
  }
  if (raw) {
    try {
      cache = JSON.parse(raw) as CapMap;
    } catch (e) {
      console.error('[octospaces] member-caps: corrupt cache blob, resetting:', e);
      cache = {};
    }
  }
  if (Object.keys(serverCaps).length > 0) {
    cache = { ...cache, ...serverCaps };
    await kvSet(key, JSON.stringify(cache));
  }
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

export function getMemberCap(spaceId: string): string | null {
  return cache[spaceId] ?? null;
}

export function saveMemberCap(spaceId: string, capJson: string): void {
  cache = { ...cache, [spaceId]: capJson };
  persist();
}

/** Forget one joined space's cap (on leaving that space). */
export function removeMemberCap(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  persist();
}

/** Drop the in-memory caps (on account switch / sign-out). */
export function clearMemberCaps(): void {
  cache = {};
  activeKey = null;
}
