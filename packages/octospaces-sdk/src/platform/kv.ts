/** Web KV adapter — backed by `localStorage`. */
import { configureKv } from '../core/adapters.js';

export function kvGet(key: string): Promise<string | null> {
  try {
    return Promise.resolve(localStorage.getItem(key));
  } catch {
    return Promise.resolve(null);
  }
}

export function kvSet(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch { /* quota exceeded / private mode */ }
  return Promise.resolve();
}

export function kvRemove(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch { /* noop */ }
  return Promise.resolve();
}

/** Call once at app boot (web). Wires `localStorage` into the SDK. */
export function configureWebKv(): void {
  configureKv({ get: kvGet, set: kvSet, remove: kvRemove });
}
