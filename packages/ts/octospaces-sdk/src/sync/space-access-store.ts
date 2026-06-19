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
import { kvGet, kvSet } from '../core/adapters.js';

/** Link-based access credential: the ephemeral cap + keys a link bearer stores to
 *  reach a space. Shared by the access-store entry, the hydrate input, and
 *  `linkAccessFromStore` / `recoverSpaceAccess` so the shape stays in one place. */
export interface LinkAccessPayload {
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
}

export type SpaceAccessEntry =
  | { kind: 'member'; cap: string }
  | ({ kind: 'link' } & LinkAccessPayload);

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
  serverLinkAccess: Record<string, LinkAccessPayload>,
): Promise<void> {
  const key = keyFor(userId);
  // First call for this account: load the kv cache and reset in-memory state.
  // Subsequent calls (e.g. re-sync after a newly-granted cap) skip the kv reload but
  // ALWAYS run the server-cap merge — the merge is idempotent ("server wins") so
  // re-running it on a second call is correct and necessary.
  const firstLoad = activeKey !== key;
  if (firstLoad) {
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
  if (activeKey) void kvSet(activeKey, JSON.stringify(cache)).catch(() => {});
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

// ── Per-node access entries (keyed by `${spaceId}:${nodeId}` + tier suffix) ───
//
// A `member` cap covers exactly one collection, so a node's content (`objinv`),
// append-log STREAM (`objinvlog`) and E2EE KEYRING (`nodekeyring`) each need their
// OWN cap. They are stored under sibling keys (base / `:stream` / `:keyring`) so all
// three ride the SAME sync/serialization machinery as every other entry — no
// entry-shape change. All accessors delegate to the space-tier primitives above.

const nodeKey = (spaceId: string, nodeId: string, suffix: '' | ':stream' | ':keyring' = '') =>
  `${spaceId}:${nodeId}${suffix}`;

/** Look up a per-node invite access entry. Returns null if not invited or unknown. */
export function getNodeAccessEntry(spaceId: string, nodeId: string): SpaceAccessEntry | null {
  return getSpaceAccessEntry(nodeKey(spaceId, nodeId));
}

/** Persist an invite access entry for one node. */
export function saveNodeAccessEntry(spaceId: string, nodeId: string, entry: SpaceAccessEntry): void {
  saveSpaceAccessEntry(nodeKey(spaceId, nodeId), entry);
}

/** Forget a node's invite access entry (e.g. on leaving the node). Also removes the
 *  sibling stream + keyring entries so they don't orphan and grant lingering access. */
export function removeNodeAccessEntry(spaceId: string, nodeId: string): void {
  removeSpaceAccessEntry(nodeKey(spaceId, nodeId));
  removeSpaceAccessEntry(nodeKey(spaceId, nodeId, ':stream'));
  removeSpaceAccessEntry(nodeKey(spaceId, nodeId, ':keyring'));
}

/** Look up a per-node STREAM (objinvlog) access entry. Null if absent. */
export function getNodeStreamAccessEntry(spaceId: string, nodeId: string): SpaceAccessEntry | null {
  return getSpaceAccessEntry(nodeKey(spaceId, nodeId, ':stream'));
}

/** Persist a per-node STREAM (objinvlog) access entry. */
export function saveNodeStreamAccessEntry(spaceId: string, nodeId: string, entry: SpaceAccessEntry): void {
  saveSpaceAccessEntry(nodeKey(spaceId, nodeId, ':stream'), entry);
}

/** Forget a node's STREAM access entry. */
export function removeNodeStreamAccessEntry(spaceId: string, nodeId: string): void {
  removeSpaceAccessEntry(nodeKey(spaceId, nodeId, ':stream'));
}

/** Look up a per-node KEYRING (nodekeyring) access entry. Null if absent. */
export function getNodeKeyringAccessEntry(spaceId: string, nodeId: string): SpaceAccessEntry | null {
  return getSpaceAccessEntry(nodeKey(spaceId, nodeId, ':keyring'));
}

/** Persist a per-node KEYRING (nodekeyring) access entry. */
export function saveNodeKeyringAccessEntry(spaceId: string, nodeId: string, entry: SpaceAccessEntry): void {
  saveSpaceAccessEntry(nodeKey(spaceId, nodeId, ':keyring'), entry);
}

/** Forget a node's KEYRING access entry. */
export function removeNodeKeyringAccessEntry(spaceId: string, nodeId: string): void {
  removeSpaceAccessEntry(nodeKey(spaceId, nodeId, ':keyring'));
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
export function linkAccessFromStore(): Record<string, LinkAccessPayload> {
  const out: Record<string, LinkAccessPayload> = {};
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
