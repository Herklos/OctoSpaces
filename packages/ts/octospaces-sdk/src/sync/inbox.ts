/**
 * Inbox client helpers — read the `inbox/{identity}/{shard}` collection.
 *
 * `sync/paths.ts` exposes the pure path-string builders (`inboxName` / `inboxPull` /
 * `inboxPush`). This module adds the shard-rotation helpers and an authenticated read
 * wrapper. Anonymous writes to the inbox (public-write, no cap required) live in
 * `sync/signed-append.ts`.
 *
 * Reads require a `cap:read:inbox` cap for `inbox/{identity}/**`. The owner's
 * `accountScope` / `linkedDeviceScope` already grants it — use `session.accountClient`.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { inboxPull } from './paths.js';

/** Current UTC month shard in `YYYY-MM` format. */
export function inboxShard(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * The current and previous UTC month shards — ensures an invite delivered near a
 * month boundary is still visible in the next month's scan.
 */
export function inboxShards(): string[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const current = `${y}-${String(m + 1).padStart(2, '0')}`;
  const prevY = m === 0 ? y - 1 : y;
  const prevM = m === 0 ? 12 : m;
  const previous = `${prevY}-${String(prevM).padStart(2, '0')}`;
  return [current, previous];
}

/** One inbox element as stored in the append-only shard. */
export interface InboxElement {
  ts: number;
  data: Record<string, unknown>;
}

/**
 * Pull one shard of `identity`'s inbox via `client` (must hold `cap:read:inbox` for
 * `inbox/{identity}/**`). Best-effort: returns `[]` on any error (unreachable server,
 * 403 stale cap, 404 empty month, etc.) — a single bad shard must not blank the inbox.
 */
export async function pullInbox(
  client: StarfishClient,
  identity: string,
  shard: string,
): Promise<InboxElement[]> {
  return (await client
    .pull<InboxElement>(inboxPull(identity, shard), {
      appendField: 'items',
      full: true,
    })
    .catch(() => [])) as unknown as InboxElement[];
}
