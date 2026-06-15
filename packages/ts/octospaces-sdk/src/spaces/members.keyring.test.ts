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

vi.mock('../sync/client.js', () => ({
  ownerEnsureKeyring: vi.fn().mockResolvedValue({}),
}));

vi.mock('@drakkar.software/starfish-keyring', () => ({
  addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
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
}));

vi.mock('@drakkar.software/starfish-identities', () => ({
  generateDeviceKeys: vi.fn().mockReturnValue({
    edPub: 'eph-edpub',
    edPriv: 'eph-edpriv',
    kemPub: 'eph-kempub',
    kemPriv: 'eph-kempriv',
  }),
}));

vi.mock('../sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/paths.js')>();
  return { ...original, userIdFromEdPub: vi.fn().mockResolvedValue('ephemeral-user-id') };
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

import { inviteToSpace, createSpaceInviteLink, addDeviceToSpaceKeyring } from './members.js';
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { addSpaceMember } from './registry.js';
import { ownerEnsureKeyring } from '../sync/client.js';
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
  chatClient: { pull: vi.fn(), push: vi.fn() },
  accountClient: { pull: vi.fn(), push: vi.fn() },
} as unknown as Session;

const bobRequest = JSON.stringify({
  edPub: 'bob-ed-pub',
  kemPub: 'bob-kem-pub',
  userId: 'bob-user-id',
});

// ── inviteToSpace ─────────────────────────────────────────────────────────────

describe('inviteToSpace — keyring ordering and error handling', () => {
  beforeEach(() => {
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
    vi.mocked(addSpaceMember).mockClear().mockResolvedValue(undefined);
    vi.mocked(ownerEnsureKeyring).mockClear().mockResolvedValue({} as never);
  });

  it('ownerEnsureKeyring is called before addCollectionRecipient (ordering invariant)', async () => {
    const callOrder: string[] = [];
    vi.mocked(ownerEnsureKeyring).mockImplementation(async () => {
      callOrder.push('ownerEnsureKeyring');
      return {} as never;
    });
    vi.mocked(addCollectionRecipient).mockImplementation(async () => {
      callOrder.push('addCollectionRecipient');
    });

    await inviteToSpace(mockSession, 'sp-1', bobRequest);

    expect(callOrder).toEqual(['ownerEnsureKeyring', 'addCollectionRecipient']);
  });

  it('ownerEnsureKeyring is called with keyring paths for the space', async () => {
    await inviteToSpace(mockSession, 'sp-1', bobRequest);

    const [, , pullPath, pushPath] = vi.mocked(ownerEnsureKeyring).mock.calls[0]!;
    expect(pullPath).toContain('sp-1');
    expect(pushPath).toContain('sp-1');
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

  it('"no keyring exists" is rethrown (ownerEnsureKeyring prevents this in practice)', async () => {
    // ownerEnsureKeyring guarantees the keyring exists before addCollectionRecipient is called.
    // If somehow addCollectionRecipient still sees "no keyring exists", it means something
    // went wrong with ensure — we rethrow so the caller can diagnose.
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
    vi.mocked(ownerEnsureKeyring).mockClear().mockResolvedValue({} as never);
  });

  it('ownerEnsureKeyring is called before addCollectionRecipient (ordering invariant)', async () => {
    const callOrder: string[] = [];
    vi.mocked(ownerEnsureKeyring).mockImplementation(async () => {
      callOrder.push('ownerEnsureKeyring');
      return {} as never;
    });
    vi.mocked(addCollectionRecipient).mockImplementation(async () => {
      callOrder.push('addCollectionRecipient');
    });

    await createSpaceInviteLink(mockSession, 'sp-1', 'Test Space', true, 'https://app.example.com');

    expect(callOrder).toEqual(['ownerEnsureKeyring', 'addCollectionRecipient']);
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
    vi.mocked(ownerEnsureKeyring).mockClear().mockResolvedValue({} as never);
  });

  it('does NOT call ownerEnsureKeyring — device pairing must not force-create a keyring', async () => {
    await addDeviceToSpaceKeyring(mockSession, 'sp-1', device);

    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
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
