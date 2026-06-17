/**
 * revokeSpaceAccess — full space-tier eviction (the space equivalent of
 * revokeNodeAccess for the per-node tier).
 *
 * Three pillars, mirroring nodes.revocation.test.ts:
 *   1. saveSpaceInviteEntry / getSpaceInviteEntry / serialize+hydrate — owner retains the
 *      member's {edPub, kemPub, cap nonce} at invite time.
 *   2. revokeSpaceAccess — rotates the space keyring (forward secrecy) + submits a signed
 *      RevocationList for the member's cap, then drops them from the roster.
 *   3. inviteToSpace / createSpaceInviteLink auto-store the invite entry so revocation is
 *      always possible without out-of-band nonce tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn().mockImplementation(
    // Return a mock CapCert with nonce + exp so the invite store can retain them.
    (_edPriv: string, _edPub: string, _subject: unknown, _aud: string, scope: { collections: string[] }) =>
      Promise.resolve({
        kind: 'member' as const,
        sub: 'invitee-edpub',
        nonce: `nonce-${scope.collections[0]}`,
        exp: 9_999_999,
        iss: 'owner-edpub',
      }),
  ),
  evictMember: vi.fn().mockResolvedValue({ newEpoch: 2, revoked: true }),
}));

vi.mock('@drakkar.software/starfish-keyring', async (importOriginal) => {
  const original = await importOriginal<typeof import('@drakkar.software/starfish-keyring')>();
  return {
    ...original,
    addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
    hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
    bytesToHex: vi.fn().mockReturnValue('ab'.repeat(32)),
    // Stubs so ownerEnsureKeyring (reached via the real ensureSpaceKeyringRecipient)
    // can complete without real hex crypto.
    createKeyring: vi.fn().mockResolvedValue({ keyring: { epochs: [] } }),
    createKeyringEncryptor: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@noble/curves/ed25519.js', () => ({
  ed25519: {
    sign: vi.fn().mockReturnValue(new Uint8Array(64).fill(0xab)),
    verify: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/paths.js')>();
  return {
    ...original,
    userIdFromEdPub: vi.fn().mockResolvedValue('requester-user-id'),
  };
});

vi.mock('../sync/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/client.js')>();
  return {
    ...original,
    // makeClient override so internal pull/push calls don't hit a real server.
    makeClient: vi.fn().mockReturnValue({
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock('../sync/space-access-store.js', () => ({
  saveSpaceAccessEntry: vi.fn(),
  getSpaceAccessEntry: vi.fn().mockReturnValue(null),
  hydrateSpaceAccessStore: vi.fn(),
  localSpaceAccessEntries: vi.fn().mockReturnValue({}),
}));

vi.mock('../sync/identity.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/identity.js')>();
  return {
    ...original,
    ownerTrustedAdders: vi.fn().mockReturnValue(['owner-edpub']),
  };
});

vi.mock('./registry.js', () => ({
  addSpaceMember: vi.fn().mockResolvedValue(undefined),
  removeSpaceMember: vi.fn().mockResolvedValue(undefined),
  readSpaces: vi.fn().mockResolvedValue({ spaces: [], caps: {}, pubAccess: {} }),
  buildSpace: vi.fn().mockImplementation((id: string, name: string) => ({ id, name, short: 'SP', members: 1 })),
  updateSpacesDoc: vi.fn().mockResolvedValue(undefined),
  addJoinedSpaceWithCap: vi.fn().mockResolvedValue(undefined),
  addJoinedSpaceWithLinkAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sync/account-seal.js', () => ({
  sealToSelf: vi.fn().mockResolvedValue({ encrypted: true }),
  unsealFromSelf: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('@drakkar.software/starfish-identities', () => ({
  generateDeviceKeys: vi.fn().mockReturnValue({
    edPub: 'eph-edpub',
    edPriv: 'eph-edpriv',
    kemPub: 'eph-kempub',
    kemPriv: 'eph-kempriv',
  }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import {
  saveSpaceInviteEntry,
  getSpaceInviteEntry,
  clearSpaceInviteStore,
  serializeSpaceInviteStore,
  hydrateSpaceInviteStore,
  revokeSpaceAccess,
  inviteToSpace,
  createSpaceInviteLink,
} from './members.js';
import { evictMember } from '@drakkar.software/starfish-sharing';
import { keyringName } from '../sync/paths.js';
import { ownerTrustedAdders } from '../sync/identity.js';
import { removeSpaceMember } from './registry.js';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { Session } from '../sync/identity.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SP = 'sp-1';
const UID = 'requester-user-id';

function makeSession(): Session {
  return {
    userId: 'alice',
    ownerEdPub: 'owner-edpub',
    keys: { edPriv: 'owner-edpriv', edPub: 'owner-edpub', kemPriv: 'owner-kempriv', kemPub: 'owner-kempub' },
    chatClient: {
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    } as unknown as StarfishClient,
    accountClient: {
      pull: vi.fn().mockResolvedValue({ data: { v: 1, spaces: [], caps: {}, pubAccess: {} }, hash: null }),
      push: vi.fn().mockResolvedValue(undefined),
    } as unknown as StarfishClient,
  } as unknown as Session;
}

const joinReq = JSON.stringify({
  edPub: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  kemPub: 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe',
  userId: UID,
  kemSig: 'ab'.repeat(64),
});

// ── Store roundtrip ────────────────────────────────────────────────────────────

describe('space invite store (owner-side nonce tracking)', () => {
  beforeEach(() => clearSpaceInviteStore());

  it('returns null when no entry is stored', () => {
    expect(getSpaceInviteEntry(SP, UID)).toBeNull();
  });

  it('roundtrips a stored invite entry', () => {
    const entry = { edPub: 'abc', kemPub: 'def', cap: { nonce: 'c-nonce', exp: 1000 } };
    saveSpaceInviteEntry(SP, UID, entry);
    expect(getSpaceInviteEntry(SP, UID)).toEqual(entry);
  });

  it('scopes entries by spaceId and userId independently', () => {
    saveSpaceInviteEntry('sp-a', UID, { edPub: 'a', kemPub: 'x', cap: { nonce: 'na', exp: 1 } });
    saveSpaceInviteEntry('sp-b', UID, { edPub: 'b', kemPub: 'y', cap: { nonce: 'nb', exp: 2 } });
    expect(getSpaceInviteEntry('sp-a', UID)?.edPub).toBe('a');
    expect(getSpaceInviteEntry('sp-b', UID)?.edPub).toBe('b');
    expect(getSpaceInviteEntry('sp-c', UID)).toBeNull();
  });

  it('clearSpaceInviteStore wipes all entries', () => {
    saveSpaceInviteEntry(SP, UID, { edPub: 'x', kemPub: 'y', cap: { nonce: 'n', exp: 1 } });
    clearSpaceInviteStore();
    expect(getSpaceInviteEntry(SP, UID)).toBeNull();
  });

  it('serialize → hydrate roundtrips entries across a simulated reload', () => {
    saveSpaceInviteEntry(SP, UID, { edPub: 'x', kemPub: 'y', cap: { nonce: 'n', exp: 5 } });
    const snapshot = serializeSpaceInviteStore();
    clearSpaceInviteStore();
    expect(getSpaceInviteEntry(SP, UID)).toBeNull();
    hydrateSpaceInviteStore(snapshot);
    expect(getSpaceInviteEntry(SP, UID)).toEqual({ edPub: 'x', kemPub: 'y', cap: { nonce: 'n', exp: 5 } });
  });

  it('hydrate is additive (does not clear existing entries)', () => {
    saveSpaceInviteEntry(SP, 'user-a', { edPub: 'a', kemPub: 'ka', cap: { nonce: 'na', exp: 1 } });
    hydrateSpaceInviteStore([[`${SP}:user-b`, { edPub: 'b', kemPub: 'kb', cap: { nonce: 'nb', exp: 2 } }]]);
    expect(getSpaceInviteEntry(SP, 'user-a')?.edPub).toBe('a');
    expect(getSpaceInviteEntry(SP, 'user-b')?.edPub).toBe('b');
  });
});

// ── revokeSpaceAccess ───────────────────────────────────────────────────────────

describe('revokeSpaceAccess', () => {
  beforeEach(() => {
    clearSpaceInviteStore();
    vi.mocked(evictMember).mockClear().mockResolvedValue({ newEpoch: 2, revoked: true });
    vi.mocked(removeSpaceMember).mockClear().mockResolvedValue(undefined);
    vi.mocked(ownerTrustedAdders).mockReturnValue(['owner-edpub']);
  });

  it('throws when no stored invite entry for the user', async () => {
    const session = makeSession();
    await expect(
      revokeSpaceAccess(session, SP, 'unknown-user', { generation: 1, submitRevocation: vi.fn() }),
    ).rejects.toThrow(/no stored invite|not found|unknown-user/i);
  });

  it('calls evictMember with keyringName, stored member info, and rotate+revoke', async () => {
    const session = makeSession();
    saveSpaceInviteEntry(SP, UID, {
      edPub: 'req-edpub',
      kemPub: 'req-kempub',
      cap: { nonce: 'cap-nonce-b64', exp: 9000 },
    });
    const submitRevocation = vi.fn().mockResolvedValue(undefined);

    await revokeSpaceAccess(session, SP, UID, { generation: 5, submitRevocation });

    expect(evictMember).toHaveBeenCalledWith(
      session.chatClient,
      expect.objectContaining({
        keyringCollection: keyringName(SP),
        membersCollection: keyringName(SP),
        member: {
          sub: 'req-edpub',
          nonce: 'cap-nonce-b64',
          exp: 9000,
          subKem: 'req-kempub',
        },
        issEdPubHex: session.keys.edPub,
        issEdPrivHex: session.keys.edPriv,
        generation: 5,
        submitRevocation,
      }),
      { rotate: true, revoke: true },
    );
  });

  it('passes ownerTrustedAdders to evictMember as trustedAdders', async () => {
    const session = makeSession();
    vi.mocked(ownerTrustedAdders).mockReturnValue(['owner-edpub', 'device-pub']);
    saveSpaceInviteEntry(SP, UID, { edPub: 'ep', kemPub: 'kp', cap: { nonce: 'c', exp: 1 } });
    await revokeSpaceAccess(session, SP, UID, { generation: 1, submitRevocation: vi.fn() });
    const params = vi.mocked(evictMember).mock.calls[0]![1];
    expect(params.trustedAdders).toEqual(['owner-edpub', 'device-pub']);
  });

  it('carries caller-supplied priorRevoked into the RevocationList', async () => {
    const session = makeSession();
    saveSpaceInviteEntry(SP, UID, { edPub: 'ep', kemPub: 'kp', cap: { nonce: 'c', exp: 1 } });
    const callerPrior = [{ sub: 'other', nonce: 'old-nonce', exp: 0 }];
    await revokeSpaceAccess(session, SP, UID, { generation: 1, priorRevoked: callerPrior, submitRevocation: vi.fn() });
    const params = vi.mocked(evictMember).mock.calls[0]![1];
    expect(params.priorRevoked).toEqual(expect.arrayContaining([{ sub: 'other', nonce: 'old-nonce', exp: 0 }]));
  });

  it('removes the member from the roster AFTER eviction', async () => {
    const session = makeSession();
    const order: string[] = [];
    vi.mocked(evictMember).mockImplementationOnce(async () => { order.push('evict'); return { newEpoch: 2, revoked: true }; });
    vi.mocked(removeSpaceMember).mockImplementationOnce(async () => { order.push('roster'); });
    saveSpaceInviteEntry(SP, UID, { edPub: 'ep', kemPub: 'kp', cap: { nonce: 'c', exp: 1 } });

    await revokeSpaceAccess(session, SP, UID, { generation: 1, submitRevocation: vi.fn() });

    expect(removeSpaceMember).toHaveBeenCalledWith(session.accountClient, SP, UID);
    expect(order).toEqual(['evict', 'roster']);
  });

  it('returns { revoked: true } on success', async () => {
    const session = makeSession();
    saveSpaceInviteEntry(SP, UID, { edPub: 'ep', kemPub: 'kp', cap: { nonce: 'c', exp: 1 } });
    const result = await revokeSpaceAccess(session, SP, UID, { generation: 1, submitRevocation: vi.fn() });
    expect(result.revoked).toBe(true);
  });
});

// ── inviteToSpace / createSpaceInviteLink auto-store the invite entry ───────────

describe('inviteToSpace auto-stores the invite entry', () => {
  beforeEach(() => clearSpaceInviteStore());

  it('stores the invitee edPub + kemPub + cap nonce after a successful invite', async () => {
    const session = makeSession();
    await inviteToSpace(session, SP, joinReq, true, 'My Space');

    const entry = getSpaceInviteEntry(SP, UID);
    const req = JSON.parse(joinReq) as { edPub: string; kemPub: string };
    expect(entry).not.toBeNull();
    expect(entry?.edPub).toBe(req.edPub);
    expect(entry?.kemPub).toBe(req.kemPub);
    expect(entry?.cap.nonce).toBeTruthy();
  });
});

describe('createSpaceInviteLink auto-stores the ephemeral invite entry', () => {
  beforeEach(() => clearSpaceInviteStore());

  it('stores the ephemeral edPub + kemPub + cap nonce so the link can be revoked', async () => {
    const session = makeSession();
    await createSpaceInviteLink(session, SP, 'My Space', true, 'https://x');

    // The ephemeral userId is derived via the mocked userIdFromEdPub → UID.
    const entry = getSpaceInviteEntry(SP, UID);
    expect(entry).not.toBeNull();
    expect(entry?.edPub).toBe('eph-edpub');
    expect(entry?.kemPub).toBe('eph-kempub');
    expect(entry?.cap.nonce).toBeTruthy();
  });
});
