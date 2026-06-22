/**
 * SSE live-change transport for Starfish /events streams.
 *
 * Thin octospaces wrappers over `@drakkar.software/starfish-client/events` (alpha.30+):
 *
 * - `parseSseFrames` — re-exported verbatim (WHATWG-compliant incremental SSE parser).
 * - `buildSignedEventsRequest` — wraps `buildSignedEventsUrl` with the octospaces
 *   `/events?spaces=...` convention.
 * - `subscribeChanges` — wraps the generic `subscribeChanges` from starfish-client
 *   with the space-id-list URL-building baked in, preserving the same public interface
 *   consumers already depend on.
 */
import {
  buildSignedEventsUrl,
  subscribeChanges as _subscribeChanges,
} from '@drakkar.software/starfish-client/events';
import { getEventsUrl, getSyncBase } from '../core/config.js';

export { parseSseFrames } from '@drakkar.software/starfish-client/events';

// ── buildSignedEventsRequest ──────────────────────────────────────────────────

export function buildSignedEventsRequest(
  spaceIds: string[],
  config?: { eventsUrl?: string; syncBase?: string },
): { url: string; pathAndQuery: string } {
  return buildSignedEventsUrl(
    config?.eventsUrl ?? getEventsUrl(),
    { spaces: spaceIds.join(',') },
    config?.syncBase ?? getSyncBase(),
  );
}

// ── subscribeChanges ──────────────────────────────────────────────────────────

export interface SubscribeChangesOptions<T> {
  spaces: string[];
  authHeaders: (method: string, pathAndQuery: string) => Promise<Record<string, string>>;
  parse: (data: string) => T | null;
  onChange: (change: T) => void;
  onStatus?: (connected: boolean) => void;
  minReconnectMs?: number;
  maxReconnectMs?: number;
}

export function subscribeChanges<T>(opts: SubscribeChangesOptions<T>): () => void {
  const { spaces, ...rest } = opts;
  return _subscribeChanges({
    url: () => buildSignedEventsRequest(spaces).url,
    pathAndQuery: () => buildSignedEventsRequest(spaces).pathAndQuery,
    ...rest,
  });
}
