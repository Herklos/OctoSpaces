/**
 * Async key/value persistence — native (AsyncStorage). Mirrors `kv.ts`. Holds
 * account-scoped state (joined-space member caps, per-space nav preferences). The
 * recovery seed uses Keychain via `storage.native.ts`.
 */
// @ts-ignore — optional peer dep; only present in native builds
import AsyncStorage from '@react-native-async-storage/async-storage';

type AS = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
};
const AS = AsyncStorage as unknown as AS;

export async function kvGet(key: string): Promise<string | null> {
  try {
    return await AS.getItem(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    await AS.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export async function kvRemove(key: string): Promise<void> {
  try {
    await AS.removeItem(key);
  } catch {
    /* ignore */
  }
}
