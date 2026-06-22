/**
 * Platform adapters the headless SDK needs the host app to provide.
 *
 * The SDK can't do Metro `.native.ts` file-extension resolution and must not bind
 * to localStorage / AsyncStorage / SecureStore directly, so the host injects a
 * key/value store at boot via {@link configureKv}. This holds account-scoped state
 * the SDK persists offline (joined-space member caps, the public-space access map,
 * read marks, mutes, profile/pull caches).
 *
 * As of 0.23.0, {@link configureKv} also bridges into starfish-spaces: it calls
 * `configureSpaces` and `configureSpaceAccessStore` with an adapted KvAdapter shape
 * (`{getItem,setItem,removeItem}`), so a single `configureKv` call at boot wires
 * both the octospaces residuals and the starfish-spaces access store.
 */
import { configureSpaces, configureSpaceAccessStore } from '@drakkar.software/starfish-spaces';

/** Async key/value store — web `localStorage`, native `AsyncStorage`, etc.
 *  Uses `{get,set,remove}` (octospaces shape); the bridge to starfish's
 *  `{getItem,setItem,removeItem}` shape is handled internally by {@link configureKv}. */
export interface KvAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

let kv: KvAdapter | null = null;

/**
 * Install the host's key/value store. Call once at app boot, BEFORE building sessions
 * or using any starfish-spaces registry/prefs functions.
 *
 * Also wires starfish-spaces config: calls `configureSpaces({ kvAdapter })` and
 * `configureSpaceAccessStore({ kvAdapter, kvKeyPrefix: 'octospaces.spaceaccess.' })`.
 * The `kvKeyPrefix` is fixed to match the pre-0.23.0 persisted access store — existing
 * persisted access entries remain readable after the upgrade.
 */
export function configureKv(adapter: KvAdapter): void {
  kv = adapter;
  const sf = {
    getItem: (k: string) => adapter.get(k),
    setItem: (k: string, v: string) => adapter.set(k, v),
    removeItem: (k: string) => adapter.remove(k),
  };
  configureSpaces({ kvAdapter: sf });
  configureSpaceAccessStore({ kvAdapter: sf, kvKeyPrefix: 'octospaces.spaceaccess.' });
}

/** The configured KV store, or throw if the host never called {@link configureKv}. */
export function getKv(): KvAdapter {
  if (!kv) throw new Error('octospaces-sdk: configureKv() not called — wire it at app boot.');
  return kv;
}

// Free-function shims matching the historical `kv` module surface.
export const kvGet = (key: string): Promise<string | null> => getKv().get(key);
export const kvSet = (key: string, value: string): Promise<void> => getKv().set(key, value);
export const kvRemove = (key: string): Promise<void> => getKv().remove(key);
