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
vi.mock('./client.js', () => ({
  openEncryptor: vi.fn().mockResolvedValue({ tag: 'enc' }),
  buildEncryptor: vi.fn().mockResolvedValue({ tag: 'enc' }),
  ownerEnsureKeyring: vi.fn().mockResolvedValue({ tag: 'enc' }),
}));

vi.mock('@drakkar.software/starfish-keyring', () => ({
  addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
  removeRecipient: vi.fn().mockResolvedValue({ newEpoch: 2 }),
  listRecipients: vi.fn().mockResolvedValue({ epoch: 1, recipients: [] }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────
import {
  ownerEnsureNodeKeyring,
  openNodeEncryptor,
  buildNodeEncryptor,
  addNodeKeyringRecipient,
  ensureNodeKeyringRecipient,
  removeNodeKeyringRecipient,
  listNodeKeyringRecipients,
} from './node-keyring.js';
import {
  nodeKeyringName,
  nodeKeyringPull,
  nodeKeyringPush,
  nodeKeyringScope,
  keyringPull,
  objInvPull,
  objInvLogPull,
} from './paths.js';
import { openEncryptor, buildEncryptor, ownerEnsureKeyring } from './client.js';
import { addCollectionRecipient, removeRecipient, listRecipients } from '@drakkar.software/starfish-keyring';
import { SpaceAccessError } from '../core/space-access-error.js';
import type { Session } from './identity.js';

const SP = 'sp-1';
const NID = 'ticket-abc';

const mockSession = {
  userId: 'alice-user-id',
  keys: { edPub: 'alice-ed-pub', edPriv: 'alice-ed-priv', kemPub: 'alice-kem-pub', kemPriv: 'alice-kem-priv' },
  chatClient: { pull: vi.fn(), push: vi.fn() },
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
      mockSession.chatClient,
      mockSession.keys,
      nodeKeyringPull(SP, NID),
      nodeKeyringPush(SP, NID),
      [mockSession.keys.edPub],
    );
  });

  it('forwards explicit trustedAdders when given', async () => {
    await ownerEnsureNodeKeyring(mockSession, SP, NID, ['root-key']);
    expect(ownerEnsureKeyring).toHaveBeenCalledWith(
      mockSession.chatClient, mockSession.keys, nodeKeyringPull(SP, NID), nodeKeyringPush(SP, NID), ['root-key'],
    );
  });
});

describe('openNodeEncryptor / buildNodeEncryptor', () => {
  beforeEach(() => {
    vi.mocked(openEncryptor).mockClear().mockResolvedValue({ tag: 'enc' } as never);
    vi.mocked(buildEncryptor).mockClear().mockResolvedValue({ tag: 'enc' } as never);
  });

  it('openNodeEncryptor passes the NODE keyring pull path + trustedAdders', async () => {
    await openNodeEncryptor(mockSession.chatClient as never, mockSession.keys, SP, NID, ['adder']);
    expect(openEncryptor).toHaveBeenCalledWith(mockSession.chatClient, mockSession.keys, nodeKeyringPull(SP, NID), ['adder']);
  });

  it('openNodeEncryptor propagates a SpaceAccessError from the generic opener', async () => {
    vi.mocked(openEncryptor).mockRejectedValueOnce(new SpaceAccessError('not a recipient'));
    await expect(openNodeEncryptor(mockSession.chatClient as never, mockSession.keys, SP, NID, ['adder'])).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('buildNodeEncryptor returns null (soft) when the keyring is absent', async () => {
    vi.mocked(buildEncryptor).mockResolvedValueOnce(null);
    await expect(buildNodeEncryptor(mockSession.chatClient as never, mockSession.keys, SP, NID, ['adder'])).resolves.toBeNull();
  });
});

describe('addNodeKeyringRecipient', () => {
  beforeEach(() => vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined));

  it('targets nodeKeyringName with the adder keys and default trustedAdders [edPub]', async () => {
    await addNodeKeyringRecipient(mockSession, SP, NID, { subKem: 'bob-kem', userId: 'bob' });
    expect(addCollectionRecipient).toHaveBeenCalledWith(
      mockSession.chatClient,
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
      mockSession.chatClient,
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
      mockSession.chatClient, nodeKeyringName(SP, NID), ['bob-kem'], expect.anything(), { trustedAdders: ['owner-key', 'bot-key'] },
    );
  });
});

describe('listNodeKeyringRecipients', () => {
  beforeEach(() => vi.mocked(listRecipients).mockClear().mockResolvedValue({ epoch: 3, recipients: [{ subKem: 'k', addedBy: 'a', addedAt: 1 }] }));

  it('lists provenance-filtered recipients of the node keyring', async () => {
    const res = await listNodeKeyringRecipients(mockSession, SP, NID);
    expect(listRecipients).toHaveBeenCalledWith(mockSession.chatClient, nodeKeyringName(SP, NID), { trustedAdders: ['alice-ed-pub'] });
    expect(res).toEqual({ epoch: 3, recipients: [{ subKem: 'k', addedBy: 'a', addedAt: 1 }] });
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
