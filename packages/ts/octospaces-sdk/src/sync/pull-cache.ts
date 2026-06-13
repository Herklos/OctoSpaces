/**
 * The app's offline-first read cache for every {@link StarfishClient}.
 *
 * Backs the SDK's {@link PullCache} (read-through pull cache) with the kv layer
 * (localStorage on web, AsyncStorage on native). When a client is built with this
 * cache, every successful structured `pull()` is written through, and a pull that
 * fails because the transport is unreachable falls back to the last-synced snapshot.
 *
 * SECURITY: the SDK caches the RAW server response only. For E2E collections that
 * payload is the SEALED ciphertext the server holds — never the decrypted form —
 * so this cache is ciphertext-at-rest by construction.
 */
import type { PullCache } from '@drakkar.software/starfish-client';

import { kvGet, kvSet } from '../core/adapters.js';

const PREFIX = 'octospaces.pullcache.';

/**
 * Max age for a cached snapshot before it's treated as a miss. Generous (30 days)
 * because for an offline-first app any last-synced data beats none.
 */
export const PULL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let shared: PullCache | undefined;

/** The shared app-wide pull cache (one instance, reused across every client). */
export function pullCache(): PullCache {
  return (shared ??= {
    get: (key) => kvGet(PREFIX + key),
    set: (key, value) => kvSet(PREFIX + key, value),
  });
}
