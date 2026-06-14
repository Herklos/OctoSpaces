/**
 * Client-side reader for the global public-object directory.
 *
 * The directory is a server-maintained projection doc at
 * `_index/objects/{shard}` (collection `objectindex`, `readRoles:["public"]`,
 * `pullOnly`). It is populated by the `starfish-projection` plugin from
 * `objindex` writes on both the TS and Python servers. Any node with
 * `access:'public'` across any space appears here.
 *
 * Wire-up: call `readObjectDirectory()` (no auth required — world-readable).
 * Returns a flat array; each entry carries its owning `spaceId` so the caller
 * can navigate into the space or deep-link directly to the object.
 *
 * Keep in sync with:
 * - apps/server/src/projections.ts (TS dev-server projection)
 * - drakkar_sync/apps/octovault/projections.py (Python prod-server mirror)
 * - objectDirPull() in sync/paths.ts (the pull path helper)
 */

import { StarfishClient } from '@drakkar.software/starfish-client';
import { getSyncBase, getSyncNamespace } from '../core/config.js';
import { fetchWithTimeout } from '../sync/fetch-timeout.js';
import { objectDirPull } from '../sync/paths.js';

/**
 * A single public object entry in the global directory.
 * Structurally compatible with `PubNode` from the server projections; `spaceId`
 * is added by the client reader (from the per-space map key).
 */
export interface PublicObjectDirEntry {
  /** The space this node belongs to. */
  spaceId: string;
  id: string;
  title: string;
  type: string;
  emoji?: string;
  updatedAt: number;
}

/** Internal shape of one per-space bucket in the directory doc. */
interface SpaceBucket {
  nodes?: unknown[];
  ts?: number;
}

/**
 * Parse the raw directory doc body into a flat `PublicObjectDirEntry[]`.
 *
 * Pure function — directly unit-testable without network mocks. Exported so
 * callers (e.g. cached or pre-fetched data) can use it independently.
 */
export function parseObjectDirectoryDoc(data: unknown): PublicObjectDirEntry[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const map = data as Record<string, SpaceBucket>;
  const entries: PublicObjectDirEntry[] = [];
  for (const [spaceId, bucket] of Object.entries(map)) {
    if (!bucket || !Array.isArray(bucket.nodes)) continue;
    for (const n of bucket.nodes) {
      if (!n || typeof n !== 'object') continue;
      const node = n as Record<string, unknown>;
      const entry: PublicObjectDirEntry = {
        spaceId,
        id: String(node.id ?? ''),
        title: typeof node.title === 'string' ? node.title : '',
        type: typeof node.type === 'string' ? node.type : 'page',
        updatedAt: typeof node.updatedAt === 'number' ? node.updatedAt : 0,
      };
      if (typeof node.emoji === 'string') entry.emoji = node.emoji;
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Pull the global public-object directory and return a flat entry list.
 *
 * No authentication required — the directory collection is world-readable.
 * Returns an empty array on network error or an empty/malformed directory.
 *
 * @param shard - Directory shard key (default `'public'`). Only `'public'`
 *   is materialized today; future shards may exist for type-filtered views.
 */
export async function readObjectDirectory(
  shard: string = 'public',
): Promise<PublicObjectDirEntry[]> {
  const client = new StarfishClient({
    baseUrl: getSyncBase(),
    namespace: getSyncNamespace(),
    fetch: fetchWithTimeout(),
  });
  let res: { data?: unknown } | null = null;
  try {
    res = await client.pull(objectDirPull(shard));
  } catch {
    return [];
  }
  return parseObjectDirectoryDoc(res?.data);
}
