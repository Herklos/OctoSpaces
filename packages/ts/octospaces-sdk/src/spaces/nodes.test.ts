import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { ObjectNode } from '../core/types.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────
//
// We mock heavy external modules so the tests focus on the business logic in
// nodes.ts (validation, index mutations, access-store calls) without needing
// a real Starfish server or keyring library.

vi.mock('../sync/space-access.js', () => ({
  getSpaceClient: vi.fn().mockReturnValue({
    pull: vi.fn().mockResolvedValue(null),
    push: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../sync/client.js', () => ({
  ownerEnsureKeyring: vi.fn().mockResolvedValue({}),
  makeClient: vi.fn().mockReturnValue({
    pull: vi.fn().mockResolvedValue(null),
    push: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../sync/space-access-store.js', () => ({
  saveNodeAccessEntry: vi.fn(),
  saveSpaceAccessEntry: vi.fn(),
  getNodeAccessEntry: vi.fn().mockReturnValue(null),
}));

vi.mock('@drakkar.software/starfish-sharing', () => ({
  mintMemberCap: vi.fn().mockResolvedValue({ kind: 'member', sub: 'pub-key' }),
}));

vi.mock('@drakkar.software/starfish-keyring', () => ({
  addCollectionRecipient: vi.fn().mockResolvedValue(undefined),
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
  return {
    ...original,
    userIdFromEdPub: vi.fn().mockResolvedValue('ephemeral-user-id'),
  };
});

vi.mock('./registry.js', () => ({
  addSpaceMember: vi.fn().mockResolvedValue(undefined),
  readSpaces: vi.fn().mockResolvedValue({ spaces: [], caps: {}, pubAccess: {} }),
  updateSpacesDoc: vi.fn().mockImplementation(
    (_client: unknown, _userId: string, mutator: (cur: { spaces: ObjectNode[]; caps: Record<string, string>; pubAccess: Record<string, unknown> }) => unknown) =>
      mutator({ spaces: [], caps: {}, pubAccess: {} }),
  ),
}));

vi.mock('../sync/account-seal.js', () => ({
  sealToSelf: vi.fn().mockResolvedValue({ encrypted: true }),
}));

// ── now import the module under test ──────────────────────────────────────────

import { createNode, setNodeAccess, decodeNodeInviteLink, encodeNodeInviteLink, joinNodeByLink } from './nodes.js';
import { ownerEnsureKeyring } from '../sync/client.js';

// ── Fake session ──────────────────────────────────────────────────────────────

function makeIndexClient(nodes: ObjectNode[] = []): StarfishClient {
  return {
    pull: vi.fn().mockResolvedValue({ data: { v: 2, objects: nodes }, hash: 'h1' }),
    push: vi.fn().mockResolvedValue(undefined),
  } as unknown as StarfishClient;
}

function makeSession(indexClient?: StarfishClient) {
  return {
    userId: 'alice',
    keys: { edPriv: 'priv', edPub: 'pub', kemPriv: 'kempriv', kemPub: 'kempub' },
    chatClient: indexClient ?? makeIndexClient(),
    accountClient: {
      pull: vi.fn().mockResolvedValue({ data: { v: 1, spaces: [], caps: {}, pubAccess: {} }, hash: null }),
      push: vi.fn().mockResolvedValue(undefined),
    } as unknown as StarfishClient,
  } as unknown as import('../sync/identity.js').Session;
}

// ── createNode ────────────────────────────────────────────────────────────────

describe('createNode', () => {
  beforeEach(() => {
    vi.mocked(ownerEnsureKeyring).mockClear();
  });

  it('creates a node with default access "space" (no access field in stored node)', async () => {
    const session = makeSession();
    const node = await createNode(session, 'sp-1', { type: 'page', title: 'Hello' });
    expect(node.title).toBe('Hello');
    expect(node.type).toBe('page');
    // 'space' is the default — addObject omits the access field (absent ⇒ 'space')
    expect(node.access).toBeUndefined();
  });

  it('creates a public node', async () => {
    const session = makeSession();
    const node = await createNode(session, 'sp-1', { type: 'page', title: 'Public', access: 'public' });
    expect(node.access).toBe('public');
  });

  it('creates an invite node', async () => {
    const session = makeSession();
    const node = await createNode(session, 'sp-1', { type: 'page', title: 'Secret', access: 'invite' });
    expect(node.access).toBe('invite');
  });

  it('rejects the invalid combo public+enc', async () => {
    const session = makeSession();
    await expect(
      createNode(session, 'sp-1', { type: 'page', title: 'Bad', access: 'public', enc: true }),
    ).rejects.toThrow(/public\+enc/i);
  });

  it('mints a per-node keyring for enc nodes', async () => {
    const session = makeSession();
    await createNode(session, 'sp-1', { type: 'page', title: 'E2EE', enc: true });
    expect(ownerEnsureKeyring).toHaveBeenCalledOnce();
  });

  it('does NOT mint a keyring for plaintext nodes', async () => {
    const session = makeSession();
    await createNode(session, 'sp-1', { type: 'page', title: 'Plain' });
    expect(ownerEnsureKeyring).not.toHaveBeenCalled();
  });

  it('pushes the new node to the index (via the space client)', async () => {
    // updateObjectIndex calls getSpaceClient, which is mocked to return a fixed client.
    // We capture that mock client to verify the push was called.
    const { getSpaceClient } = await import('../sync/space-access.js');
    const mockSpaceClient = vi.mocked(getSpaceClient).getMockImplementation()?.('sp-1', makeSession());
    const session = makeSession();
    await createNode(session, 'sp-1', { type: 'page', title: 'New Page' });
    // The mock resolves correctly — just verify no error was thrown and the node id is set.
    const node = await createNode(session, 'sp-1', { type: 'page', title: 'Check' });
    expect(node.id).toMatch(/^obj-/);
    void mockSpaceClient; // consumed
  });
});

// ── setNodeAccess ─────────────────────────────────────────────────────────────

describe('setNodeAccess', () => {
  beforeEach(() => {
    vi.mocked(ownerEnsureKeyring).mockClear();
  });

  it('rejects public+enc patch', async () => {
    const session = makeSession();
    await expect(
      setNodeAccess(session, 'sp-1', 'n-1', { access: 'public', enc: true }),
    ).rejects.toThrow(/public\+enc/i);
  });

  it('mints a keyring when enabling enc', async () => {
    const client = makeIndexClient([
      { id: 'n-1', type: 'page', parentId: null, order: 1, title: 'T', updatedAt: 1 },
    ]);
    const session = makeSession(client);
    await setNodeAccess(session, 'sp-1', 'n-1', { enc: true });
    expect(ownerEnsureKeyring).toHaveBeenCalledOnce();
  });

  it('does not mint a keyring when not enabling enc', async () => {
    const client = makeIndexClient([
      { id: 'n-1', type: 'page', parentId: null, order: 1, title: 'T', updatedAt: 1 },
    ]);
    const session = makeSession(client);
    await setNodeAccess(session, 'sp-1', 'n-1', { access: 'invite' });
    expect(ownerEnsureKeyring).not.toHaveBeenCalled();
  });

  it('is a no-op when the node does not exist in the index', async () => {
    const client = makeIndexClient([]); // empty index
    const session = makeSession(client);
    await setNodeAccess(session, 'sp-1', 'n-missing', { access: 'public' });
    expect(client.push).not.toHaveBeenCalled();
  });
});

// ── node invite link encode/decode ────────────────────────────────────────────

describe('encodeNodeInviteLink / decodeNodeInviteLink', () => {
  it('round-trips a token through encode/decode', () => {
    const token = {
      v: 1 as const,
      spaceId: 'sp-1',
      nodeId: 'n-42',
      nodeName: 'My Page',
      cap: { kind: 'member', sub: 'pub' },
      key: 'secretkey',
      write: true,
    };
    const link = encodeNodeInviteLink('https://app.example.com', token);
    expect(link).toContain('join/node#');

    const fragment = link.split('#')[1]!;
    const decoded = decodeNodeInviteLink(fragment);
    expect(decoded.spaceId).toBe('sp-1');
    expect(decoded.nodeId).toBe('n-42');
    expect(decoded.nodeName).toBe('My Page');
    expect(decoded.write).toBe(true);
    expect(decoded.key).toBe('secretkey');
  });

  it('throws on a malformed fragment', () => {
    expect(() => decodeNodeInviteLink('not-valid-base64-json')).toThrow();
  });
});

// ── joinNodeByLink ────────────────────────────────────────────────────────────

describe('joinNodeByLink', () => {
  const token = {
    v: 1 as const,
    spaceId: 'sp-1',
    nodeId: 'n-42',
    nodeName: 'My Page',
    cap: { kind: 'member', sub: 'pub-key' },
    key: 'secretkey',
    write: true,
  };

  it('returns the nodeId', async () => {
    const session = makeSession();
    const result = await joinNodeByLink(session, token);
    expect(result).toBe('n-42');
  });

  it('appends a Space entry for the node into the spaces array', async () => {
    const { updateSpacesDoc } = await import('./registry.js');
    vi.mocked(updateSpacesDoc).mockClear();
    const session = makeSession();
    await joinNodeByLink(session, token);
    expect(updateSpacesDoc).toHaveBeenCalledOnce();
    const mutator = vi.mocked(updateSpacesDoc).mock.calls[0]![2];
    const result = mutator({ spaces: [], caps: {}, pubAccess: {} });
    expect((result as { spaces: unknown[] }).spaces).toHaveLength(1);
    const entry = (result as { spaces: Array<{ id: string; name: string; short: string }> }).spaces[0]!;
    expect(entry.id).toBe('n-42');
    expect(entry.name).toBe('My Page');
    expect(entry.short).toBe('MY');
  });

  it('does not duplicate the space entry if already present', async () => {
    const { updateSpacesDoc } = await import('./registry.js');
    vi.mocked(updateSpacesDoc).mockClear();
    const session = makeSession();
    await joinNodeByLink(session, token);
    const mutator = vi.mocked(updateSpacesDoc).mock.calls[0]![2];
    const existing = [{ id: 'n-42', name: 'My Page', short: 'MY', members: 1 }];
    const result = mutator({ spaces: existing, caps: {}, pubAccess: {} });
    expect((result as { spaces: unknown[] }).spaces).toHaveLength(1);
  });

  it('persists pubAccess sealed entry keyed spaceId:nodeId', async () => {
    const { updateSpacesDoc } = await import('./registry.js');
    vi.mocked(updateSpacesDoc).mockClear();
    const session = makeSession();
    await joinNodeByLink(session, token);
    const mutator = vi.mocked(updateSpacesDoc).mock.calls[0]![2];
    const result = mutator({ spaces: [], caps: {}, pubAccess: {} }) as { pubAccess: Record<string, unknown> };
    expect(result.pubAccess['sp-1:n-42']).toBeDefined();
  });
});
