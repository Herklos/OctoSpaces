/**
 * revokeNodeAccess — full revocation infrastructure for per-node-keyring
 * (OctoDesk ticket) nodes.
 *
 * Three pillars:
 *   1. saveNodeInviteEntry / getNodeInviteEntry — owner retains cap nonces at invite time.
 *   2. revokeNodeAccess — rotates the node keyring (forward secrecy) + submits a signed
 *      RevocationList that includes ALL caps the invitee holds (keyring + content + stream).
 *   3. inviteToNode (isolated, enc) auto-stores the invite entry so revocation is always
 *      possible without out-of-band nonce tracking.
 *
 * Server route (POST /revocations) already exists in apps/server/src/index.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn().mockImplementation(
    // Return a mock CapCert with nonce + exp so inviteToNode can store them.
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
    // Stubs so ownerEnsureKeyring (called via ensureSpaceKeyringRecipient internally)
    // can complete without real hex crypto — non-isolated enc invites hit this path.
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

vi.mock('../../src/sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sync/paths.js')>();
  return {
    ...original,
    userIdFromEdPub: vi.fn().mockResolvedValue('requester-user-id'),
  };
});

vi.mock('../../src/sync/space-access.js', () => ({
  getSpaceClient: vi.fn().mockReturnValue({
    pull: vi.fn().mockResolvedValue(null),
    push: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../src/sync/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sync/client.js')>();
  return {
    ...original,
    // makeClient override so internal pull/push calls don't hit a real server.
    makeClient: vi.fn().mockReturnValue({
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock('../../src/sync/space-access-store.js', () => ({
  saveNodeAccessEntry: vi.fn(),
  saveNodeStreamAccessEntry: vi.fn(),
  saveNodeKeyringAccessEntry: vi.fn(),
  saveSpaceAccessEntry: vi.fn(),
  getNodeAccessEntry: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/sync/node-keyring.js', () => ({
  ensureNodeKeyringRecipient: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/sync/identity.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sync/identity.js')>();
  return {
    ...original,
    ownerTrustedAdders: vi.fn().mockReturnValue(['owner-edpub']),
  };
});

vi.mock('../../src/spaces/registry.js', () => ({
  addSpaceMember: vi.fn().mockResolvedValue(undefined),
  readSpaces: vi.fn().mockResolvedValue({ spaces: [], caps: {}, pubAccess: {} }),
  buildSpace: vi.fn().mockImplementation((id: string, name: string) => ({ id, name, short: 'SP', members: 1 })),
  updateSpacesDoc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/sync/account-seal.js', () => ({
  sealToSelf: vi.fn().mockResolvedValue({ encrypted: true }),
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
  saveNodeInviteEntry,
  getNodeInviteEntry,
  clearNodeInviteStore,
  revokeNodeAccess,
  inviteToNode,
} from '../../src/spaces/nodes.js';
import { evictMember } from '@drakkar.software/starfish-sharing';
import { nodeKeyringName } from '../../src/sync/paths.js';
import { ownerTrustedAdders } from '../../src/sync/identity.js';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { Session } from '../../src/sync/identity.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SP = 'sp-1';
const NID = 'ticket-xyz';
const UID = 'requester-user-id';

function makeSession(): Session {
  return {
    userId: 'alice',
    ownerEdPub: 'owner-edpub',
    keys: { edPriv: 'owner-edpriv', edPub: 'owner-edpub', kemPriv: 'owner-kempriv', kemPub: 'owner-kempub' },
    contentClient: {
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
  kemPub: 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe00',
  userId: UID,
  kemSig: 'ab'.repeat(64),
});

// ── Store roundtrip ────────────────────────────────────────────────────────────

describe('node invite store (owner-side nonce tracking)', () => {
  beforeEach(() => clearNodeInviteStore());

  it('returns null when no entry is stored', () => {
    expect(getNodeInviteEntry(SP, NID, UID)).toBeNull();
  });

  it('roundtrips a stored invite entry', () => {
    const entry = {
      edPub: 'abc',
      kemPub: 'def',
      caps: {
        keyring: { nonce: 'kr-nonce', exp: 1000 },
        node: { nonce: 'n-nonce', exp: 1000 },
        stream: { nonce: 's-nonce', exp: 1000 },
      },
    };
    saveNodeInviteEntry(SP, NID, UID, entry);
    expect(getNodeInviteEntry(SP, NID, UID)).toEqual(entry);
  });

  it('scopes entries by spaceId, nodeId, userId independently', () => {
    saveNodeInviteEntry('sp-a', NID, UID, { edPub: 'a', kemPub: 'x', caps: { keyring: { nonce: 'na', exp: 1 } } });
    saveNodeInviteEntry('sp-b', NID, UID, { edPub: 'b', kemPub: 'y', caps: { keyring: { nonce: 'nb', exp: 2 } } });
    expect(getNodeInviteEntry('sp-a', NID, UID)?.edPub).toBe('a');
    expect(getNodeInviteEntry('sp-b', NID, UID)?.edPub).toBe('b');
    expect(getNodeInviteEntry('sp-c', NID, UID)).toBeNull();
  });

  it('clearNodeInviteStore wipes all entries', () => {
    saveNodeInviteEntry(SP, NID, UID, { edPub: 'x', kemPub: 'y', caps: {} });
    clearNodeInviteStore();
    expect(getNodeInviteEntry(SP, NID, UID)).toBeNull();
  });
});

// ── revokeNodeAccess ───────────────────────────────────────────────────────────

describe('revokeNodeAccess', () => {
  beforeEach(() => {
    clearNodeInviteStore();
    vi.mocked(evictMember).mockClear().mockResolvedValue({ newEpoch: 2, revoked: true });
    vi.mocked(ownerTrustedAdders).mockReturnValue(['owner-edpub']);
  });

  it('throws when no stored invite entry for the user', async () => {
    const session = makeSession();
    await expect(
      revokeNodeAccess(session, SP, NID, 'unknown-user', {
        generation: 1,
        submitRevocation: vi.fn(),
      }),
    ).rejects.toThrow(/no stored invite|not found|unknown-user/i);
  });

  it('throws when stored entry has no keyring cap (non-per-node-keyring node)', async () => {
    const session = makeSession();
    saveNodeInviteEntry(SP, NID, UID, { edPub: 'ep', kemPub: 'kp', caps: { node: { nonce: 'n', exp: 1 } } });
    await expect(
      revokeNodeAccess(session, SP, NID, UID, { generation: 1, submitRevocation: vi.fn() }),
    ).rejects.toThrow(/keyring cap|no keyring/i);
  });

  it('calls evictMember with nodeKeyringName, stored member info, and rotate+revoke', async () => {
    const session = makeSession();
    saveNodeInviteEntry(SP, NID, UID, {
      edPub: 'req-edpub',
      kemPub: 'req-kempub',
      caps: { keyring: { nonce: 'kr-nonce-b64', exp: 9000 } },
    });
    const submitRevocation = vi.fn().mockResolvedValue(undefined);

    await revokeNodeAccess(session, SP, NID, UID, { generation: 5, submitRevocation });

    expect(evictMember).toHaveBeenCalledWith(
      session.contentClient,
      expect.objectContaining({
        keyringCollection: nodeKeyringName(SP, NID),
        membersCollection: nodeKeyringName(SP, NID),
        member: {
          sub: 'req-edpub',
          nonce: 'kr-nonce-b64',
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
    saveNodeInviteEntry(SP, NID, UID, {
      edPub: 'ep', kemPub: 'kp',
      caps: { keyring: { nonce: 'kr', exp: 1 } },
    });
    await revokeNodeAccess(session, SP, NID, UID, { generation: 1, submitRevocation: vi.fn() });
    const params = vi.mocked(evictMember).mock.calls[0]![1];
    expect(params.trustedAdders).toEqual(['owner-edpub', 'device-pub']);
  });

  it('includes nodeCap + streamCap nonces in priorRevoked', async () => {
    const session = makeSession();
    saveNodeInviteEntry(SP, NID, UID, {
      edPub: 'req-edpub',
      kemPub: 'req-kempub',
      caps: {
        keyring: { nonce: 'kr-nonce', exp: 9000 },
        node: { nonce: 'n-nonce', exp: 8000 },
        stream: { nonce: 's-nonce', exp: 8000 },
      },
    });

    await revokeNodeAccess(session, SP, NID, UID, { generation: 1, submitRevocation: vi.fn() });

    const params = vi.mocked(evictMember).mock.calls[0]![1];
    expect(params.priorRevoked).toEqual(
      expect.arrayContaining([
        { sub: 'req-edpub', nonce: 'n-nonce', exp: 8000 },
        { sub: 'req-edpub', nonce: 's-nonce', exp: 8000 },
      ]),
    );
  });

  it('merges caller-supplied priorRevoked with internal cap nonces', async () => {
    const session = makeSession();
    saveNodeInviteEntry(SP, NID, UID, {
      edPub: 'ep', kemPub: 'kp',
      caps: {
        keyring: { nonce: 'kr', exp: 1 },
        node: { nonce: 'nn', exp: 1 },
      },
    });
    const callerPrior = [{ sub: 'ep', nonce: 'old-nonce', exp: 0 }];
    await revokeNodeAccess(session, SP, NID, UID, { generation: 1, priorRevoked: callerPrior, submitRevocation: vi.fn() });

    const params = vi.mocked(evictMember).mock.calls[0]![1];
    const prior = params.priorRevoked as typeof callerPrior;
    expect(prior).toEqual(expect.arrayContaining([{ sub: 'ep', nonce: 'old-nonce', exp: 0 }]));
    expect(prior).toEqual(expect.arrayContaining([{ sub: 'ep', nonce: 'nn', exp: 1 }]));
  });

  it('returns the evictMember result', async () => {
    const session = makeSession();
    vi.mocked(evictMember).mockResolvedValueOnce({ newEpoch: 7, revoked: true });
    saveNodeInviteEntry(SP, NID, UID, {
      edPub: 'ep', kemPub: 'kp',
      caps: { keyring: { nonce: 'kr', exp: 1 } },
    });
    const result = await revokeNodeAccess(session, SP, NID, UID, { generation: 1, submitRevocation: vi.fn() });
    expect(result.newEpoch).toBe(7);
    expect(result.revoked).toBe(true);
  });
});

// ── inviteToNode auto-stores invite entry ──────────────────────────────────────

describe('inviteToNode auto-stores nonces for isolated enc nodes', () => {
  beforeEach(() => {
    clearNodeInviteStore();
    vi.mocked(evictMember).mockClear();
  });

  it('stores keyring + node + stream nonces after a successful isolated enc invite', async () => {
    const session = makeSession();
    await inviteToNode(session, SP, NID, joinReq, { enc: true }, 'Ticket', { isolated: true });

    const entry = getNodeInviteEntry(SP, NID, UID);
    expect(entry).not.toBeNull();
    expect(entry?.caps.keyring).toBeDefined();
    expect(entry?.caps.node).toBeDefined();
    expect(entry?.caps.stream).toBeDefined();
  });

  it('stores the invitee edPub + kemPub in the entry', async () => {
    const session = makeSession();
    const req = JSON.parse(joinReq) as { edPub: string; kemPub: string };
    await inviteToNode(session, SP, NID, joinReq, { enc: true }, 'Ticket', { isolated: true });

    const entry = getNodeInviteEntry(SP, NID, UID);
    expect(entry?.edPub).toBe(req.edPub);
    expect(entry?.kemPub).toBe(req.kemPub);
  });

  it('does NOT store an entry for a non-isolated enc invite (space-wide keyring flow)', async () => {
    const session = makeSession();
    await inviteToNode(session, SP, NID, joinReq, { enc: true }, 'Room', { isolated: false });

    // Non-isolated enc uses the space-wide keyring, so no per-node revocation entry is stored
    expect(getNodeInviteEntry(SP, NID, UID)).toBeNull();
  });

  it('does NOT store an entry for a plaintext invite (no keyring)', async () => {
    const session = makeSession();
    await inviteToNode(session, SP, NID, joinReq, { enc: false }, 'Page');

    expect(getNodeInviteEntry(SP, NID, UID)).toBeNull();
  });
});
