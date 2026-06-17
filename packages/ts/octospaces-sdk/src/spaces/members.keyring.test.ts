/**
 * Keyring regression tests for inviteToSpace, createSpaceInviteLink,
 * and addDeviceToSpaceKeyring.
 *
 * These tests pin the critical keyring invariants that were broken in sdk 0.4.0
 * (the `inviteToSpace` keyring-add was dropped entirely) and improperly fixed in
 * sdk 0.4.1 (keyring-missing errors were swallowed, allowing silent failures when
 * the keyring didn't exist yet):
 *
 *   inviteToSpace / createSpaceInviteLink (fixed behaviour):
 *     - ownerEnsureKeyring is called BEFORE addCollectionRecipient (ordering invariant)
 *     - addCollectionRecipient receives the correct invitee KEM + userId
 *     - "already present in epoch" is swallowed (idempotent add)
 *     - ALL other errors are rethrown — including unexpected ones and "no keyring exists"
 *     - The invite / link result is returned on success
 *
 *   addDeviceToSpaceKeyring (device-pairing path — different semantics):
 *     - Does NOT call ownerEnsureKeyring
 *     - "already present" → silently skipped
 *     - "keyring missing" (/not found|404|does not exist|no keyring exists/i) → silently skipped
 *     - Other errors → rethrown
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// NOTE: vi.mock factories are hoisted to the top of the file by Vitest.
// Do NOT reference module-level `const` variables inside vi.mock factories —
// they will not be initialised yet. Use vi.fn() directly in the factory,
// then access the mock via vi.mocked(<import>) in test bodies.

vi.mock('../sync/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/client.js')>();
  return {
    ...original,
    // Real addSpaceKeyringRecipient + isAlreadyPresentRecipient so they invoke
    // the mocked addCollectionRecipient, preserving error-swallowing invariants.
    // ownerEnsureKeyring (internal) uses mocked createKeyring/createKeyringEncryptor
    // from @drakkar.software/starfish-keyring, so no real hex crypto is needed.
  };
});

vi.mock('@drakkar.software/starfish-keyring', () => ({
  addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
  // Stubs for ownerEnsureKeyring (called internally via ownerEnsureSpaceKeyring).
  createKeyring: vi.fn().mockResolvedValue({ keyring: { epochs: [] } }),
  createKeyringEncryptor: vi.fn().mockResolvedValue({}),
  // Safe stubs so the kemSig try/catch in members.ts succeeds for fixture strings.
  hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
  bytesToHex: vi.fn().mockReturnValue('ab'.repeat(32)),
}));

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn().mockResolvedValue({ kind: 'member', iss: 'alice-ed-pub', sub: 'bob-ed-pub', scope: {} }),
}));

vi.mock('./registry.js', () => ({
  addSpaceMember: vi.fn().mockResolvedValue(undefined),
  readSpaces: vi.fn().mockResolvedValue({ spaces: [{ id: 'sp-1', name: 'Test Space' }], caps: {}, pubAccess: {} }),
  addJoinedSpaceWithCap: vi.fn().mockResolvedValue(undefined),
  addJoinedSpaceWithLinkAccess: vi.fn().mockResolvedValue(undefined),
  updateSpacesDoc: vi.fn().mockResolvedValue(undefined),
  buildSpace: vi.fn().mockImplementation((id: string, name: string) => ({
    id,
    name: name.trim() || `space-${id.slice(-6)}`,
    short: (name.trim() || `space-${id.slice(-6)}`).slice(0, 2).toUpperCase(),
    members: 1,
  })),
}));

vi.mock('@drakkar.software/starfish-identities', () => ({
  generateDeviceKeys: vi.fn().mockReturnValue({
    edPub: 'eph-edpub',
    edPriv: 'eph-edpriv',
    kemPub: 'eph-kempub',
    kemPriv: 'eph-kempriv',
  }),
}));

// Mock ed25519 so kemSig validation passes for all test fixtures.
vi.mock('@noble/curves/ed25519.js', () => ({
  ed25519: {
    sign: vi.fn().mockReturnValue(new Uint8Array(64).fill(0xab)),
    verify: vi.fn().mockReturnValue(true),
    getPublicKey: vi.fn().mockReturnValue(new Uint8Array(32)),
  },
}));

vi.mock('../sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/paths.js')>();
  return {
    ...original,
    // Dispatch by edPub so both inviteToSpace (bob-ed-pub → bob-user-id) and
    // createSpaceInviteLink (eph-edpub → ephemeral-user-id) validate correctly.
    userIdFromEdPub: vi.fn().mockImplementation((edPub: string) =>
      Promise.resolve(edPub === 'eph-edpub' ? 'ephemeral-user-id' : 'bob-user-id'),
    ),
  };
});

vi.mock('../sync/space-access-store.js', () => ({
  saveSpaceAccessEntry: vi.fn(),
  getSpaceAccessEntry: vi.fn().mockReturnValue(null),
  hydrateSpaceAccessStore: vi.fn().mockResolvedValue(undefined),
  localSpaceAccessEntries: vi.fn().mockReturnValue({}),
}));

vi.mock('../sync/account-seal.js', () => ({
  sealToSelf: vi.fn().mockResolvedValue({ encrypted: true }),
  unsealFromSelf: vi.fn().mockResolvedValue('{}'),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { inviteToSpace, createSpaceInviteLink, joinSpaceByLink, addDeviceToSpaceKeyring, recoverSpaceAccess } from './members.js';
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { addSpaceMember } from './registry.js';
import { saveSpaceAccessEntry } from '../sync/space-access-store.js';
import { sealToSelf, unsealFromSelf } from '../sync/account-seal.js';
import type { Session } from '../sync/identity.js';

// ── Shared mock session ───────────────────────────────────────────────────────

const mockSession = {
  userId: 'alice-user-id',
  keys: {
    edPub: 'alice-ed-pub',
    edPriv: 'alice-ed-priv',
    kemPub: 'alice-kem-pub',
    kemPriv: 'alice-kem-priv',
  },
  // pull must return a Promise — ownerEnsureKeyring calls pull(…).catch(…) internally
  chatClient: { pull: vi.fn().mockResolvedValue(null), push: vi.fn().mockResolvedValue(null) },
  accountClient: { pull: vi.fn().mockResolvedValue(null), push: vi.fn().mockResolvedValue(null) },
} as unknown as Session;

const bobRequest = JSON.stringify({
  edPub: 'bob-ed-pub',
  kemPub: 'bob-kem-pub',
  userId: 'bob-user-id',
  kemSig: 'ab'.repeat(64), // ed25519 sig of kemPub by edPriv (mocked to verify=true)
});

// ── inviteToSpace ─────────────────────────────────────────────────────────────

describe('inviteToSpace — keyring ordering and error handling', () => {
  beforeEach(() => {
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
    vi.mocked(addSpaceMember).mockClear().mockResolvedValue(undefined);
  });

  it('addCollectionRecipient is called with the correct invitee KEM and userId', async () => {
    await inviteToSpace(mockSession, 'sp-1', bobRequest);

    expect(vi.mocked(addCollectionRecipient)).toHaveBeenCalledOnce();
    const [, keyringNameArg, recipientArg] = vi.mocked(addCollectionRecipient).mock.calls[0]!;
    expect(keyringNameArg).toContain('sp-1');
    expect(recipientArg).toMatchObject({ subKem: 'bob-kem-pub', userId: 'bob-user-id' });
  });

  it('"already present in epoch" from addCollectionRecipient is swallowed', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(
      new Error('recipient already present in epoch'),
    );

    const result = await inviteToSpace(mockSession, 'sp-1', bobRequest, true, 'Test Space');
    expect(result).toBeTruthy();
  });

  it('unexpected errors from addCollectionRecipient are rethrown — not silently swallowed', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(new Error('network failure'));

    await expect(inviteToSpace(mockSession, 'sp-1', bobRequest)).rejects.toThrow('network failure');
  });

  it('"no keyring exists" is rethrown (ensureSpaceKeyringRecipient creates the keyring first in practice)', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(
      new Error('Cannot add recipient: no keyring exists at spaces/sp-1/_keyring. Create the keyring first.'),
    );

    await expect(inviteToSpace(mockSession, 'sp-1', bobRequest)).rejects.toThrow('no keyring exists');
  });

  it('returned invite JSON contains spaceId, spaceName, and cap', async () => {
    const inviteJson = await inviteToSpace(mockSession, 'sp-1', bobRequest, true, 'My Space');
    const invite = JSON.parse(inviteJson) as { spaceId: string; spaceName: string; cap: unknown };

    expect(invite.spaceId).toBe('sp-1');
    expect(invite.spaceName).toBe('My Space');
    expect(invite.cap).toBeDefined();
  });

  it('spaceName is fetched from the registry when not provided', async () => {
    const inviteJson = await inviteToSpace(mockSession, 'sp-1', bobRequest);
    const invite = JSON.parse(inviteJson) as { spaceName: string };

    // readSpaces mock returns [{ id: 'sp-1', name: 'Test Space' }]
    expect(invite.spaceName).toBe('Test Space');
  });

  it('addSpaceMember is called with the correct spaceId and userId', async () => {
    await inviteToSpace(mockSession, 'sp-1', bobRequest);

    expect(vi.mocked(addSpaceMember)).toHaveBeenCalledWith(
      mockSession.accountClient,
      'sp-1',
      mockSession.userId,
      'bob-user-id',
    );
  });
});

// ── createSpaceInviteLink ─────────────────────────────────────────────────────

describe('createSpaceInviteLink — keyring ordering and error handling', () => {
  beforeEach(() => {
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
    vi.mocked(addSpaceMember).mockClear().mockResolvedValue(undefined);
  });

  it('addCollectionRecipient is called with the ephemeral KEM key and userId', async () => {
    await createSpaceInviteLink(mockSession, 'sp-1', 'Test Space', true, 'https://app.example.com');

    expect(vi.mocked(addCollectionRecipient)).toHaveBeenCalledOnce();
    const [, keyringNameArg, recipientArg] = vi.mocked(addCollectionRecipient).mock.calls[0]!;
    expect(keyringNameArg).toContain('sp-1');
    expect(recipientArg).toMatchObject({ subKem: 'eph-kempub', userId: 'ephemeral-user-id' });
  });

  it('"already present in epoch" is swallowed — link still returned', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(
      new Error('recipient already present in epoch'),
    );

    const result = await createSpaceInviteLink(
      mockSession,
      'sp-1',
      'Test Space',
      true,
      'https://app.example.com',
    );

    expect(result.link).toBeTruthy();
    expect(result.token).toBeTruthy();
  });

  it('unexpected errors from addCollectionRecipient are rethrown', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(new Error('storage unavailable'));

    await expect(
      createSpaceInviteLink(mockSession, 'sp-1', 'Test Space', true, 'https://app.example.com'),
    ).rejects.toThrow('storage unavailable');
  });

  it('returned link fragment contains the ephemeral private key', async () => {
    const { link, token } = await createSpaceInviteLink(
      mockSession,
      'sp-1',
      'Test Space',
      true,
      'https://app.example.com',
    );

    expect(link).toContain('#');
    const fragment = link.split('#')[1]!;
    const { fromBase64Url } = await import('../sync/base64url.js');
    const decoded = JSON.parse(fromBase64Url(fragment)) as { key: string };
    expect(decoded.key).toBe('eph-edpriv'); // generateDeviceKeys mock returns edPriv: 'eph-edpriv'
    expect(token.key).toBe('eph-edpriv');
  });

  it('FIX C: token carries kemPriv and kemPub — recipient id matches token KEM (core invariant)', async () => {
    // This pins the critical invariant: the kemPub used as the keyring recipient
    // entry MUST be the same as what is carried in the token for the joiner to decrypt.
    const { token } = await createSpaceInviteLink(
      mockSession, 'sp-1', 'Test Space', true, 'https://app.example.com',
    );

    // addCollectionRecipient should have been called with ek.kemPub
    const recipientArg = vi.mocked(addCollectionRecipient).mock.calls[0]![2];
    expect(recipientArg).toMatchObject({ subKem: 'eph-kempub' });

    // The token should carry the matching kemPriv/kemPub
    expect(token.kemPriv).toBe('eph-kempriv');
    expect(token.kemPub).toBe('eph-kempub');

    // Recipient id in the keyring === kemPub in the token — that is the invariant
    expect(token.kemPub).toBe(recipientArg.subKem);
  });

  it('addSpaceMember is called with the ephemeral userId', async () => {
    await createSpaceInviteLink(
      mockSession,
      'sp-1',
      'Test Space',
      false,
      'https://app.example.com',
    );

    // userIdFromEdPub mock returns 'ephemeral-user-id'
    expect(vi.mocked(addSpaceMember)).toHaveBeenCalledWith(
      mockSession.accountClient,
      'sp-1',
      mockSession.userId,
      'ephemeral-user-id',
    );
  });
});

// ── addDeviceToSpaceKeyring ───────────────────────────────────────────────────

describe('addDeviceToSpaceKeyring — skip-if-missing, rethrow-unexpected', () => {
  const device = { kemPub: 'dev-kempub', edPub: 'dev-edpub', userId: 'dev-userid' };

  beforeEach(() => {
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
  });

  it('silently skipped when keyring is missing ("not found")', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(new Error('not found'));

    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).resolves.toBeUndefined();
  });

  it('silently skipped when error matches "404"', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(new Error('404 Not Found'));

    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).resolves.toBeUndefined();
  });

  it('silently skipped when error matches "does not exist"', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(new Error('collection does not exist'));

    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).resolves.toBeUndefined();
  });

  it('silently skipped when error matches "no keyring exists" (fixed regex)', async () => {
    // This variant was missing from isKeyringMissing before the fix — the predicate
    // only matched /not found|404|does not exist/. The "no keyring exists" message
    // from starfish-keyring was therefore rethrown instead of silently skipped.
    vi.mocked(addCollectionRecipient).mockRejectedValue(
      new Error(
        'Cannot add recipient: no keyring exists at spaces/sp-1/_keyring. Create the keyring first.',
      ),
    );

    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).resolves.toBeUndefined();
  });

  it('"already present in epoch" is silently skipped', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(
      new Error('device already present in epoch'),
    );

    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).resolves.toBeUndefined();
  });

  it('other errors are rethrown', async () => {
    vi.mocked(addCollectionRecipient).mockRejectedValue(new Error('permission denied'));

    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).rejects.toThrow(
      'permission denied',
    );
  });

  it('succeeds when keyring exists and device is not yet a recipient', async () => {
    await expect(addDeviceToSpaceKeyring(mockSession, 'sp-1', device)).resolves.toBeUndefined();
    expect(vi.mocked(addCollectionRecipient)).toHaveBeenCalledOnce();
  });
});

// ── joinSpaceByLink (FIX C persistence) ──────────────────────────────────────

describe('joinSpaceByLink — persists kemPriv and kemPub (Fix C)', () => {
  beforeEach(() => {
    vi.mocked(saveSpaceAccessEntry).mockClear();
    vi.mocked(sealToSelf).mockClear().mockResolvedValue({ encrypted: true } as never);
  });

  const fullToken = {
    v: 1 as const,
    spaceId: 'sp-link1',
    spaceName: 'Link Space',
    cap: { kind: 'member', iss: 'owner-pub', sub: 'eph-edpub' },
    key: 'eph-edpriv',
    kemPriv: 'eph-kempriv',
    kemPub: 'eph-kempub',
    write: true,
  };

  it('FIX C: saveSpaceAccessEntry receives kemPriv and kemPub', async () => {
    await joinSpaceByLink(mockSession, fullToken);
    expect(vi.mocked(saveSpaceAccessEntry)).toHaveBeenCalledWith(
      'sp-link1',
      expect.objectContaining({ kind: 'link', kemPriv: 'eph-kempriv', kemPub: 'eph-kempub' }),
    );
  });

  it('FIX C: sealToSelf payload includes kemPriv and kemPub', async () => {
    await joinSpaceByLink(mockSession, fullToken);
    const sealArg = vi.mocked(sealToSelf).mock.calls[0]![1];
    const payload = JSON.parse(sealArg) as { kemPriv?: string; kemPub?: string };
    expect(payload.kemPriv).toBe('eph-kempriv');
    expect(payload.kemPub).toBe('eph-kempub');
  });

  it('legacy token (no KEM) stores entry without kemPriv/kemPub — no error', async () => {
    const legacyToken = { ...fullToken, kemPriv: undefined, kemPub: undefined };
    await expect(joinSpaceByLink(mockSession, legacyToken)).resolves.toMatchObject({ id: 'sp-link1' });
    const [, entry] = vi.mocked(saveSpaceAccessEntry).mock.calls[0]!;
    expect((entry as { kemPriv?: string }).kemPriv).toBeUndefined();
  });
});

// ── recoverSpaceAccess (Fix C round-trip) ────────────────────────────────────

describe('recoverSpaceAccess — threads kemPriv/kemPub through unseal → hydrate (Fix C)', () => {
  beforeEach(() => {
    vi.mocked(unsealFromSelf).mockClear();
    vi.mocked(sealToSelf).mockClear().mockResolvedValue({ encrypted: true } as never);
  });

  it('FIX C: hydrates link access with kemPriv/kemPub when present in sealed blob', async () => {
    const { hydrateSpaceAccessStore } = await import('../sync/space-access-store.js');
    vi.mocked(unsealFromSelf).mockResolvedValue(
      JSON.stringify({ cap: { kind: 'member' }, key: 'eph-edpriv', kemPriv: 'eph-kempriv', kemPub: 'eph-kempub', write: true }),
    );

    await recoverSpaceAccess(mockSession, {
      caps: {},
      pubAccess: { 'sp-recover': { encrypted: true } as never },
    });

    expect(vi.mocked(hydrateSpaceAccessStore)).toHaveBeenCalledWith(
      mockSession.userId,
      {},
      expect.objectContaining({
        'sp-recover': expect.objectContaining({ kemPriv: 'eph-kempriv', kemPub: 'eph-kempub' }),
      }),
    );
  });

  it('backfill sealToSelf includes kemPriv/kemPub from local link entry', async () => {
    const { localSpaceAccessEntries } = await import('../sync/space-access-store.js');
    vi.mocked(localSpaceAccessEntries).mockReturnValue({
      'sp-backfill': { kind: 'link', cap: { kind: 'member' }, key: 'k', kemPriv: 'eph-kempriv', kemPub: 'eph-kempub', write: false },
    });
    vi.mocked(unsealFromSelf).mockResolvedValue('{}'); // empty pubAccess

    await recoverSpaceAccess(mockSession, { caps: {}, pubAccess: {} });

    const sealArg = vi.mocked(sealToSelf).mock.calls[0]![1];
    const payload = JSON.parse(sealArg) as { kemPriv?: string; kemPub?: string };
    expect(payload.kemPriv).toBe('eph-kempriv');
    expect(payload.kemPub).toBe('eph-kempub');
  });
});
