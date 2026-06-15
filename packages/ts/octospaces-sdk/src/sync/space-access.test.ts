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
 *     - no entry → session.chatClient
 *     - link entry → makeClient with cap + key
 *     - member entry → makeClient with parsed cap + edPriv
 *
 * NOTE: vi.mock factories are hoisted — never reference module-level consts inside them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('./client.js', () => ({
  openEncryptor: vi.fn(),
  buildEncryptor: vi.fn(),
  ownerEnsureKeyring: vi.fn(),
  makeClient: vi.fn(),
}));

vi.mock('./space-access-store.js', () => ({
  getNodeAccessEntry: vi.fn().mockReturnValue(null),
  getSpaceAccessEntry: vi.fn().mockReturnValue(null),
}));

vi.mock('./identity.js', () => ({
  ownerTrustedAdders: vi.fn().mockReturnValue(['owner-ed-pub']),
}));

vi.mock('./paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./paths.js')>();
  return { ...original };
});

// ── Imports (after vi.mock declarations) ──────────────────────────────────────

import {
  getNodeAccess,
  buildNodeAccess,
  getSpaceClient,
  clearNodeAccessCache,
  SpaceAccessError,
} from './space-access.js';
import {
  openEncryptor,
  buildEncryptor,
  ownerEnsureKeyring,
  makeClient,
} from './client.js';
import { getNodeAccessEntry, getSpaceAccessEntry } from './space-access-store.js';
import { keyringPull, keyringPush } from './paths.js';

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
    chatClient: mockChatClient,
    keys: DEVICE_KEYS,
  } as Parameters<typeof getNodeAccess>[3];
}

const MOCK_ENCRYPTOR = { seal: vi.fn(), open: vi.fn() } as unknown as Awaited<ReturnType<typeof openEncryptor>>;
const MOCK_ENCRYPTOR_2 = { seal: vi.fn(), open: vi.fn() } as unknown as Awaited<ReturnType<typeof openEncryptor>>;

const MEMBER_CAP_JSON = JSON.stringify({ kind: 'member', iss: 'issuer-ed-pub', sub: MEMBER_ID });
const LINK_CAP = { kind: 'member', iss: 'link-issuer' };
const LINK_KEY = 'link-ed-priv-hex';

// ── getSpaceClient ─────────────────────────────────────────────────────────────

describe('getSpaceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSpaceAccessEntry).mockReturnValue(null);
    vi.mocked(getNodeAccessEntry).mockReturnValue(null);
    vi.mocked(makeClient).mockReturnValue(mockMemberClient);
  });

  it('returns session.chatClient when no space entry exists', () => {
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

  it('opens keyring with ephemeral client for link access entry', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      write: false,
    });
    vi.mocked(makeClient).mockReturnValue(mockLinkClient);
    const session = makeSession(OTHER_ID);
    const handle = await getNodeAccess(SPACE_ID, NODE_ID, { enc: true }, session, { owner: OWNER_ID, members: [] });
    expect(vi.mocked(makeClient)).toHaveBeenCalledWith(LINK_CAP, LINK_KEY);
    expect(vi.mocked(openEncryptor)).toHaveBeenCalledWith(
      mockLinkClient,
      DEVICE_KEYS,
      keyringPull(SPACE_ID),
      expect.any(Array),
    );
    expect(handle.isOwnerOpen).toBe(false);
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

  it('uses ephemeral client for link entry', async () => {
    vi.mocked(getSpaceAccessEntry).mockReturnValue({
      kind: 'link',
      cap: LINK_CAP,
      key: LINK_KEY,
      write: false,
    });
    vi.mocked(makeClient).mockReturnValue(mockLinkClient);
    vi.mocked(buildEncryptor).mockResolvedValue(MOCK_ENCRYPTOR);
    const session = makeSession(OTHER_ID);
    const result = await buildNodeAccess(session, SPACE_ID, NODE_ID, { enc: true });
    expect(vi.mocked(makeClient)).toHaveBeenCalledWith(LINK_CAP, LINK_KEY);
    expect(result).not.toBeNull();
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
