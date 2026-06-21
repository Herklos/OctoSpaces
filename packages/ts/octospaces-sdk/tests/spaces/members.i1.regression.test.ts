/**
 * Regression tests: inviteToSpace must validate userId ↔ edPub.
 *
 * inviteToSpace must not trust req.userId presence-only — a caller could pass a
 * forged userId that flows into addSpaceMember + minted cap subject. Fix:
 * userIdFromEdPub(req.edPub) must equal req.userId, mirroring the check in
 * scanResourceRequests.
 *
 * CLAUDE.md invariant: inviteToSpace / inviteToNode MUST verify
 * `userId === await userIdFromEdPub(edPub)` before trusting a requester's userId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (all hoisted) ────────────────────────────────────────────────────────

vi.mock('@noble/curves/ed25519.js', () => ({
  ed25519: {
    sign: vi.fn().mockReturnValue(new Uint8Array(64).fill(0xab)),
    verify: vi.fn().mockReturnValue(true),
    getPublicKey: vi.fn().mockReturnValue(new Uint8Array(32)),
  },
}));

vi.mock('../../src/spaces/registry.js', () => ({
  addSpaceMember: vi.fn().mockResolvedValue(undefined),
  readSpaces: vi.fn().mockResolvedValue({ spaces: [], caps: {}, pubAccess: {} }),
  buildSpace: vi.fn().mockImplementation((id: string, name: string) => ({ id, name, short: 'SP', members: 1 })),
  updateSpacesDoc: vi.fn().mockResolvedValue(undefined),
  addJoinedSpaceWithCap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/sync/client.js', () => ({
  ownerEnsureSpaceKeyring: vi.fn().mockResolvedValue({}),
  ensureSpaceKeyringRecipient: vi.fn().mockResolvedValue(undefined),
  isAlreadyPresentRecipient: vi.fn().mockReturnValue(false),
}));

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn().mockResolvedValue({ kind: 'member', sub: 'pub' }),
}));

vi.mock('@drakkar.software/starfish-keyring', async (importOriginal) => {
  const original = await importOriginal<typeof import('@drakkar.software/starfish-keyring')>();
  return {
    ...original,
    addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
    // Safe stubs so the kemSig try/catch in members.ts succeeds for any hex input.
    hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
    bytesToHex: vi.fn().mockReturnValue('ab'.repeat(32)),
  };
});

vi.mock('../../src/sync/space-access-store.js', () => ({
  saveSpaceAccessEntry: vi.fn(),
  getSpaceAccessEntry: vi.fn().mockReturnValue(null),
  hydrateSpaceAccessStore: vi.fn().mockResolvedValue(undefined),
  localSpaceAccessEntries: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/sync/account-seal.js', () => ({
  sealToSelf: vi.fn().mockResolvedValue({ encrypted: true }),
  unsealFromSelf: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('../../src/sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sync/paths.js')>();
  return {
    ...original,
    // Controlled per-test via mockResolvedValueOnce.
    userIdFromEdPub: vi.fn().mockResolvedValue('real-user-id'),
  };
});

// ── Import after mocks ─────────────────────────────────────────────────────────

import { inviteToSpace } from '../../src/spaces/members.js';
import { userIdFromEdPub } from '../../src/sync/paths.js';

// ── Fake session ───────────────────────────────────────────────────────────────

import type { StarfishClient } from '@drakkar.software/starfish-client';

function makeSession() {
  return {
    userId: 'owner',
    keys: { edPriv: 'priv', edPub: 'pub', kemPriv: 'kempriv', kemPub: 'kempub' },
    contentClient: {
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    } as unknown as StarfishClient,
    accountClient: {
      pull: vi.fn().mockResolvedValue({ data: { v: 1, spaces: [], caps: {}, pubAccess: {} }, hash: null }),
      push: vi.fn().mockResolvedValue(undefined),
    } as unknown as StarfishClient,
  } as never;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('inviteToSpace rejects mismatched userId↔edPub', () => {
  beforeEach(() => {
    vi.mocked(userIdFromEdPub).mockResolvedValue('real-user-id');
  });

  it('FAILS (pre-fix): rejects a request where userId does not match userIdFromEdPub(edPub)', async () => {
    // edPub derives to 'real-user-id', but the request claims 'forged-user-id'
    vi.mocked(userIdFromEdPub).mockResolvedValueOnce('real-user-id');
    const req = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'forged-user-id' });
    await expect(
      inviteToSpace(makeSession(), 'sp-1', req),
    ).rejects.toThrow(/userId.*does not match|join request.*invalid|invalid.*join/i);
  });

  it('accepts a request where userId matches userIdFromEdPub(edPub)', async () => {
    vi.mocked(userIdFromEdPub).mockResolvedValueOnce('real-user-id');
    vi.mocked(ed25519.verify).mockReturnValueOnce(true);
    // Valid hex so hexToBytes succeeds; ed25519.verify is mocked to return true.
    const req = JSON.stringify({ edPub: '00'.repeat(32), kemPub: 'ff'.repeat(32), userId: 'real-user-id', kemSig: 'ab'.repeat(64) });
    await expect(
      inviteToSpace(makeSession(), 'sp-1', req),
    ).resolves.toBeDefined();
  });
});

// ── inviteToSpace must validate kemSig ───────────────────────────────────────
//
// JoinRequest carries kemPub with no cryptographic proof the requester owns the
// corresponding private key. An MITM can replace kemPub so all sealed E2EE
// content is readable only by the attacker.
//
// Fix: makeJoinRequest signs kemPub with edPriv; inviteToSpace verifies the
// signature before using kemPub. Missing or invalid kemSig → reject.

import { ed25519 } from '@noble/curves/ed25519.js';

describe('inviteToSpace validates kemSig binding', () => {
  beforeEach(() => {
    vi.mocked(userIdFromEdPub).mockResolvedValue('real-user-id');
    vi.mocked(ed25519.verify).mockReturnValue(true);
  });

  it('FAILS (pre-fix): rejects a request with missing kemSig', async () => {
    const req = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'real-user-id' }); // no kemSig
    await expect(
      inviteToSpace(makeSession(), 'sp-1', req),
    ).rejects.toThrow(/kemSig|kem.*sign|invalid.*join|join.*invalid/i);
  });

  it('FAILS (pre-fix): rejects a request where kemSig does not verify', async () => {
    vi.mocked(ed25519.verify).mockReturnValueOnce(false);
    const req = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'real-user-id', kemSig: '00'.repeat(64) });
    await expect(
      inviteToSpace(makeSession(), 'sp-1', req),
    ).rejects.toThrow(/kemSig|kem.*sign|invalid.*join|join.*invalid/i);
  });

  it('accepts a request with a valid kemSig', async () => {
    vi.mocked(ed25519.verify).mockReturnValueOnce(true);
    // Valid 32-byte hex strings so hexToBytes succeeds and ed25519.verify (mocked) can run.
    const req = JSON.stringify({ edPub: '00'.repeat(32), kemPub: 'ff'.repeat(32), userId: 'real-user-id', kemSig: 'ab'.repeat(64) });
    await expect(
      inviteToSpace(makeSession(), 'sp-1', req),
    ).resolves.toBeDefined();
  });
});
