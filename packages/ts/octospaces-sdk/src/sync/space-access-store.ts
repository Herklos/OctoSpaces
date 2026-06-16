/**
 * Unified local access store for spaces this identity has joined.
 *
 * Replaces the separate `member-caps.ts` (private spaces) and `pubspace-caps.ts`
 * (public/link spaces). Two entry kinds:
 *   - `member`: a member cap-cert (plain JSON, no bearer secret — safe to store
 *     in the clear). Used for PRIVATE space keyring opens.
 *   - `link`: an ephemeral-subject cap + the link's Ed25519 private key. Embeds a
 *     bearer secret so it is SEALED in the synced `_spaces.pubAccess` field before
 *     leaving this device; the local kv stores it plaintext only on the owning device.
 *
 * Two tiers (same as old member-caps): device-local kv (fast, offline) and the
 * user's synced `_spaces` doc (durable source of truth; merged over local on hydrate).
 * Keyed PER-USER so multiple accounts on one device never see each other's entries.
 */
import type { CapMap, PubAccessMap } from '../core/types.js';
import type { SealedBlob } from './account-seal.js';
import { kvGet, kvSet } from '../core/adapters.js';

export type SpaceAccessEntry =
  | { kind: 'member'; cap: string }
  | {
      kind: 'link';
      cap: unknown;
      key: string;
      /**
       * The ephemeral X25519 KEM private key (hex) used to decrypt the space keyring.
       * Present in tokens created by `createSpaceInviteLink` ≥0.8.6.
       * Absent in legacy tokens — fall back to `session.keys` when missing.
       */
      kemPriv?: string;
      /** The ephemeral X25519 KEM public key (hex) — the keyring recipient identifier. */
      kemPub?: string;
      write: boolean;
    };

export type SpaceAccessMap = Record<string, SpaceAccessEntry>;

const keyFor = (userId: string) => `octospaces.spaceaccess.${userId}`;

let cache: SpaceAccessMap = {};
let activeKey: string | null = null;

/**
 * Load the active account's space-access entries into memory. Call (and await) on
 * sign-in and on every account switch, before opening rooms.
 *
 * `serverCaps` (private member caps from `_spaces.caps`) and `serverPubAccess`
 * (sealed link credentials from `_spaces.pubAccess`, already unsealed by the caller)
 * are merged OVER the local kv cache (server wins).
 */
export async function hydrateSpaceAccessStore(
  userId: string,
  serverCaps: CapMap,
  serverLinkAccess: Record<string, { cap: unknown; key: string; kemPriv?: string; kemPub?: string; write: boolean }>,
): Promise<void> {
  const key = keyFor(userId);
  if (activeKey === key) return;
  activeKey = key;
  cache = {};
  const raw = await kvGet(key);
  if (raw) {
    try {
      cache = JSON.parse(raw) as SpaceAccessMap;
    } catch (e) {
      console.error('[octospaces] space-access-store: corrupt cache, resetting:', e);
      cache = {};
    }
  }
  let changed = false;
  for (const [spaceId, capJson] of Object.entries(serverCaps)) {
    cache[spaceId] = { kind: 'member', cap: capJson };
    changed = true;
  }
  for (const [spaceId, access] of Object.entries(serverLinkAccess)) {
    cache[spaceId] = { kind: 'link', cap: access.cap, key: access.key, kemPriv: access.kemPriv, kemPub: access.kemPub, write: access.write };
    changed = true;
  }
  if (changed) await kvSet(key, JSON.stringify(cache));
}

function persist(): void {
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache));
}

export function getSpaceAccessEntry(spaceId: string): SpaceAccessEntry | null {
  return cache[spaceId] ?? null;
}

export function saveSpaceAccessEntry(spaceId: string, entry: SpaceAccessEntry): void {
  cache = { ...cache, [spaceId]: entry };
  persist();
}

/** Forget one space's access (on leaving that space). */
export function removeSpaceAccessEntry(spaceId: string): void {
  if (!(spaceId in cache)) return;
  const next = { ...cache };
  delete next[spaceId];
  cache = next;
  persist();
}

// ── Per-node access entries (keyed by `${spaceId}:${nodeId}`) ────────────────

/** Look up a per-node invite access entry. Returns null if not invited or unknown. */
export function getNodeAccessEntry(spaceId: string, nodeId: string): SpaceAccessEntry | null {
  return cache[`${spaceId}:${nodeId}`] ?? null;
}

/** Persist an invite access entry for one node. */
export function saveNodeAccessEntry(spaceId: string, nodeId: string, entry: SpaceAccessEntry): void {
  saveSpaceAccessEntry(`${spaceId}:${nodeId}`, entry);
}

/** Forget a node's invite access entry (e.g. on leaving the node). Also removes the
 *  sibling stream entry so they don't orphan and grant lingering stream access. */
export function removeNodeAccessEntry(spaceId: string, nodeId: string): void {
  removeSpaceAccessEntry(`${spaceId}:${nodeId}`);
  removeSpaceAccessEntry(`${spaceId}:${nodeId}:stream`);
}

// A `member` cap covers exactly one collection, so a node's append-log STREAM
// (`objinvlog`) needs its OWN cap separate from the content cap (`objinv`). It is
// stored under a distinct `${spaceId}:${nodeId}:stream` key so it rides the SAME
// sync/serialization machinery as every other entry — no entry-shape change.

/** Look up a per-node STREAM (objinvlog) access entry. Null if absent. */
export function getNodeStreamAccessEntry(spaceId: string, nodeId: string): SpaceAccessEntry | null {
  return cache[`${spaceId}:${nodeId}:stream`] ?? null;
}

/** Persist a per-node STREAM (objinvlog) access entry. */
export function saveNodeStreamAccessEntry(spaceId: string, nodeId: string, entry: SpaceAccessEntry): void {
  saveSpaceAccessEntry(`${spaceId}:${nodeId}:stream`, entry);
}

/** Forget a node's STREAM access entry. */
export function removeNodeStreamAccessEntry(spaceId: string, nodeId: string): void {
  removeSpaceAccessEntry(`${spaceId}:${nodeId}:stream`);
}

/** A snapshot of the in-memory cache — used by `recoverSpaceAccess` to find entries
 *  not yet on the server. */
export function localSpaceAccessEntries(): SpaceAccessMap {
  return cache;
}

/** Build the `CapMap` slice (member entries only) for persisting into `_spaces.caps`. */
export function memberCapsFromStore(): CapMap {
  const out: CapMap = {};
  for (const [id, e] of Object.entries(cache)) if (e.kind === 'member') out[id] = e.cap;
  return out;
}

/** Build the `PubAccessMap` slice (link entries already sealed by the caller). */
export function linkAccessFromStore(): Record<string, { cap: unknown; key: string; kemPriv?: string; kemPub?: string; write: boolean }> {
  const out: Record<string, { cap: unknown; key: string; kemPriv?: string; kemPub?: string; write: boolean }> = {};
  for (const [id, e] of Object.entries(cache)) {
    if (e.kind === 'link') out[id] = { cap: e.cap, key: e.key, kemPriv: e.kemPriv, kemPub: e.kemPub, write: e.write };
  }
  return out;
}

/** Drop the in-memory cache (on account switch / sign-out). */
export function clearSpaceAccessStore(): void {
  cache = {};
  activeKey = null;
}
