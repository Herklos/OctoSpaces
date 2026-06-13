import { describe, it, expect, beforeEach } from 'vitest';
import { configureKv } from '../core/adapters.js';
import {
  clearSpaceAccessStore,
  getSpaceAccessEntry,
  hydrateSpaceAccessStore,
  localSpaceAccessEntries,
  memberCapsFromStore,
  linkAccessFromStore,
  removeSpaceAccessEntry,
  saveSpaceAccessEntry,
} from './space-access-store.js';

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

describe('space-access-store', () => {
  beforeEach(() => {
    clearSpaceAccessStore();
    makeKvStore();
  });

  it('returns null for unknown space', () => {
    expect(getSpaceAccessEntry('sp-unknown')).toBeNull();
  });

  it('save + get member round-trip', () => {
    saveSpaceAccessEntry('sp-test', { kind: 'member', cap: '{"kind":"member"}' });
    expect(getSpaceAccessEntry('sp-test')).toEqual({ kind: 'member', cap: '{"kind":"member"}' });
  });

  it('save + get link round-trip', () => {
    saveSpaceAccessEntry('sp-pub', { kind: 'link', cap: { kind: 'member' }, key: 'hexkey', write: true });
    const entry = getSpaceAccessEntry('sp-pub');
    expect(entry?.kind).toBe('link');
    if (entry?.kind === 'link') {
      expect(entry.key).toBe('hexkey');
      expect(entry.write).toBe(true);
    }
  });

  it('remove drops a stored entry', () => {
    saveSpaceAccessEntry('sp-abc', { kind: 'member', cap: 'capjson' });
    removeSpaceAccessEntry('sp-abc');
    expect(getSpaceAccessEntry('sp-abc')).toBeNull();
  });

  it('clear wipes all entries', () => {
    saveSpaceAccessEntry('sp-1', { kind: 'member', cap: 'a' });
    saveSpaceAccessEntry('sp-2', { kind: 'member', cap: 'b' });
    clearSpaceAccessStore();
    expect(getSpaceAccessEntry('sp-1')).toBeNull();
    expect(getSpaceAccessEntry('sp-2')).toBeNull();
  });

  it('hydrate loads caps from kv', async () => {
    const caps = { 'sp-x': '{"kind":"member","sub":"abc"}' };
    store.set('octospaces.spaceaccess.user123', JSON.stringify({
      'sp-x': { kind: 'member', cap: '{"kind":"member","sub":"abc"}' },
    }));
    clearSpaceAccessStore();
    await hydrateSpaceAccessStore('user123', {}, {});
    expect(getSpaceAccessEntry('sp-x')).toEqual({ kind: 'member', cap: '{"kind":"member","sub":"abc"}' });
    void caps;
  });

  it('server caps override local on hydrate', async () => {
    // Local has old value
    store.set('octospaces.spaceaccess.user1', JSON.stringify({
      'sp-a': { kind: 'member', cap: 'old-cap' },
    }));
    clearSpaceAccessStore();
    await hydrateSpaceAccessStore('user1', { 'sp-a': 'new-cap' }, {});
    expect(getSpaceAccessEntry('sp-a')).toEqual({ kind: 'member', cap: 'new-cap' });
  });

  it('server link access populates link entries', async () => {
    clearSpaceAccessStore();
    await hydrateSpaceAccessStore('user2', {}, {
      'sp-link': { cap: { kind: 'member' }, key: 'privhex', write: false },
    });
    const entry = getSpaceAccessEntry('sp-link');
    expect(entry?.kind).toBe('link');
    if (entry?.kind === 'link') expect(entry.write).toBe(false);
  });

  it('uses octospaces. prefix for kv key (not octochat.)', async () => {
    saveSpaceAccessEntry('sp-test', { kind: 'member', cap: '{"kind":"member"}' });
    store.set('octospaces.spaceaccess.user-abc', JSON.stringify({
      'sp-test': { kind: 'member', cap: '{"kind":"member"}' },
    }));
    clearSpaceAccessStore();
    await hydrateSpaceAccessStore('user-abc', {}, {});
    const legacyKey = Array.from(store.keys()).find((k) => k.startsWith('octochat.'));
    expect(legacyKey).toBeUndefined();
  });

  it('memberCapsFromStore returns only member entries', () => {
    saveSpaceAccessEntry('sp-m', { kind: 'member', cap: 'cap1' });
    saveSpaceAccessEntry('sp-l', { kind: 'link', cap: {}, key: 'k', write: false });
    const caps = memberCapsFromStore();
    expect(caps).toHaveProperty('sp-m', 'cap1');
    expect(caps).not.toHaveProperty('sp-l');
  });

  it('linkAccessFromStore returns only link entries', () => {
    saveSpaceAccessEntry('sp-m', { kind: 'member', cap: 'cap1' });
    saveSpaceAccessEntry('sp-l', { kind: 'link', cap: { iss: 'abc' }, key: 'k', write: true });
    const links = linkAccessFromStore();
    expect(links).toHaveProperty('sp-l');
    expect(links['sp-l']?.write).toBe(true);
    expect(links).not.toHaveProperty('sp-m');
  });

  it('localSpaceAccessEntries returns a snapshot', () => {
    saveSpaceAccessEntry('sp-snap', { kind: 'member', cap: 'c' });
    const snap = localSpaceAccessEntries();
    expect(snap).toHaveProperty('sp-snap');
  });
});
