/**
 * Generic SSE live-change transport for Starfish /events streams.
 *
 * Three pure + one lifecycle export:
 *  - buildSignedEventsRequest — build fetch URL + signed pathAndQuery
 *  - parseSseFrames            — WHATWG-compliant incremental SSE parser
 *  - subscribeChanges          — auto-reconnecting subscription (parse-injected)
 *
 * There is NO platform split needed: fetch-streaming works on both web and RN.
 * App-specific payload parsing is injected via the `parse` callback so this
 * module stays free of any domain knowledge.
 */
import { getEventsUrl, getSyncBase } from '../core/config.js';

// ── buildSignedEventsRequest ──────────────────────────────────────────────────

/**
 * Build the fetch URL and the signed `pathAndQuery` for a /events SSE request.
 *
 * Two invariants enforced:
 *  1. The mount prefix (e.g. `/sync`) is stripped from the SIGNED path so the
 *     signature matches what the origin verifies after nginx rewrites the request —
 *     exactly as starfish-client's /pull signs `applyNamespace(path)` without the
 *     baseUrl prefix.
 *  2. The comma between space ids is encoded as `%2C` (URLSearchParams) so a
 *     normalising CDN (Cloudflare) cannot re-encode a literal comma and invalidate
 *     the signature. The fetch `url` retains the full mount path for routing.
 *
 * @param spaceIds   Space ids to subscribe to.
 * @param config     Optional override for eventsUrl / syncBase (useful in tests).
 *                   Defaults to the values from `configureOctoSpaces()`.
 */
export function buildSignedEventsRequest(
  spaceIds: string[],
  config?: { eventsUrl?: string; syncBase?: string },
): { url: string; pathAndQuery: string } {
  const eventsUrl = config?.eventsUrl ?? getEventsUrl();
  const syncBase = config?.syncBase ?? getSyncBase();

  const u = new URL(eventsUrl);
  const params = new URLSearchParams();
  params.set('spaces', spaceIds.join(','));
  u.search = params.toString(); // spaces=sp-a%2Csp-b

  // Strip the sync-base mount path from the signed path so it matches the path
  // the origin sees after nginx strips the mount prefix.
  let basePath = '';
  try {
    basePath = new URL(syncBase).pathname.replace(/\/+$/, '');
  } catch {
    /* relative base — no prefix to strip */
  }
  const signedPath =
    basePath && u.pathname.startsWith(basePath)
      ? u.pathname.slice(basePath.length)
      : u.pathname;

  return { url: u.toString(), pathAndQuery: signedPath + u.search };
}

// ── parseSseFrames ────────────────────────────────────────────────────────────

/**
 * Incrementally parse SSE frames from a raw text chunk (WHATWG SSE spec §10.1).
 * `carry` is the leftover text from the previous chunk (incomplete frame).
 * Returns the data payloads of completed frames and the new carry to pass next call.
 */
export function parseSseFrames(
  chunk: string,
  carry: string,
): { events: string[]; carry: string } {
  // Normalize line endings per SSE spec.
  const text = (carry + chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Frames are delimited by blank lines (\n\n).
  const parts = text.split('\n\n');
  const events: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const dataLines: string[] = [];
    for (const line of parts[i].split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      // id:, event:, and : (comment/heartbeat) lines are intentionally skipped.
    }
    if (dataLines.length > 0) events.push(dataLines.join('\n'));
  }
  // The last part may be incomplete — hold it as the new carry.
  return { events, carry: parts[parts.length - 1] };
}

// ── subscribeChanges ──────────────────────────────────────────────────────────

export interface SubscribeChangesOptions<T> {
  /** Space ids to subscribe to. */
  spaces: string[];
  /**
   * Async function that returns the signed auth headers for a given HTTP method
   * and pathAndQuery. Typically wraps `buildAuthHeaders(cap, edPriv, method, pq)`.
   */
  authHeaders: (method: string, pathAndQuery: string) => Promise<Record<string, string>>;
  /**
   * Parse one SSE data payload and return the domain change object, or `null` to
   * skip the frame. This is the ONLY app-specific injection — everything else is
   * generic transport.
   */
  parse: (data: string) => T | null;
  /** Fired for each successfully parsed change. */
  onChange: (change: T) => void;
  /** Fired with `true` on first successful stream read, `false` on disconnect/error. */
  onStatus?: (connected: boolean) => void;
  /** Minimum reconnect delay (ms). Resets to this value after a successful connect.
   *  @default 1000 */
  minReconnectMs?: number;
  /** Maximum reconnect delay — backoff caps here.
   *  @default 30000 */
  maxReconnectMs?: number;
}

/**
 * Open a single auto-reconnecting SSE subscription to the /events endpoint.
 *
 * - Builds a signed request via `buildSignedEventsRequest` on every attempt so
 *   fresh auth headers are obtained each reconnect (caps rotate over long sessions).
 * - Uses capped exponential backoff: resets to `minReconnectMs` after a successful
 *   connect (at least one byte received), doubles up to `maxReconnectMs` on failure.
 * - Returns an unsubscribe function: call it to abort the stream and stop reconnecting.
 *
 * @returns Unsubscribe function.
 */
export function subscribeChanges<T>(opts: SubscribeChangesOptions<T>): () => void {
  const {
    spaces,
    authHeaders,
    parse,
    onChange,
    onStatus,
    minReconnectMs = 1_000,
    maxReconnectMs = 30_000,
  } = opts;

  let closed = false;
  let backoff = minReconnectMs;
  const controller = new AbortController();

  void (async () => {
    while (!closed) {
      // Build a fresh signed request each attempt (auth headers may rotate).
      const { url, pathAndQuery } = buildSignedEventsRequest(spaces);

      let extraHeaders: Record<string, string>;
      try {
        extraHeaders = await authHeaders('GET', pathAndQuery);
      } catch {
        // Signing failure — session likely gone; stop the loop.
        break;
      }
      if (closed) break;

      let connected = false;
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/event-stream', ...extraHeaders },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);

        onStatus?.(true);
        connected = true;
        backoff = minReconnectMs; // reset backoff on successful connect

        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let carry = '';

        try {
          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const { events, carry: next } = parseSseFrames(chunk, carry);
            carry = next;
            for (const data of events) {
              const change = parse(data);
              if (change !== null) onChange(change);
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch {
        /* network error, abort, or non-ok response — fall through to reconnect */
      }

      if (closed || controller.signal.aborted) break;

      if (connected) onStatus?.(false);

      // Backoff before next attempt (doubles each failure, capped at max).
      await new Promise<void>((resolve) => setTimeout(resolve, backoff));
      if (!connected) backoff = Math.min(backoff * 2, maxReconnectMs);
    }
  })();

  return () => {
    closed = true;
    controller.abort();
    onStatus?.(false);
  };
}
