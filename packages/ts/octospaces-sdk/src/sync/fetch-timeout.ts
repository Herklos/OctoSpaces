/**
 * A `fetch` wrapper that bounds the CONNECT/TTFB phase only.
 *
 * Aborts a request that hasn't RESPONDED within {@link CONNECT_TIMEOUT_MS}, turning
 * an opaque infinite spinner into a normal rejection the open path can surface as a
 * retriable error. Clears the timer once response headers arrive, so it bounds ONLY
 * the connect phase — body downloads and long-lived streams stay unbounded.
 */

export const CONNECT_TIMEOUT_MS = 12_000; // generous: trips only on a truly stalled socket

export function fetchWithTimeout(timeoutMs = CONNECT_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const caller = init?.signal;
    if (caller) {
      if (caller.aborted) ctrl.abort();
      else caller.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    return fetch(input as RequestInfo, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };
}
