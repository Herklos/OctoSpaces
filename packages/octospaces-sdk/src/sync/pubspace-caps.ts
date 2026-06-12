/**
 * Invitation caps for PUBLIC spaces this identity has JOINED via a link (vs. owns).
 * Maps spaceId → the link's credential so room hooks can read/write the plaintext
 * `pubspaces/{ownerId}/{spaceId}/…` subtree as the link's ephemeral subject.
 *
 * Mirrors `member-caps.ts`: persisted via the platform kv, keyed PER-USER, and
 * hydrated into an in-memory cache on sign-in / account switch.
 */
import { kvGet, kvRemove, kvSet } from '../core/adapters.js';

/** Everything from an invitation link needed to authorize requests as its bearer. */
export interface PubspaceAccess {
  ownerId: string;
  cap: unknown;
  /** The throwaway ephemeral subject's Ed25519 private key (hex). */
  key: string;
  write: boolean;
}

export type AccessMap = Record<string, PubspaceAccess>;

const LEGACY_KEY = 'octospaces.pubspacecaps.v1';
const keyFor = (userId: string) => `octospaces.pubspacecaps.${userId}`;

let cache: AccessMap = {};
let activeKey: string | null = null;

/** Load the active account's public-space access into memory. */
export async function hydratePubspaceCaps(userId: string): Promise<void> {
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
      cache = JSON.parse(raw) as AccessMap;
    } catch (e) {
      console.error('[octospaces] pubspace-caps: corrupt cache blob, resetting in-memory:', e);
      cache = {};
    }
  }
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

/**
 * Merge access entries recovered from the synced `_spaces` doc OVER the in-memory
 * cache (server wins) and warm the local kv.
 */
export function mergePubspaceAccess(entries: AccessMap): void {
  if (Object.keys(entries).length === 0) return;
  cache = { ...cache, ...entries };
  persist();
}

/** A snapshot of the in-memory access cache. */
export function localPubspaceEntries(): AccessMap {
  return cache;
}

export function getPubspaceAccess(spaceId: string): PubspaceAccess | null {
  return cache[spaceId] ?? null;
}

export function savePubspaceAccess(spaceId: string, access: PubspaceAccess): void {
  cache = { ...cache, [spaceId]: access };
  persist();
}

/** Forget one joined public space's access (on leaving it). */
export function removePubspaceAccess(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  persist();
}

/** Drop the in-memory access (on account switch / sign-out). */
export function clearPubspaceCaps(): void {
  cache = {};
  activeKey = null;
}
