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

/**
 * A {@link createKeyedStore} plus a key-composer, exposing the
 * `save`/`get`/`clear`/`serialize`/`hydrate` API the SDK's invite/owner stores share. `K` is
 * the tuple of key parts each store composes (e.g. `[spaceId, userId]`); `save`/`get` take the
 * parts as an array and the rest delegate straight through. Lets each store collapse its
 * hand-rolled wrapper set to a few one-liners with no behaviour change.
 */
export function createComposedStore<T, K extends unknown[]>(composeKey: (...parts: K) => string) {
  const store = createKeyedStore<T>();
  return {
    save: (parts: K, value: T): void => store.set(composeKey(...parts), value),
    get: (parts: K): T | null => store.get(composeKey(...parts)),
    clear: store.clear,
    serialize: store.serialize,
    hydrate: store.hydrate,
  };
}
