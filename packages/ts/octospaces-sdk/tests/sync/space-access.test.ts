/**
 * Tests for the space / node access resolver (space-access.ts).
 *
 * This file was the only module in the sync/ layer with zero test coverage.
 * It covers:
 *
 *   getNodeAccess (hard resolver, caching):
 *     - plaintext node: no keyring touched
 *     - member entry: opens existing keyring as recipient (openEncryptor)
 *     - link entry: opens keyring with ephemeral client
 *     - no entry, owner: mints keyring via ownerEnsureKeyring
 *     - no entry, owner unknown (reg null): also mints (fallback)
 *     - no entry, known non-owner: SpaceAccessError
 *     - no entry, known member: SpaceAccessError with "member" hint
 *     - result is cached; second call returns same promise
 *     - cache miss clears on rejection
 *
 *   buildNodeAccess (soft resolver, no cache):
 *     - plaintext node: returns {client, encryptor:null}
 *     - member entry + keyring exists: returns {client, encryptor}
 *     - link entry: uses ephemeral client
 *     - no keyring, no reg: returns null
 *     - no keyring, reg.owner === userId (Fix B): MINTS keyring, returns handle
 *     - no keyring, reg.owner !== userId: returns null (no mint, no throw)
 *
 *   getSpaceClient:
 *     - no entry → session.contentClient
 *     - link entry → makeClient with cap + key
 *     - member entry → makeClient with parsed cap + edPriv
 *
 * NOTE: vi.mock factories are hoisted — never reference module-level consts inside them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../src/sync/client.js', () => ({
  openEncryptor: vi.fn(),
  buildEncryptor: vi.fn(),
  ownerEnsureKeyring: vi.fn(),
  makeClient: vi.fn(),
}));

vi.mock('../../src/sync/space-access-store.js', () => ({
  getNodeAccessEntry: vi.fn().mockReturnValue(null),
  getNodeKeyringAccessEntry: vi.fn().mockReturnValue(null),
  getNodeStreamAccessEntry: vi.fn().mockReturnValue(null),
  getSpaceAccessEntry: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/sync/node-keyring.js', () => ({
  openNodeEncryptor: vi.fn(),
  buildNodeEncryptor: vi.fn(),
}));

vi.mock('../../src/sync/identity.js', () => ({
  ownerTrustedAdders: vi.fn().mockReturnValue(['owner-ed-pub']),
}));

vi.mock('../../src/sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sync/paths.js')>();
  return { ...original };
});

// ── Imports (after vi.mock declarations) ──────────────────────────────────────

import {
  getNodeAccess,
  buildNodeAccess,
  getSpaceClient,
  clearNodeAccessCache,
  SpaceAccessError,
} from '../../src/sync/space-access.js';
import {
  openEncryptor,
  buildEncryptor,
  ownerEnsureKeyring,
  makeClient,
} from '../../src/sync/client.js';
import { getNodeAccessEntry, getNodeKeyringAccessEntry, getSpaceAccessEntry } from '../../src/sync/space-access-store.js';
import { openNodeEncryptor, buildNodeEncryptor } from '../../src/sync/node-keyring.js';
import { keyringPull, keyringPush } from '../../src/sync/paths.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SPACE_ID = 'sp-abc123';
const NODE_ID = 'sp-abc123-general';
const OWNER_ID = 'owner-user-id';
const MEMBER_ID = 'member-user-id';
const OTHER_ID = 'other-user-id';

const mockChatClient = { pull: vi.fn(), push: vi.fn(), append: vi.fn() } as unknown as ReturnType<typeof makeClient>;
const mockMemberClient = { pull: vi.fn(), push: vi.fn() } as unknown as ReturnType<typeof makeClient>;
const mockLinkClient = { pull: vi.fn(), push: vi.fn() } as unknown as ReturnType<typeof makeClient>;

const DEVICE_KEYS = {
  edPub: 'device-ed-pub',
  edPriv: 'device-ed-priv',
  kemPub: 'device-kem-pub',
  kemPriv: 'device-kem-priv',
};

function makeSession(userId: string) {
  return {
    userId,
    contentClient: mockChatClient,
    keys: DEVICE_KEYS,
  } as Parameters<typeof getNodeAccess>[3];
}

const MOCK_ENCRYPTOR = { seal: vi.fn(), open: vi.fn() } as unknown as Awaited<ReturnType<typeof openEncryptor>>;
const MOCK_ENCRYPTOR_2 = { seal: vi.fn(), open: vi.fn() } as unknown as Awaited<ReturnType<typeof openEncryptor>>;

const MEMBER_CAP_JSON = JSON.stringify({ kind: 'member', iss: 'issuer-ed-pub', sub: MEMBER_ID });
const LINK_CAP = { kind: 'member', iss: 'link-issuer' };
const LINK_KEY = 'link-ed-priv-hex';
const LINK_KEM_PRIV = 'link-kem-priv-hex';
const LINK_KEM_PUB = 'link-kem-pub-hex';

// ── getSpaceClient ─────────────────────────────────────────────────────────────

describe('getSpaceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSpaceAccessEntry).mockReturnValue(null);
    vi.mocked(getNodeAccessEntry).mockReturnValue(null);
    vi.mocked(makeClient).mockReturnValue(mockMemberClient);
  });

  it('returns session.contentClient when no space entry exists', () => {
    const session = makeSession(OWNER_ID);
    const client = getSpaceClient(SPACE_ID, session);
    expect(client).toBe(mockChatClient);
  });

  it('uses makeClient with cap + key for link entries', () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      write: false,
    });
    const session = makeSession(OTHER_ID);
    const client = getSpaceClient(SPACE_ID, session);
    expect(vi.mocked(makeClient)).toHaveBeenCalledWith(LINK_CAP, LINK_KEY);
    expect(client).toBe(mockMemberClient);
  });

  it('uses makeClient with parsed cap + edPriv for member entries', () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'member',
      cap: MEMBER_CAP_JSON,
    });
    const session = makeSession(MEMBER_ID);
    const client = getSpaceClient(SPACE_ID, session);
    expect(vi.mocked(makeClient)).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'member', iss: 'issuer-ed-pub' }),
      DEVICE_KEYS.edPriv,
    );
    expect(client).toBe(mockMemberClient);
  });
});

// ── getNodeAccess ──────────────────────────────────────────────────────────────

describe('getNodeAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNodeAccessCache();
    vi.mocked(getNodeAccessEntry).mockReturnValue(null);
    vi.mocked(getSpaceAccessEntry).mockReturnValue(null);
    vi.mocked(makeClient).mockReturnValue(mockMemberClient);
    vi.mocked(openEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    vi.mocked(ownerEnsureKeyring).mockResolvedValue(MOCK_ENCRYPTOR);
  });

  it('returns null encryptor for plaintext node without touching keyring', async () => {
    const session = makeSession(OWNER_ID);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: false }, session, null);
    expect(handle.encryptor).toBeNull();
    expect(vi.mocked(openEncryptor)).not.toHaveBeenCalled();
    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
  });

  it('mints keyring for owner when no entry + enc:true', async () => {
    const session = makeSession(OWNER_ID);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [] });
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledWith(
      mockChatClient,
      DEVICE_KEYS,
      keyringPull(SPACE_ID),
      keyringPush(SPACE_ID),
      expect.any(Array),
    );
    expect(handle.encryptor).toBe(MOCK_ENCRYPTOR);
    expect(handle.isOwnerOpen).toBe(true);
  });

  it('mints keyring for owner when reg is null (unknown ownership, no access entry)', async () => {
    // When reg is null AND no access entry, the code treats it as "could be owner" and mints.
    const session = makeSession(OWNER_ID);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, null);
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalled();
    expect(handle.isOwnerOpen).toBe(true);
  });

  it('throws SpaceAccessError for non-owner with known owner', async () => {
    const session = makeSession(OTHER_ID);
    await expect(
      getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [] }),
    ).rejects.toBeInstanceOf(SpaceAccessError);
    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
  });

  it('throws SpaceAccessError with member hint when caller is a known member', async () => {
    const session = makeSession(MEMBER_ID);
    await expect(
      getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [MEMBER_ID] }),
    ).rejects.toThrow(/member of this space/i);
  });

  it('opens existing keyring as recipient for member access entry', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'member',
      cap: MEMBER_CAP_JSON,
    });
    const session = makeSession(MEMBER_ID);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [MEMBER_ID] });
    expect(vi.mocked(openEncryptor)).toHaveBeenCalledWith(
      mockMemberClient,
      DEVICE_KEYS,
      keyringPull(SPACE_ID),
      expect.any(Array),
    );
    expect(handle.encryptor).toBe(MOCK_ENCRYPTOR);
    expect(handle.isOwnerOpen).toBe(false);
  });

  it('FIX C: opens keyring with EPHEMERAL KEM keypair for link entry (not session.keys)', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      kemPriv: LINK_KEM_PRIV,
      kemPub: LINK_KEM_PUB,
      write: false,
    });
    vi.mocked(makeClient).mockReturnValue(mockLinkClient);
    const session = makeSession(OTHER_ID);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [] });
    expect(vi.mocked(makeClient)).toHaveBeenCalledWith(LINK_CAP, LINK_KEY);
    // Must use the ephemeral KEM from the entry, NOT session.keys
    expect(vi.mocked(openEncryptor)).toHaveBeenCalledWith(
      mockLinkClient,
      expect.objectContaining({ kemPriv: LINK_KEM_PRIV, kemPub: LINK_KEM_PUB }),
      keyringPull(SPACE_ID),
      expect.any(Array),
    );
    // Must NOT use session.keys (device-kem-priv belongs to the joiner, not the link recipient)
    const keysArg = vi.mocked(openEncryptor).mock.calls[0]![1];
    expect(keysArg.kemPriv).not.toBe(DEVICE_KEYS.kemPriv);
    expect(handle.isOwnerOpen).toBe(false);
  });

  it('BACK-COMPAT: legacy link entry (no KEM) falls back to session.keys for openEncryptor', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      write: false,
      // No kemPriv / kemPub — pre-0.8.6 token
    });
    vi.mocked(makeClient).mockReturnValue(mockLinkClient);
    const session = makeSession(OTHER_ID);
    await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [] });
    expect(vi.mocked(openEncryptor)).toHaveBeenCalledWith(
      mockLinkClient,
      DEVICE_KEYS, // falls back to session.keys
      keyringPull(SPACE_ID),
      expect.any(Array),
    );
  });

  it('caches the result — second call returns the same promise', async () => {
    const session = makeSession(OWNER_ID);
    const p1 = getNodeAccess(SPACE_ID, NODE_ID, { enc: false }, session, null);
    const p2 = getNodeAccess(SPACE_ID, NODE_ID, { enc: false }, session, null);
    expect(p1).toBe(p2);
    await p1;
  });

  it('clears cache on rejection so a retry can attempt again', async () => {
    vi.mocked(ownerEnsureKeyring).mockRejectedValueOnce(new Error('network'));
    const session = makeSession(OWNER_ID);
    // First call — fails
    await expect(getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, null)).rejects.toThrow('network');
    // Second call — cache entry removed, tries again
    vi.mocked(ownerEnsureKeyring).mockResolvedValue(MOCK_ENCRYPTOR_2);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, null);
    expect(handle.encryptor).toBe(MOCK_ENCRYPTOR_2);
  });
});

// ── buildNodeAccess ────────────────────────────────────────────────────────────

describe('buildNodeAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNodeAccessEntry).mockReturnValue(null);
    vi.mocked(getSpaceAccessEntry).mockReturnValue(null);
    vi.mocked(makeClient).mockReturnValue(mockMemberClient);
    vi.mocked(buildEncryptor).mockResolvedValue(null);
    vi.mocked(ownerEnsureKeyring).mockResolvedValue(MOCK_ENCRYPTOR);
  });

  it('returns {client, encryptor:null} for plaintext node without touching keyring', async () => {
    const session = makeSession(OWNER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: false });
    expect(result).not.toBeNull();
    expect(result!.encryptor).toBeNull();
    expect(vi.mocked(buildEncryptor)).not.toHaveBeenCalled();
    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
  });

  it('returns {client, encryptor} when keyring exists and member entry present', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({ kind: 'member', cap: MEMBER_CAP_JSON });
    vi.mocked(buildEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(MEMBER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true });
    expect(result).not.toBeNull();
    expect(result!.encryptor).toBe(MOCK_ENCRYPTOR);
  });

  it('FIX C: uses ephemeral client AND ephemeral KEM for link entry with kemPriv/kemPub', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      kemPriv: LINK_KEM_PRIV,
      kemPub: LINK_KEM_PUB,
      write: false,
    });
    vi.mocked(makeClient).mockReturnValue(mockLinkClient);
    vi.mocked(buildEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(OTHER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true });
    expect(vi.mocked(makeClient)).toHaveBeenCalledWith(LINK_CAP, LINK_KEY);
    // Must use ephemeral KEM, not session.keys
    expect(vi.mocked(buildEncryptor)).toHaveBeenCalledWith(
      mockLinkClient,
      expect.objectContaining({ kemPriv: LINK_KEM_PRIV, kemPub: LINK_KEM_PUB }),
      expect.any(String),
      expect.any(Array),
    );
    const keysArg = vi.mocked(buildEncryptor).mock.calls[0]![1];
    expect(keysArg.kemPriv).not.toBe(DEVICE_KEYS.kemPriv);
    expect(result).not.toBeNull();
  });

  it('BACK-COMPAT: legacy link entry (no KEM) falls back to session.keys for buildEncryptor', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      write: false,
      // No kemPriv / kemPub
    });
    vi.mocked(makeClient).mockReturnValue(mockLinkClient);
    vi.mocked(buildEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(OTHER_ID);
    await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true });
    expect(vi.mocked(buildEncryptor)).toHaveBeenCalledWith(
      mockLinkClient,
      DEVICE_KEYS, // falls back to session.keys
      expect.any(String),
      expect.any(Array),
    );
  });

  it('returns null when no keyring and no reg provided', async () => {
    const session = makeSession(OWNER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true });
    expect(result).toBeNull();
    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
  });

  it('FIX B: mints keyring when caller is owner and keyring missing (reg provided)', async () => {
    const session = makeSession(OWNER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true }, { owner: OWNER_ID });
    expect(vi.mocked(ownerEnsureKeyring)).toHaveBeenCalledWith(
      mockChatClient,
      DEVICE_KEYS,
      keyringPull(SPACE_ID),
      keyringPush(SPACE_ID),
      expect.any(Array),
    );
    expect(result).not.toBeNull();
    expect(result!.encryptor).toBe(MOCK_ENCRYPTOR);
  });

  it('FIX B: does NOT mint and returns null for non-owner even with reg provided', async () => {
    const session = makeSession(MEMBER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true }, { owner: OWNER_ID, members: [MEMBER_ID] });
    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns existing encryptor without minting when keyring already exists', async () => {
    vi.mocked(buildEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(OWNER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true }, { owner: OWNER_ID });
    // keyring existed -> should NOT call ownerEnsureKeyring
    expect(vi.mocked(ownerEnsureKeyring)).not.toHaveBeenCalled();
    expect(result!.encryptor).toBe(MOCK_ENCRYPTOR);
  });
});

// ── Per-node keyring branch (access:'invite' + enc, e.g. E2EE tickets) ──────────

describe('getNodeAccess — per-node keyring (invite + enc)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNodeAccessCache();
    vi.mocked(getSpaceAccessEntry).mockReturnValue(null);
    vi.mocked(getNodeAccessEntry).mockReturnValue(null);
    vi.mocked(getNodeKeyringAccessEntry).mockReturnValue(null);
    vi.mocked(makeClient).mockReturnValue(mockMemberClient);
    vi.mocked(openNodeEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
  });

  it('isolated requester: opens the NODE keyring via the keyring cap client (not the space keyring)', async () => {
    vi.mocked(getNodeKeyringAccessEntry).mockReturnValue({ kind: 'member', cap: MEMBER_CAP_JSON });
    vi.mocked(getNodeAccessEntry).mockReturnValue({ kind: 'member', cap: MEMBER_CAP_JSON });
    const session = makeSession(OTHER_ID);
    const result = await getNodeAccess(SPACE_ID, NODE_ID, { access: 'invite', enc: true }, session, { owner: OWNER_ID, members: [] });
    expect(openNodeEncryptor).toHaveBeenCalledWith(mockMemberClient, DEVICE_KEYS, SPACE_ID, NODE_ID, ['issuer-ed-pub']);
    expect(openEncryptor).not.toHaveBeenCalled(); // NOT the space keyring
    expect(result.encryptor).toBe(MOCK_ENCRYPTOR);
  });

  it('space member / owner (no keyring entry): opens the NODE keyring via session.contentClient', async () => {
    const session = makeSession(OWNER_ID);
    const result = await getNodeAccess(SPACE_ID, NODE_ID, { access: 'invite', enc: true }, session, { owner: OWNER_ID, members: [] });
    expect(openNodeEncryptor).toHaveBeenCalledWith(mockChatClient, DEVICE_KEYS, SPACE_ID, NODE_ID, [OWNER_ID]);
    expect(result.encryptor).toBe(MOCK_ENCRYPTOR);
    expect(result.isOwnerOpen).toBe(true);
  });

  it('propagates SpaceAccessError when the node keyring cannot be opened (not a recipient)', async () => {
    vi.mocked(openNodeEncryptor).mockRejectedValue(new SpaceAccessError('not a recipient'));
    const session = makeSession(OTHER_ID);
    await expect(
      getNodeAccess(SPACE_ID, NODE_ID, { access: 'invite', enc: true }, session, { owner: OWNER_ID, members: [] }),
    ).rejects.toBeInstanceOf(SpaceAccessError);
  });

  it('does NOT use the node keyring for space-tier enc nodes (back-compat: space keyring)', async () => {
    vi.mocked(openEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(MEMBER_ID);
    vi.mocked(getSpaceAccessEntry).mockReturnValue({ kind: 'member', cap: MEMBER_CAP_JSON });
    await getNodeAccess(SPACE_ID, NODE_ID, { access: 'space', enc: true }, session, { owner: OWNER_ID, members: [MEMBER_ID] });
    expect(openNodeEncryptor).not.toHaveBeenCalled();
    expect(openEncryptor).toHaveBeenCalled();
  });
});

describe('buildNodeAccess — per-node keyring (invite + enc)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSpaceAccessEntry).mockReturnValue(null);
    vi.mocked(getNodeAccessEntry).mockReturnValue(null);
    vi.mocked(getNodeKeyringAccessEntry).mockReturnValue(null);
    vi.mocked(makeClient).mockReturnValue(mockMemberClient);
  });

  it('soft-opens the node keyring and returns {client, encryptor}', async () => {
    vi.mocked(buildNodeEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(OWNER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { access: 'invite', enc: true }, { owner: OWNER_ID });
    expect(buildNodeEncryptor).toHaveBeenCalledWith(mockChatClient, DEVICE_KEYS, SPACE_ID, NODE_ID, [OWNER_ID]);
    expect(result!.encryptor).toBe(MOCK_ENCRYPTOR);
  });

  it('returns null when the node keyring is not open-able yet (soft)', async () => {
    vi.mocked(buildNodeEncryptor).mockResolvedValue(null);
    const session = makeSession(OTHER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { access: 'invite', enc: true }, { owner: OWNER_ID });
    expect(result).toBeNull();
  });

  it('without an access flag, keeps legacy space-keyring resolution (back-compat)', async () => {
    vi.mocked(buildEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(OWNER_ID);
    await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true }, { owner: OWNER_ID });
    expect(buildNodeEncryptor).not.toHaveBeenCalled();
    expect(buildEncryptor).toHaveBeenCalled();
  });
});
