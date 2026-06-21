/**
 * Per-node keyring primitive tests (Phase 1 of E2EE tickets).
 *
 * A per-node keyring lives at `spaces/{spaceId}/objects/n/{nodeId}/_keyring`
 * (collection `nodekeyring`) and wraps a CEK to only that node's participants —
 * NOT the space-wide keyring. These tests pin:
 *
 *   Path/scope helpers (pure):
 *     - nodeKeyringName/Pull/Push resolve the right storage path, distinct from
 *       the space keyring and from objinv/objinvlog.
 *     - nodeKeyringScope is a single-collection (['nodekeyring']) READ-only scope.
 *
 *   Wrappers (delegate to the generic client.ts + starfish-keyring helpers):
 *     - ownerEnsureNodeKeyring / openNodeEncryptor / buildNodeEncryptor pass the
 *       NODE keyring path to the generic helper.
 *     - addNodeKeyringRecipient targets nodeKeyringName + default trustedAdders.
 *     - ensureNodeKeyringRecipient calls ensure BEFORE add (ordering invariant).
 *     - openNodeEncryptor propagates SpaceAccessError; buildNodeEncryptor is soft.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted — use vi.fn() inline, never module-level consts) ────────────
// Partial mock: stub only the network-touching encryptor helpers, keep the real
// addKeyringRecipientCore (which calls the mocked addCollectionRecipient below) so
// the recipient-add assertions still pin the underlying call.
vi.mock('../../src/sync/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sync/client.js')>();
  return {
    ...actual,
    openEncryptor: vi.fn().mockResolvedValue({ tag: 'enc' }),
    buildEncryptor: vi.fn().mockResolvedValue({ tag: 'enc' }),
    ownerEnsureKeyring: vi.fn().mockResolvedValue({ tag: 'enc' }),
  };
});

vi.mock('@drakkar.software/starfish-keyring', () => ({
  addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
  removeRecipient: vi.fn().mockResolvedValue({ newEpoch: 2 }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────
import {
  ownerEnsureNodeKeyring,
  openNodeEncryptor,
  buildNodeEncryptor,
  addNodeKeyringRecipient,
  ensureNodeKeyringRecipient,
  removeNodeKeyringRecipient,
} from '../../src/sync/node-keyring.js';
import {
  nodeKeyringName,
  nodeKeyringPull,
  nodeKeyringPush,
  nodeKeyringScope,
  keyringPull,
  objInvPull,
  objInvLogPull,
} from '../../src/sync/paths.js';
import { openEncryptor, buildEncryptor, ownerEnsureKeyring } from '../../src/sync/client.js';
import { addCollectionRecipient, removeRecipient } from '@drakkar.software/starfish-keyring';
import { SpaceAccessError } from '../../src/core/space-access-error.js';
import type { Session } from '../../src/sync/identity.js';

const SP = 'sp-1';
const NID = 'ticket-abc';

// Owner session: ownerEdPub === keys.edPub → ownerTrustedAdders = [keys.edPub]
const mockSession = {
  userId: 'alice-user-id',
  ownerEdPub: 'alice-ed-pub', // owner = self
  keys: { edPub: 'alice-ed-pub', edPriv: 'alice-ed-priv', kemPub: 'alice-kem-pub', kemPriv: 'alice-kem-priv' },
  contentClient: { pull: vi.fn(), push: vi.fn() },
  accountClient: { pull: vi.fn(), push: vi.fn() },
} as unknown as Session;

// Device session: ownerEdPub ≠ keys.edPub → ownerTrustedAdders = [ownerEdPub, keys.edPub]
const deviceSession = {
  userId: 'alice-device-2',
  ownerEdPub: 'alice-ed-pub', // same owner, different device
  keys: { edPub: 'device-pub', edPriv: 'dev-priv', kemPub: 'dev-kempub', kemPriv: 'dev-kempriv' },
  contentClient: { pull: vi.fn(), push: vi.fn() },
  accountClient: { pull: vi.fn(), push: vi.fn() },
} as unknown as Session;

// ── Pure path + scope helpers ──────────────────────────────────────────────────
describe('node keyring paths', () => {
  it('nodeKeyringName is the addCollectionRecipient collection arg (no /_keyring suffix)', () => {
    expect(nodeKeyringName(SP, NID)).toBe(`spaces/${SP}/objects/n/${NID}`);
  });

  it('nodeKeyringPull/Push resolve the _keyring document under the node path', () => {
    expect(nodeKeyringPull(SP, NID)).toBe(`/pull/spaces/${SP}/objects/n/${NID}/_keyring`);
    expect(nodeKeyringPush(SP, NID)).toBe(`/push/spaces/${SP}/objects/n/${NID}/_keyring`);
  });

  it('is distinct from the space keyring and from objinv/objinvlog paths', () => {
    expect(nodeKeyringPull(SP, NID)).not.toBe(keyringPull(SP));
    expect(nodeKeyringPull(SP, NID)).not.toBe(objInvPull(SP, NID));
    expect(nodeKeyringPull(SP, NID)).not.toBe(objInvLogPull(SP, NID));
  });
});

describe('nodeKeyringScope', () => {
  it('is a single-collection read-only cap scope', () => {
    const scope = nodeKeyringScope(SP, NID);
    expect(scope.collections).toEqual(['nodekeyring']);
    expect(scope.ops).toEqual(['read', 'list']);
    expect(scope.ops).not.toContain('write');
    expect(scope.paths).toEqual([`spaces/${SP}/objects/n/${NID}/**`]);
  });
});

// ── Wrappers ───────────────────────────────────────────────────────────────────
describe('ownerEnsureNodeKeyring', () => {
  beforeEach(() => vi.mocked(ownerEnsureKeyring).mockClear().mockResolvedValue({ tag: 'enc' } as never));

  it('delegates to ownerEnsureKeyring with the NODE keyring pull/push paths', async () => {
    await ownerEnsureNodeKeyring(mockSession, SP, NID);
    expect(ownerEnsureKeyring).toHaveBeenCalledWith(
      mockSession.contentClient,
      mockSession.keys,
      nodeKeyringPull(SP, NID),
      nodeKeyringPush(SP, NID),
      [mockSession.keys.edPub],
    );
  });

  it('forwards explicit trustedAdders when given', async () => {
    await ownerEnsureNodeKeyring(mockSession, SP, NID, ['root-key']);
    expect(ownerEnsureKeyring).toHaveBeenCalledWith(
      mockSession.contentClient, mockSession.keys, nodeKeyringPull(SP, NID), nodeKeyringPush(SP, NID), ['root-key'],
    );
  });
});

describe('openNodeEncryptor / buildNodeEncryptor', () => {
  beforeEach(() => {
    vi.mocked(openEncryptor).mockClear().mockResolvedValue({ tag: 'enc' } as never);
    vi.mocked(buildEncryptor).mockClear().mockResolvedValue({ tag: 'enc' } as never);
  });

  it('openNodeEncryptor passes the NODE keyring pull path + trustedAdders', async () => {
    await openNodeEncryptor(mockSession.contentClient as never, mockSession.keys, SP, NID, ['adder']);
    expect(openEncryptor).toHaveBeenCalledWith(mockSession.contentClient, mockSession.keys, nodeKeyringPull(SP, NID), ['adder']);
  });

  it('openNodeEncryptor propagates a SpaceAccessError from the generic opener', async () => {
    vi.mocked(openEncryptor).mockRejectedValueOnce(new SpaceAccessError('not a recipient'));
    await expect(openNodeEncryptor(mockSession.contentClient as never, mockSession.keys, SP, NID, ['adder'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('buildNodeEncryptor returns null (soft) when the keyring is absent', async () => {
    vi.mocked(buildEncryptor).mockResolvedValueOnce(null);
    await expect(buildNodeEncryptor(mockSession.contentClient as never, mockSession.keys, SP, NID, ['adder'])).resolves.toBeNull();
  });
});

describe('addNodeKeyringRecipient', () => {
  beforeEach(() => vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined));

  it('targets nodeKeyringName with the adder keys and default trustedAdders [edPub]', async () => {
    await addNodeKeyringRecipient(mockSession, SP, NID, { subKem: 'bob-kem', userId: 'bob' });
    expect(addCollectionRecipient).toHaveBeenCalledWith(
      mockSession.contentClient,
      nodeKeyringName(SP, NID),
      { subKem: 'bob-kem', userId: 'bob' },
      { edPriv: 'alice-ed-priv', edPub: 'alice-ed-pub', kemPriv: 'alice-kem-priv' },
      { trustedAdders: ['alice-ed-pub'] },
    );
  });

  it('swallows an "already present in epoch" error (idempotent re-invite)', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValueOnce(new Error('recipient already present in epoch'));
    await expect(addNodeKeyringRecipient(mockSession, SP, NID, { subKem: 'bob-kem' })).resolves.toBeUndefined();
  });

  it('rethrows any other error', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValueOnce(new Error('boom'));
    await expect(addNodeKeyringRecipient(mockSession, SP, NID, { subKem: 'bob-kem' })).rejects.toThrow('boom');
  });
});

describe('removeNodeKeyringRecipient (revocation + rotation)', () => {
  beforeEach(() => vi.mocked(removeRecipient).mockClear().mockResolvedValue({ newEpoch: 2 }));

  it('rotates the node keyring, dropping the named recipient(s), default trustedAdders [edPub]', async () => {
    const res = await removeNodeKeyringRecipient(mockSession, SP, NID, ['bob-kem']);
    expect(removeRecipient).toHaveBeenCalledWith(
      mockSession.contentClient,
      nodeKeyringName(SP, NID),
      ['bob-kem'],
      { edPriv: 'alice-ed-priv', edPub: 'alice-ed-pub', kemPriv: 'alice-kem-priv' },
      { trustedAdders: ['alice-ed-pub'] },
    );
    expect(res.newEpoch).toBe(2);
  });

  it('honors explicit trustedAdders (retain recipients granted by those keys)', async () => {
    await removeNodeKeyringRecipient(mockSession, SP, NID, ['bob-kem'], { trustedAdders: ['owner-key', 'bot-key'] });
    expect(removeRecipient).toHaveBeenCalledWith(
      mockSession.contentClient, nodeKeyringName(SP, NID), ['bob-kem'], expect.anything(), { trustedAdders: ['owner-key', 'bot-key'] },
    );
  });
});

describe('ensureNodeKeyringRecipient — ordering invariant', () => {
  beforeEach(() => {
    vi.mocked(ownerEnsureKeyring).mockClear().mockResolvedValue({ tag: 'enc' } as never);
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
  });

  it('calls ownerEnsureNodeKeyring BEFORE addNodeKeyringRecipient', async () => {
    await ensureNodeKeyringRecipient(mockSession, SP, NID, { subKem: 'bob-kem', userId: 'bob' });
    expect(ownerEnsureKeyring).toHaveBeenCalledTimes(1);
    expect(addCollectionRecipient).toHaveBeenCalledTimes(1);
    const ensureOrder = vi.mocked(ownerEnsureKeyring).mock.invocationCallOrder[0]!;
    const addOrder = vi.mocked(addCollectionRecipient).mock.invocationCallOrder[0]!;
    expect(ensureOrder).toBeLessThan(addOrder);
  });
});

// ── trustedAdders must be ownerTrustedAdders(session) ────────────────────────
//
// All node-keyring functions must default trustedAdders to
// ownerTrustedAdders(session) = [ownerEdPub, keys.edPub] for a paired device
// (ownerEdPub ≠ keys.edPub). Without this, a rotation by one device drops
// recipients added by another device or the owner (accidental self-eviction).
//
// Fix: import ownerTrustedAdders from identity.js and use it as the default
// in all three functions (ownerEnsureNodeKeyring, addNodeKeyringRecipient,
// removeNodeKeyringRecipient).

describe('device session uses ownerTrustedAdders (owner + device)', () => {
  beforeEach(() => {
    vi.mocked(ownerEnsureKeyring).mockClear().mockResolvedValue({ tag: 'enc' } as never);
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
    vi.mocked(removeRecipient).mockClear().mockResolvedValue({ newEpoch: 2 });
  });

  it('FAILS (pre-fix): ownerEnsureNodeKeyring with device session passes [ownerEdPub, deviceEdPub]', async () => {
    await ownerEnsureNodeKeyring(deviceSession, SP, NID);
    const trustedAdders = vi.mocked(ownerEnsureKeyring).mock.calls[0]![4] as string[];
    expect(trustedAdders).toContain('alice-ed-pub');   // owner key
    expect(trustedAdders).toContain('device-pub');      // device key
  });

  it('FAILS (pre-fix): addNodeKeyringRecipient with device session passes [ownerEdPub, deviceEdPub]', async () => {
    await addNodeKeyringRecipient(deviceSession, SP, NID, { subKem: 'r-kem' });
    const opts = vi.mocked(addCollectionRecipient).mock.calls[0]![4] as { trustedAdders: string[] };
    expect(opts.trustedAdders).toContain('alice-ed-pub');
    expect(opts.trustedAdders).toContain('device-pub');
  });

  it('FAILS (pre-fix): removeNodeKeyringRecipient with device session passes [ownerEdPub, deviceEdPub]', async () => {
    await removeNodeKeyringRecipient(deviceSession, SP, NID, ['victim-kem']);
    const opts = vi.mocked(removeRecipient).mock.calls[0]![4] as { trustedAdders: string[] };
    expect(opts.trustedAdders).toContain('alice-ed-pub');
    expect(opts.trustedAdders).toContain('device-pub');
  });

  it('owner session: trustedAdders stays [ownerEdPub] (single key, unchanged behavior)', async () => {
    await removeNodeKeyringRecipient(mockSession, SP, NID, ['victim-kem']);
    const opts = vi.mocked(removeRecipient).mock.calls[0]![4] as { trustedAdders: string[] };
    expect(opts.trustedAdders).toEqual(['alice-ed-pub']);
  });
});
