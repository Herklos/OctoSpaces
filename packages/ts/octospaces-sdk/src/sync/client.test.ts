/**
 * client.ts — unit tests for ownerEnsureKeyring and related helpers.
 *
 * Tests cover:
 *   ownerEnsureKeyring CAS retry on hash-conflict.
 *     When two devices concurrently create the same keyring, the second push
 *     fails with a "conflict" error (stale hash = null vs current hash).
 *     The function must retry: re-pull the now-existing keyring, skip create,
 *     and open the encryptor using the server's version.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { Keyring } from '@drakkar.software/starfish-keyring';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@drakkar.software/starfish-keyring', () => ({
  createKeyring: vi.fn().mockResolvedValue({ keyring: { epochs: [{}] } }),
  createKeyringEncryptor: vi.fn().mockResolvedValue({ tag: 'enc' }),
  addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
  removeRecipient: vi.fn().mockResolvedValue({ newEpoch: 1 }),
  hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
  bytesToHex: vi.fn().mockReturnValue('aabbcc'),
}));

vi.mock('@noble/curves/ed25519.js', () => ({
  ed25519: { sign: vi.fn().mockReturnValue(new Uint8Array(64)), getPublicKey: vi.fn().mockReturnValue(new Uint8Array(32)) },
  x25519: { getPublicKey: vi.fn().mockReturnValue(new Uint8Array(32)) },
}));

vi.mock('../core/config.js', () => ({
  getSyncBase: vi.fn().mockReturnValue('https://sync.example.com'),
  getSyncNamespace: vi.fn().mockReturnValue('ns'),
  getSyncPrefix: vi.fn().mockReturnValue('/v1'),
  getOnServerReachable: vi.fn().mockReturnValue(undefined),
}));

vi.mock('./fetch-timeout.js', () => ({
  fetchWithTimeout: vi.fn().mockReturnValue(() => Promise.resolve({ ok: false, status: 404 })),
}));

vi.mock('./pull-cache.js', () => ({
  pullCache: vi.fn().mockReturnValue(undefined),
  PULL_CACHE_MAX_AGE_MS: 0,
}));

vi.mock('./profile-cache.js', () => ({
  cacheProfile: vi.fn(),
  loadCachedProfile: vi.fn().mockResolvedValue(null),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { ownerEnsureKeyring } from './client.js';
import { createKeyring, createKeyringEncryptor } from '@drakkar.software/starfish-keyring';

// ── Helpers ───────────────────────────────────────────────────────────────────

const devKeys = {
  edPriv: 'ed-priv-hex',
  edPub: 'ed-pub-hex',
  kemPriv: 'kem-priv-hex',
  kemPub: 'kem-pub-hex',
};

const stubKeyring: Keyring = { epochs: [{}] } as unknown as Keyring;

function makeClient(opts: {
  pullSequence?: Array<{ data: unknown; hash: string | null } | null>;
  pushThrowOnce?: Error;
}): StarfishClient {
  const pulls = opts.pullSequence ? [...opts.pullSequence] : [];
  let throwOnce = opts.pushThrowOnce ?? null;
  return {
    pull: vi.fn().mockImplementation(() => {
      if (pulls.length) return Promise.resolve(pulls.shift()!);
      return Promise.resolve({ data: stubKeyring, hash: 'h1' });
    }),
    push: vi.fn().mockImplementation((_path: unknown, _data: unknown, _hash: unknown) => {
      if (throwOnce) {
        const err = throwOnce;
        throwOnce = null;
        return Promise.reject(err);
      }
      return Promise.resolve();
    }),
  } as unknown as StarfishClient;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ownerEnsureKeyring — baseline', () => {
  beforeEach(() => {
    vi.mocked(createKeyring).mockClear();
    vi.mocked(createKeyringEncryptor).mockClear();
  });

  it('creates the keyring when none exists (pull returns null)', async () => {
    const client = makeClient({ pullSequence: [null] });
    await ownerEnsureKeyring(client, devKeys, '/pull/path', '/push/path');
    expect(createKeyring).toHaveBeenCalledOnce();
    expect(client.push).toHaveBeenCalledOnce();
    expect(createKeyringEncryptor).toHaveBeenCalledOnce();
  });

  it('opens the existing keyring without creating when already present', async () => {
    const client = makeClient({ pullSequence: [{ data: stubKeyring, hash: 'h1' }] });
    await ownerEnsureKeyring(client, devKeys, '/pull/path', '/push/path');
    expect(createKeyring).not.toHaveBeenCalled();
    expect(client.push).not.toHaveBeenCalled();
    expect(createKeyringEncryptor).toHaveBeenCalledOnce();
  });
});

// ── CAS retry on hash conflict ────────────────────────────────────────────────
//
// ownerEnsureKeyring pushes with `krRes?.hash ?? null` — if both pulls returned
// null, two concurrent devices race. The second push fails (conflict / stale
// hash). Without a retry loop the function throws; the owner cannot create their
// keyring and the invite flow is broken.
//
// Fix: catch hash-conflict errors, re-pull, and if the keyring now exists, open
// it directly (don't overwrite). If it still doesn't exist, retry the create
// (up to MAX_RETRIES, default 3).

describe('ownerEnsureKeyring retries on hash conflict', () => {
  beforeEach(() => {
    vi.mocked(createKeyring).mockClear();
    vi.mocked(createKeyringEncryptor).mockClear();
  });

  it('FAILS (pre-fix): retries and succeeds when push fails with a conflict error', async () => {
    // First pull: keyring absent (null)
    // First push: throws conflict (concurrent device won the race)
    // Second pull (retry): keyring now exists
    // Second open: succeeds without creating
    const conflictErr = new Error('409 Conflict: hash mismatch');
    const client = makeClient({
      pullSequence: [
        null,                                        // first pull → absent
        { data: stubKeyring, hash: 'h-winner' },     // retry pull → present
      ],
      pushThrowOnce: conflictErr,
    });

    await expect(
      ownerEnsureKeyring(client, devKeys, '/pull/path', '/push/path'),
    ).resolves.toBeDefined();

    // Must NOT have created a second keyring after the retry
    expect(createKeyring).toHaveBeenCalledTimes(1); // created once before the race
    expect(createKeyringEncryptor).toHaveBeenCalledOnce();
  });

  it('propagates a non-conflict error from push (e.g. network timeout)', async () => {
    const netErr = new Error('network timeout');
    const client = makeClient({
      pullSequence: [null],
      pushThrowOnce: netErr,
    });
    await expect(
      ownerEnsureKeyring(client, devKeys, '/pull/path', '/push/path'),
    ).rejects.toThrow('network timeout');
  });
});
