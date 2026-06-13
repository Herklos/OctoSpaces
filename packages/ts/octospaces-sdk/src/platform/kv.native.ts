/** Native KV adapter — backed by `@react-native-async-storage/async-storage`. */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — optional peer dep; the native bundle is only loaded on RN targets.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { configureKv } from '../core/adapters.js';

export function kvGet(key: string): Promise<string | null> {
  return (AsyncStorage as { getItem(k: string): Promise<string | null> }).getItem(key).catch(() => null);
}

export function kvSet(key: string, value: string): Promise<void> {
  return (AsyncStorage as { setItem(k: string, v: string): Promise<void> }).setItem(key, value).catch(() => {});
}

export function kvRemove(key: string): Promise<void> {
  return (AsyncStorage as { removeItem(k: string): Promise<void> }).removeItem(key).catch(() => {});
}

/** Call once at app boot (native). Wires `AsyncStorage` into the SDK. */
export function configureNativeKv(): void {
  configureKv({ get: kvGet, set: kvSet, remove: kvRemove });
}
