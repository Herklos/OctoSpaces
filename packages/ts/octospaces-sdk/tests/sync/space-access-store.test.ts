import { describe, it, expect, beforeEach } from 'vitest';
import { configureKv } from '../../src/core/adapters.js';
import {
  clearSpaceAccessStore,
  clearPersistedSpaceAccess,
  getSpaceAccessEntry,
  getNodeAccessEntry,
  getNodeStreamAccessEntry,
  getNodeKeyringAccessEntry,
  saveNodeKeyringAccessEntry,
  hydrateSpaceAccessStore,
  localSpaceAccessEntries,
  memberCapsFromStore,
  linkAccessFromStore,
  removeSpaceAccessEntry,
  removeNodeAccessEntry,
  saveSpaceAccessEntry,
  saveNodeAccessEntry,
  saveNodeStreamAccessEntry,
} from '../../src/sync/space-access-store.js';

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

// ── C1 regression: second hydrateSpaceAccessStore call must still merge server caps ──────────────────

describe('C1 regression — hydrateSpaceAccessStore merges server caps on every call', () => {
  beforeEach(() => {
    clearSpaceAccessStore();
    makeKvStore();
  });

  it('merges NEW server caps on the SECOND call for the same userId (was broken pre-fix)', async () => {
    // First call with no caps — simulates initial sign-in before any space invite arrives.
    await hydrateSpaceAccessStore('user-c1', {}, {});
    expect(getSpaceAccessEntry('sp-new')).toBeNull();

    // Peer grants access; client re-syncs. Second call carries the newly-granted cap.
    // Before the fix: the early-return skipped the merge → cap never reached the cache
    // → SpaceAccessError until sign-out/in.
    await hydrateSpaceAccessStore('user-c1', { 'sp-new': 'cap-newly-granted' }, {});
    expect(getSpaceAccessEntry('sp-new')).toEqual({ kind: 'member', cap: 'cap-newly-granted' });
  });

  it('server caps overwrite stale local caps ("server wins") on re-hydrate', async () => {
    await hydrateSpaceAccessStore('user-c1b', { 'sp-1': 'cap-v1' }, {});
    // Server promotes the cap (e.g. write → admin) — the re-sync call must apply it.
    await hydrateSpaceAccessStore('user-c1b', { 'sp-1': 'cap-v2' }, {});
    expect(getSpaceAccessEntry('sp-1')).toEqual({ kind: 'member', cap: 'cap-v2' });
  });

  it('merges new link access on a second call', async () => {
    await hydrateSpaceAccessStore('user-c1c', {}, {});
    await hydrateSpaceAccessStore('user-c1c', {}, {
      'sp-link': { cap: { kind: 'member' }, key: 'ek', write: true },
    });
    const e = getSpaceAccessEntry('sp-link');
    expect(e?.kind).toBe('link');
    if (e?.kind === 'link') expect(e.key).toBe('ek');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Per-node KEYRING entry (E2EE tickets) ─────────────────────────────────

  it('save + get node-keyring entry round-trip (distinct from content/stream)', () => {
    clearSpaceAccessStore();
    saveNodeAccessEntry('sp-1', 'n-7', { kind: 'member', cap: '{"content":1}' });
    saveNodeStreamAccessEntry('sp-1', 'n-7', { kind: 'member', cap: '{"stream":1}' });
    saveNodeKeyringAccessEntry('sp-1', 'n-7', { kind: 'member', cap: '{"keyring":1}' });
    expect(getNodeKeyringAccessEntry('sp-1', 'n-7')).toEqual({ kind: 'member', cap: '{"keyring":1}' });
    // The three entries are independent.
    expect(getNodeAccessEntry('sp-1', 'n-7')).toEqual({ kind: 'member', cap: '{"content":1}' });
    expect(getNodeStreamAccessEntry('sp-1', 'n-7')).toEqual({ kind: 'member', cap: '{"stream":1}' });
  });

  it('removeNodeAccessEntry also removes the sibling :keyring entry', () => {
    clearSpaceAccessStore();
    saveNodeAccessEntry('sp-1', 'n-7', { kind: 'member', cap: '{"content":1}' });
    saveNodeKeyringAccessEntry('sp-1', 'n-7', { kind: 'member', cap: '{"keyring":1}' });
    removeNodeAccessEntry('sp-1', 'n-7');
    expect(getNodeKeyringAccessEntry('sp-1', 'n-7')).toBeNull();
  });

  // ── clearPersistedSpaceAccess ─────────────────────────────────────────────

  it('clearPersistedSpaceAccess removes the kv blob and wipes in-memory cache when userId is active', async () => {
    await hydrateSpaceAccessStore('user-X', { 'sp-1': 'cap' }, {});
    expect(store.has('octospaces.spaceaccess.user-X')).toBe(true);
    expect(getSpaceAccessEntry('sp-1')).not.toBeNull();

    clearPersistedSpaceAccess('user-X');
    await Promise.resolve(); // kvRemove is fire-and-forget

    expect(store.has('octospaces.spaceaccess.user-X')).toBe(false);
    expect(getSpaceAccessEntry('sp-1')).toBeNull();
  });

  it('clearPersistedSpaceAccess removes the kv blob but leaves in-memory cache intact for a different (non-active) userId', async () => {
    await hydrateSpaceAccessStore('user-active', { 'sp-active': 'cap-active' }, {});
    store.set('octospaces.spaceaccess.user-old', JSON.stringify({ 'sp-old': { kind: 'member', cap: 'stale' } }));

    clearPersistedSpaceAccess('user-old');
    await Promise.resolve();

    expect(store.has('octospaces.spaceaccess.user-old')).toBe(false);
    expect(getSpaceAccessEntry('sp-active')).not.toBeNull();
  });
});
