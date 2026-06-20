import { describe, expect, it, vi } from 'vitest';

import type { PersistedSession, Vault } from '../../src/core/storage-types';

// Minimal fake DerivedIdentity — real crypto not needed for restore logic tests.
const fakeDerived = {
  userId: 'abc123',
  keys: { edPriv: 'ep', edPub: 'ePub', kemPriv: 'kp', kemPub: 'kPub' },
};

vi.mock('@drakkar.software/starfish-identities', () => ({
  bootstrapRootIdentity: vi.fn(),
  mintDeviceCap: vi.fn(),
  generateMnemonic: vi.fn(),
  validateMnemonic: vi.fn(),
}));

// Stub out makeClient + ensure* so buildSession doesn't need a network.
vi.mock('../../src/sync/client', () => ({
  makeClient: vi.fn(() => ({ pull: vi.fn(), push: vi.fn() })),
  ensureProfileKeys: vi.fn().mockResolvedValue(undefined),
  ensurePseudo: vi.fn().mockResolvedValue('Alice'),
  capProviderFor: vi.fn(),
}));

vi.mock('../../src/sync/paths', () => ({
  accountScope: vi.fn(() => ({})),
  ownerScope: vi.fn(() => ({})),
}));

vi.mock('../../src/core/config', () => ({
  getSharedSpacesNamespace: vi.fn(() => undefined),
}));

import { sessionFromPersisted, activeAccountOf } from '../../src/sync/identity';

describe('sessionFromPersisted', () => {
  it('restores a linked (paired) device session when capCert + derived are present', async () => {
    const p: PersistedSession = {
      name: 'Alice',
      derived: fakeDerived,
      capCert: { kind: 'device', iss: 'issuer', sub: 'sub' } as never,
    };
    const session = await sessionFromPersisted(p);
    expect(session.userId).toBe('abc123');
    expect(session.name).toBe('Alice');
  });

  it('restores a root session from cached derived identity', async () => {
    const p: PersistedSession = { name: 'Bob', derived: { ...fakeDerived, userId: 'bob456' } };
    const session = await sessionFromPersisted(p);
    expect(session.userId).toBe('bob456');
  });

  it('throws when no derived keys and no seed', async () => {
    const p: PersistedSession = { name: 'Ghost' };
    await expect(sessionFromPersisted(p)).rejects.toThrow('neither usable derived keys nor a recovery seed');
  });
});

describe('activeAccountOf', () => {
  it('returns null for an empty vault', () => {
    const v: Vault = { accounts: [], activeId: '' };
    expect(activeAccountOf(v)).toBeNull();
  });

  it('returns the account matching activeId', () => {
    const a1: PersistedSession = { name: 'Alice', derived: fakeDerived };
    const a2: PersistedSession = { name: 'Bob', derived: { ...fakeDerived, userId: 'bob' } };
    const v: Vault = { accounts: [a1, a2], activeId: 'bob' };
    expect(activeAccountOf(v)).toBe(a2);
  });

  it('returns the first account when activeId does not match any', () => {
    const a1: PersistedSession = { name: 'Alice', derived: fakeDerived };
    const v: Vault = { accounts: [a1], activeId: 'unknown' };
    expect(activeAccountOf(v)).toBe(a1);
  });
});
