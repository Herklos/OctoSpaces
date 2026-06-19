/**
 * A minimal in-memory keyed store with serialize/hydrate, shared by the SDK's
 * cross-reload caches (space-invite, node-invite, and reqId→owner stores).
 *
 * Each store is keyed by a plain string the caller composes (1, 2, or 3 parts) and
 * holds an arbitrary value type. `get` returns `null` (not `undefined`) when a key
 * is absent, matching the existing accessor contracts. `hydrate` is additive — it
 * merges entries without clearing, so restoring persisted state never drops
 * entries recorded since boot.
 */
export interface KeyedStore<T> {
  set(key: string, value: T): void;
  get(key: string): T | null;
  clear(): void;
  serialize(): Array<[string, T]>;
  hydrate(entries: Array<[string, T]>): void;
}

export function createKeyedStore<T>(): KeyedStore<T> {
  const map = new Map<string, T>();
  return {
    set: (key, value) => { map.set(key, value); },
    get: (key) => map.get(key) ?? null,
    clear: () => { map.clear(); },
    serialize: () => [...map.entries()],
    hydrate: (entries) => { for (const [key, value] of entries) map.set(key, value); },
  };
}
