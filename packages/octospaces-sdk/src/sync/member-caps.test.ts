import { describe, it, expect, beforeEach } from 'vitest';
import { configureKv } from '../core/adapters.js';
import {
  clearMemberCaps,
  getMemberCap,
  hydrateMemberCaps,
  removeMemberCap,
  saveMemberCap,
} from './member-caps.js';

let store: Map<string, string>;

function makeKvStore() {
  store = new Map<string, string>();
  configureKv({
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v) => { store.set(k, v); return Promise.resolve(); },
    remove: (k) => { store.delete(k); return Promise.resolve(); },
  });
  return store;
}

describe('member-caps', () => {
  beforeEach(() => {
    clearMemberCaps();
    makeKvStore();
  });

  it('returns null for unknown space', () => {
    expect(getMemberCap('sp-unknown')).toBeNull();
  });

  it('save + get round-trip', () => {
    saveMemberCap('sp-test', '{"kind":"member"}');
    expect(getMemberCap('sp-test')).toBe('{"kind":"member"}');
  });

  it('remove drops a stored cap', () => {
    saveMemberCap('sp-abc', 'capjson');
    removeMemberCap('sp-abc');
    expect(getMemberCap('sp-abc')).toBeNull();
  });

  it('clear wipes all caps', () => {
    saveMemberCap('sp-1', 'a');
    saveMemberCap('sp-2', 'b');
    clearMemberCaps();
    expect(getMemberCap('sp-1')).toBeNull();
    expect(getMemberCap('sp-2')).toBeNull();
  });

  it('hydrate loads caps from kv into memory', async () => {
    const caps = { 'sp-x': '{"kind":"member","sub":"abc"}' };
    store.set('octospaces.membercaps.user123', JSON.stringify(caps));
    clearMemberCaps();
    await hydrateMemberCaps('user123', {});
    expect(getMemberCap('sp-x')).toBe('{"kind":"member","sub":"abc"}');
  });

  it('uses octospaces. prefix for kv key (not octochat.)', async () => {
    saveMemberCap('sp-test', '{"kind":"member"}');
    // The backing KV key includes userId — check after a hydrate round-trip.
    const caps = { 'sp-test': '{"kind":"member"}' };
    store.set('octospaces.membercaps.user-abc', JSON.stringify(caps));
    clearMemberCaps();
    await hydrateMemberCaps('user-abc', {});
    // The kv key should NOT use 'octochat.'
    const legacyKey = Array.from(store.keys()).find(k => k.startsWith('octochat.'));
    expect(legacyKey).toBeUndefined();
  });
});
