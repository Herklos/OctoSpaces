import { describe, it, expect, beforeEach } from 'vitest';
import { configureKv } from '../core/adapters.js';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from './pull-cache.js';

// Reset the singleton between tests by resetting the module-level `shared`
// — we work around it by reconfiguring KV with a fresh store each time.
let store: Map<string, string>;

function makeKv() {
  store = new Map<string, string>();
  configureKv({
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v) => { store.set(k, v); return Promise.resolve(); },
    remove: (k) => { store.delete(k); return Promise.resolve(); },
  });
}

describe('PULL_CACHE_MAX_AGE_MS', () => {
  it('is a positive number', () => {
    expect(PULL_CACHE_MAX_AGE_MS).toBeGreaterThan(0);
  });
});

describe('pullCache', () => {
  beforeEach(() => { makeKv(); });

  it('returns an object with get and set', () => {
    const cache = pullCache();
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.set).toBe('function');
  });

  it('set + get round-trip stores and retrieves a string', async () => {
    const cache = pullCache();
    const key = 'test-key';
    const value = JSON.stringify({ data: { hello: 'world' }, hash: 'abc123' });
    await cache.set(key, value);
    const hit = await cache.get(key);
    expect(hit).toBe(value);
  });

  it('returns null for unknown key', async () => {
    const cache = pullCache();
    const hit = await cache.get('no-such-key');
    expect(hit).toBeNull();
  });

  it('uses octospaces.pullcache. prefix internally', async () => {
    const cache = pullCache();
    await cache.set('mykey', 'myvalue');
    // The key in the underlying store should have the prefix
    const raw = store.get('octospaces.pullcache.mykey');
    expect(raw).toBe('myvalue');
  });
});
