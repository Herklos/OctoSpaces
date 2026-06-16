import { describe, it, expect, beforeEach } from 'vitest';
import { configureKv } from '../core/adapters.js';
import {
  clearSpaceAccessStore,
  getSpaceAccessEntry,
  getNodeAccessEntry,
  getNodeStreamAccessEntry,
  hydrateSpaceAccessStore,
  localSpaceAccessEntries,
  memberCapsFromStore,
  linkAccessFromStore,
  removeSpaceAccessEntry,
  removeNodeAccessEntry,
  saveSpaceAccessEntry,
  saveNodeAccessEntry,
  saveNodeStreamAccessEntry,
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

  it('save + get link round-trip (no KEM — back-compat)', () => {
    saveSpaceAccessEntry('sp-pub', { kind: 'link', cap: { kind: 'member' }, key: 'hexkey', write: true });
    const entry = getSpaceAccessEntry('sp-pub');
    expect(entry?.kind).toBe('link');
    if (entry?.kind === 'link') {
      expect(entry.key).toBe('hexkey');
      expect(entry.write).toBe(true);
      expect(entry.kemPriv).toBeUndefined();
    }
  });

  it('save + get link round-trip with kemPriv/kemPub (FIX C)', () => {
    saveSpaceAccessEntry('sp-enc', {
      kind: 'link', cap: { kind: 'member' }, key: 'hexkey',
      kemPriv: 'eph-kempriv', kemPub: 'eph-kempub', write: false,
    });
    const entry = getSpaceAccessEntry('sp-enc');
    expect(entry?.kind).toBe('link');
    if (entry?.kind === 'link') {
      expect(entry.kemPriv).toBe('eph-kempriv');
      expect(entry.kemPub).toBe('eph-kempub');
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

  it('server link access populates link entries (back-compat, no KEM)', async () => {
    clearSpaceAccessStore();
    await hydrateSpaceAccessStore('user2', {}, {
      'sp-link': { cap: { kind: 'member' }, key: 'privhex', write: false },
    });
    const entry = getSpaceAccessEntry('sp-link');
    expect(entry?.kind).toBe('link');
    if (entry?.kind === 'link') {
      expect(entry.write).toBe(false);
      expect(entry.kemPriv).toBeUndefined();
    }
  });

  it('FIX C: server link access populates kemPriv/kemPub when provided', async () => {
    clearSpaceAccessStore();
    await hydrateSpaceAccessStore('user3', {}, {
      'sp-enc-link': { cap: { kind: 'member' }, key: 'privhex', kemPriv: 'eph-kempriv', kemPub: 'eph-kempub', write: true },
    });
    const entry = getSpaceAccessEntry('sp-enc-link');
    expect(entry?.kind).toBe('link');
    if (entry?.kind === 'link') {
      expect(entry.kemPriv).toBe('eph-kempriv');
      expect(entry.kemPub).toBe('eph-kempub');
    }
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

  it('FIX C: linkAccessFromStore preserves kemPriv/kemPub for link entries', () => {
    saveSpaceAccessEntry('sp-kem', {
      kind: 'link', cap: { iss: 'abc' }, key: 'k',
      kemPriv: 'eph-kempriv', kemPub: 'eph-kempub', write: false,
    });
    const links = linkAccessFromStore();
    expect(links['sp-kem']?.kemPriv).toBe('eph-kempriv');
    expect(links['sp-kem']?.kemPub).toBe('eph-kempub');
  });

  it('localSpaceAccessEntries returns a snapshot', () => {
    saveSpaceAccessEntry('sp-snap', { kind: 'member', cap: 'c' });
    const snap = localSpaceAccessEntries();
    expect(snap).toHaveProperty('sp-snap');
  });

  // ── removeNodeAccessEntry also clears :stream sibling ──────────────────────

  it('removeNodeAccessEntry also removes the sibling :stream entry (prevents orphaned stream caps)', () => {
    clearSpaceAccessStore();
    saveNodeAccessEntry('sp-1', 'n-42', { kind: 'member', cap: '{"cap":1}' });
    saveNodeStreamAccessEntry('sp-1', 'n-42', { kind: 'member', cap: '{"stream":1}' });
    expect(getNodeAccessEntry('sp-1', 'n-42')).not.toBeNull();
    expect(getNodeStreamAccessEntry('sp-1', 'n-42')).not.toBeNull();

    removeNodeAccessEntry('sp-1', 'n-42');
    expect(getNodeAccessEntry('sp-1', 'n-42')).toBeNull();
    expect(getNodeStreamAccessEntry('sp-1', 'n-42')).toBeNull();
  });

  it('removeNodeAccessEntry with no stream sibling is a safe no-op for the stream key', () => {
    clearSpaceAccessStore();
    saveNodeAccessEntry('sp-1', 'n-99', { kind: 'member', cap: '{"cap":1}' });
    removeNodeAccessEntry('sp-1', 'n-99');
    expect(getNodeAccessEntry('sp-1', 'n-99')).toBeNull();
    expect(getNodeStreamAccessEntry('sp-1', 'n-99')).toBeNull();
  });

  it('removeNodeAccessEntry does not remove stream entries for other nodes in the same space', () => {
    clearSpaceAccessStore();
    saveNodeStreamAccessEntry('sp-1', 'n-other', { kind: 'member', cap: '{"stream":2}' });
    saveNodeAccessEntry('sp-1', 'n-42', { kind: 'member', cap: '{"cap":1}' });
    saveNodeStreamAccessEntry('sp-1', 'n-42', { kind: 'member', cap: '{"stream":1}' });

    removeNodeAccessEntry('sp-1', 'n-42');
    expect(getNodeStreamAccessEntry('sp-1', 'n-other')).not.toBeNull();
  });
});
