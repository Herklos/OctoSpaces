/**
 * Single dispatch point for live-sync events from a global SSE connection.
 *
 * When a server-sent event arrives, the unread/notification layer calls
 * `dispatchDocChange(docPath)`:
 *   - if a hook has registered a pull for that path → call it (the user is
 *     actively viewing that doc) and return `true` — the caller skips the
 *     unread bump.
 *   - otherwise return `false` → the caller bumps unread.
 *
 * Hooks register/unregister via `registerPull`. SSE connection health is
 * broadcast via `emitSseStatus` so hooks can gate their fallback polling.
 *
 * Call `clearLiveSyncBus()` on account switch to flush all registrations.
 */

type PullFn = () => void;
type StatusListener = (up: boolean) => void;

const pullRegistry = new Map<string, PullFn>();
const statusListeners = new Set<StatusListener>();
let sseUp = false;

/**
 * Register a pull function keyed by `docPath`. Returns an unsubscribe
 * function — call it when the hook unmounts.
 */
export function registerPull(docPath: string, fn: PullFn): () => void {
  pullRegistry.set(docPath, fn);
  return () => {
    if (pullRegistry.get(docPath) === fn) pullRegistry.delete(docPath);
  };
}

/**
 * Dispatch a doc-change event. If a pull is registered for `docPath`, calls
 * it and returns `true`. Returns `false` if no listener is registered
 * (the caller should bump unread).
 */
export function dispatchDocChange(docPath: string): boolean {
  const pull = pullRegistry.get(docPath);
  if (!pull) return false;
  pull();
  return true;
}

/** Broadcast the current SSE health to all subscribers. */
export function emitSseStatus(up: boolean): void {
  sseUp = up;
  for (const l of statusListeners) l(up);
}

/**
 * Subscribe to SSE health changes. Fires immediately with the current state.
 * Returns an unsubscribe function.
 */
export function onSseStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  cb(sseUp);
  return () => statusListeners.delete(cb);
}

/**
 * Flush all registered doc pulls and reset SSE health. Call on account
 * switch. `statusListeners` are React subscriptions that self-unsubscribe on
 * unmount and are intentionally left intact.
 */
export function clearLiveSyncBus(): void {
  pullRegistry.clear();
  sseUp = false;
}
