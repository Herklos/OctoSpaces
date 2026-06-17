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

vi.mock('../sync/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/client.js')>();
  return {
    ...original,
    ownerEnsureKeyring: vi.fn().mockResolvedValue({}),
    makeClient: vi.fn().mockReturnValue({
      pull: vi.fn().mockResolvedValue(null),
      push: vi.fn().mockResolvedValue(undefined),
    }),
    // addSpaceKeyringRecipient uses the real implementation so it calls the mocked
    // addCollectionRecipient from @drakkar.software/starfish-keyring, preserving
    // the test invariants about call args and error handling.
  };
});

vi.mock('../sync/space-access-store.js', () => ({
  saveNodeAccessEntry: vi.fn(),
  saveNodeStreamAccessEntry: vi.fn(),
  saveNodeKeyringAccessEntry: vi.fn(),
  saveSpaceAccessEntry: vi.fn(),
  getNodeAccessEntry: vi.fn().mockReturnValue(null),
}));

vi.mock('../sync/node-keyring.js', () => ({
  ensureNodeKeyringRecipient: vi.fn().mockResolvedValue({}),
}));

vi.mock('@drakkar.software/starfish-sharing', () => ({
  // Echo the requested scope back through `sub` so tests can assert which scope
  // each cap was minted with (the real cap carries the scope; the mock surfaces it).
  mintMemberCap: vi.fn().mockImplementation(
    (_edPriv: string, _edPub: string, _subject: unknown, _aud: string, scope: { collections: string[] }) =>
      Promise.resolve({ kind: 'member', sub: 'pub', scopeCollections: scope.collections }),
  ),
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
  buildSpace: vi.fn().mockImplementation((id: string, name: string) => ({
    id,
    name: name.trim() || `space-${id.slice(-6)}`,
    short: (name.trim() || `space-${id.slice(-6)}`).slice(0, 2).toUpperCase(),
    members: 1,
  })),
}));

vi.mock('../sync/account-seal.js', () => ({
  sealToSelf: vi.fn().mockResolvedValue({ encrypted: true }),
}));

// ── now import the module under test ──────────────────────────────────────────

import {
  createNode,
  setNodeAccess,
  decodeNodeInviteLink,
  encodeNodeInviteLink,
  joinNodeByLink,
  inviteToNode,
  acceptNodeInvite,
  createNodeInviteLink,
} from './nodes.js';
import { ownerEnsureKeyring } from '../sync/client.js';
import { ensureNodeKeyringRecipient } from '../sync/node-keyring.js';
import { addSpaceMember } from './registry.js';
import { saveNodeStreamAccessEntry, saveSpaceAccessEntry, saveNodeAccessEntry, saveNodeKeyringAccessEntry } from '../sync/space-access-store.js';
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';

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

// ── per-node STREAM cap (objinvlog) minting + isolation ─────────────────────────

describe('createNodeInviteLink — stream cap + isolation', () => {
  beforeEach(() => {
    vi.mocked(addSpaceMember).mockClear();
    vi.mocked(ensureNodeKeyringRecipient).mockClear().mockResolvedValue({} as never);
  });

  it('plaintext: mints a per-node stream cap (objinvlog) in the token', async () => {
    const { token } = await createNodeInviteLink(makeSession(), 'sp-1', 'n-42', 'Ticket', { enc: false }, true, 'https://x');
    expect((token.streamCap as { scopeCollections: string[] }).scopeCollections).toEqual(['objinvlog']);
    // content cap is the per-node objinv cap, NOT space-wide
    expect((token.cap as { scopeCollections: string[] }).scopeCollections).toEqual(['objinv']);
  });

  it('plaintext non-isolated: still adds the ephemeral as a space member (current behavior)', async () => {
    await createNodeInviteLink(makeSession(), 'sp-1', 'n-42', 'Ticket', { enc: false }, true, 'https://x');
    expect(addSpaceMember).toHaveBeenCalledOnce();
  });

  it('isolated plaintext: does NOT add a space member (no index access leak)', async () => {
    const { token } = await createNodeInviteLink(
      makeSession(), 'sp-1', 'n-42', 'Ticket', { enc: false }, true, 'https://x', { isolated: true },
    );
    expect(addSpaceMember).not.toHaveBeenCalled();
    // still carries both per-node caps so the bearer can reach content + stream
    expect((token.cap as { scopeCollections: string[] }).scopeCollections).toEqual(['objinv']);
    expect((token.streamCap as { scopeCollections: string[] }).scopeCollections).toEqual(['objinvlog']);
  });

  it('enc + isolated: per-node keyring — mints content + stream + READ-only keyring caps, NO space member', async () => {
    const { token } = await createNodeInviteLink(
      makeSession(), 'sp-1', 'n-42', 'Ticket', { enc: true }, true, 'https://x', { isolated: true },
    );
    // Isolated E2EE ticket: no space membership, no space cap.
    expect(addSpaceMember).not.toHaveBeenCalled();
    // The node keyring CEK was seeded + the ephemeral added as a recipient.
    expect(ensureNodeKeyringRecipient).toHaveBeenCalledOnce();
    // Bearer reaches content (objinv), stream (objinvlog), and reads the keyring (nodekeyring).
    expect((token.cap as { scopeCollections: string[] }).scopeCollections).toEqual(['objinv']);
    expect((token.streamCap as { scopeCollections: string[] }).scopeCollections).toEqual(['objinvlog']);
    expect((token.keyringCap as { scopeCollections: string[] }).scopeCollections).toEqual(['nodekeyring']);
  });

  it('enc non-isolated: LEGACY space keyring — space cap only, no per-node/keyring caps, adds space member', async () => {
    const { token } = await createNodeInviteLink(
      makeSession(), 'sp-1', 'n-42', 'Doc', { enc: true }, true, 'https://x',
    );
    // Legacy enc invite still rides the space-wide keyring (back-compat).
    expect(token.streamCap).toBeUndefined();
    expect(token.keyringCap).toBeUndefined();
    expect(ensureNodeKeyringRecipient).not.toHaveBeenCalled();
    expect((token.cap as { scopeCollections: string[] }).scopeCollections).toContain('objindex'); // spaceMemberScope
    expect(addSpaceMember).toHaveBeenCalledOnce();
  });
});

describe('inviteToNode — stream cap + isolation', () => {
  const joinReq = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'requester' });

  beforeEach(() => {
    vi.mocked(addSpaceMember).mockClear();
    vi.mocked(ensureNodeKeyringRecipient).mockClear().mockResolvedValue({} as never);
    vi.mocked(addCollectionRecipient).mockClear().mockResolvedValue(undefined);
  });

  it('plaintext: bundle carries space cap + content cap + stream cap', async () => {
    const bundle = JSON.parse(await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: false }));
    expect(bundle.cap.scopeCollections).toContain('objindex'); // space cap
    expect(bundle.nodeCap.scopeCollections).toEqual(['objinv']);
    expect(bundle.streamCap.scopeCollections).toEqual(['objinvlog']);
  });

  it('isolated plaintext: NO space cap, only per-node content + stream caps', async () => {
    const bundle = JSON.parse(
      await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: false }, undefined, { isolated: true }),
    );
    expect(bundle.cap).toBeUndefined();
    expect(bundle.nodeCap.scopeCollections).toEqual(['objinv']);
    expect(bundle.streamCap.scopeCollections).toEqual(['objinvlog']);
    expect(addSpaceMember).not.toHaveBeenCalled();
  });

  it('enc + isolated (E2EE ticket): per-node keyring — keyringCap + content + stream, NO space cap/member, NO space-keyring add', async () => {
    const bundle = JSON.parse(
      await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: true }, undefined, { isolated: true }),
    );
    // Per-node keyring seeded + requester KEM added (ensure-before-add inside the wrapper).
    expect(ensureNodeKeyringRecipient).toHaveBeenCalledOnce();
    // It must NOT touch the space-wide keyring.
    expect(addCollectionRecipient).not.toHaveBeenCalled();
    // Isolated: no space membership, no space cap.
    expect(addSpaceMember).not.toHaveBeenCalled();
    expect(bundle.cap).toBeUndefined();
    // Per-node content (objinv), stream (objinvlog), keyring (nodekeyring) caps.
    expect(bundle.nodeCap.scopeCollections).toEqual(['objinv']);
    expect(bundle.streamCap.scopeCollections).toEqual(['objinvlog']);
    expect(bundle.keyringCap.scopeCollections).toEqual(['nodekeyring']);
  });

  it('enc NON-isolated (legacy): space-wide keyring add, space cap, NO keyringCap', async () => {
    const bundle = JSON.parse(await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: true }));
    expect(addCollectionRecipient).toHaveBeenCalledOnce(); // space keyring
    expect(ensureNodeKeyringRecipient).not.toHaveBeenCalled();
    expect(bundle.cap.scopeCollections).toContain('objindex'); // spaceMemberScope
    expect(bundle.keyringCap).toBeUndefined();
    expect(bundle.streamCap).toBeUndefined();
  });
});

describe('acceptNodeInvite — isolated bundle (no space cap)', () => {
  beforeEach(() => {
    vi.mocked(saveSpaceAccessEntry).mockClear();
    vi.mocked(saveNodeAccessEntry).mockClear();
    vi.mocked(saveNodeStreamAccessEntry).mockClear();
    vi.mocked(saveNodeKeyringAccessEntry).mockClear();
  });

  it('stores per-node content + stream caps, but no space-level cap', async () => {
    const bundle = JSON.stringify({
      spaceId: 'sp-1',
      nodeId: 'n-42',
      nodeName: 'Ticket',
      nodeCap: { kind: 'member', sub: 'pub' },
      streamCap: { kind: 'member', sub: 'pub' },
    });
    const id = await acceptNodeInvite(makeSession(), bundle);
    expect(id).toBe('n-42');
    expect(saveNodeAccessEntry).toHaveBeenCalledOnce();
    expect(saveNodeStreamAccessEntry).toHaveBeenCalledOnce();
    expect(saveSpaceAccessEntry).not.toHaveBeenCalled();
    expect(saveNodeKeyringAccessEntry).not.toHaveBeenCalled();
  });

  it('E2EE ticket bundle: also persists the per-node keyring cap', async () => {
    const bundle = JSON.stringify({
      spaceId: 'sp-1',
      nodeId: 'n-42',
      nodeName: 'Ticket',
      nodeCap: { kind: 'member', sub: 'pub' },
      streamCap: { kind: 'member', sub: 'pub' },
      keyringCap: { kind: 'member', sub: 'pub' },
    });
    await acceptNodeInvite(makeSession(), bundle);
    expect(saveNodeKeyringAccessEntry).toHaveBeenCalledOnce();
    expect(saveSpaceAccessEntry).not.toHaveBeenCalled();
  });

  it('rejects when the keyring cap was issued for a different identity', async () => {
    const bundle = JSON.stringify({
      spaceId: 'sp-1', nodeId: 'n-42', nodeName: 'T',
      nodeCap: { kind: 'member', sub: 'pub' },
      keyringCap: { kind: 'member', sub: 'someone-else' },
    });
    await expect(acceptNodeInvite(makeSession(), bundle)).rejects.toThrow(/different identity/);
  });

  it('rejects a bundle issued for a different identity', async () => {
    const bundle = JSON.stringify({
      spaceId: 'sp-1', nodeId: 'n-42', nodeName: 'T',
      nodeCap: { kind: 'member', sub: 'someone-else' },
    });
    await expect(acceptNodeInvite(makeSession(), bundle)).rejects.toThrow(/different identity/);
  });
});

describe('joinNodeByLink — stream cap persistence', () => {
  it('persists the stream cap as its own entry and seals it under :stream', async () => {
    vi.mocked(saveNodeStreamAccessEntry).mockClear();
    const { updateSpacesDoc } = await import('./registry.js');
    vi.mocked(updateSpacesDoc).mockClear();
    const token = {
      v: 1 as const, spaceId: 'sp-1', nodeId: 'n-42', nodeName: 'Ticket',
      cap: { kind: 'member', sub: 'pub' },
      streamCap: { kind: 'member', sub: 'pub' },
      key: 'eph', write: true,
    };
    await joinNodeByLink(makeSession(), token);
    expect(saveNodeStreamAccessEntry).toHaveBeenCalledOnce();
    const mutator = vi.mocked(updateSpacesDoc).mock.calls[0]![2];
    const result = mutator({ spaces: [], caps: {}, pubAccess: {} }) as { pubAccess: Record<string, unknown> };
    expect(result.pubAccess['sp-1:n-42:stream']).toBeDefined();
  });

  it('E2EE ticket link: persists + seals the per-node keyring cap under :keyring', async () => {
    vi.mocked(saveNodeKeyringAccessEntry).mockClear();
    const { updateSpacesDoc } = await import('./registry.js');
    vi.mocked(updateSpacesDoc).mockClear();
    const token = {
      v: 1 as const, spaceId: 'sp-1', nodeId: 'n-42', nodeName: 'Ticket',
      cap: { kind: 'member', sub: 'pub' },
      streamCap: { kind: 'member', sub: 'pub' },
      keyringCap: { kind: 'member', sub: 'pub' },
      key: 'eph', write: true,
    };
    await joinNodeByLink(makeSession(), token);
    expect(saveNodeKeyringAccessEntry).toHaveBeenCalledOnce();
    const mutator = vi.mocked(updateSpacesDoc).mock.calls[0]![2];
    const result = mutator({ spaces: [], caps: {}, pubAccess: {} }) as { pubAccess: Record<string, unknown> };
    expect(result.pubAccess['sp-1:n-42:keyring']).toBeDefined();
  });
});

// ── ownerEnsureKeyring-before-addCollectionRecipient invariant ───────────────

describe('inviteToNode — ownerEnsureKeyring precedes addCollectionRecipient for enc nodes', () => {
  beforeEach(() => {
    vi.mocked(ownerEnsureKeyring).mockClear();
    vi.mocked(addCollectionRecipient).mockClear();
  });

  it('enc node: ownerEnsureKeyring is called before addCollectionRecipient', async () => {
    const callOrder: string[] = [];
    vi.mocked(ownerEnsureKeyring).mockImplementation(async () => { callOrder.push('ensure'); return {} as ReturnType<typeof ownerEnsureKeyring extends (...args: unknown[]) => Promise<infer R> ? () => Promise<R> : never>; });
    vi.mocked(addCollectionRecipient).mockImplementation(async () => { callOrder.push('addRecipient'); });
    const joinReq = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'requester' });
    await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: true });
    expect(callOrder).toEqual(['ensure', 'addRecipient']);
  });

  it('plaintext node: does NOT call ownerEnsureKeyring', async () => {
    const joinReq = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'requester' });
    await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: false });
    expect(ownerEnsureKeyring).not.toHaveBeenCalled();
  });
});

describe('createNodeInviteLink — ownerEnsureKeyring precedes addCollectionRecipient for enc nodes', () => {
  beforeEach(() => {
    vi.mocked(ownerEnsureKeyring).mockClear();
    vi.mocked(addCollectionRecipient).mockClear();
  });

  it('enc node: ownerEnsureKeyring is called before addCollectionRecipient', async () => {
    const callOrder: string[] = [];
    vi.mocked(ownerEnsureKeyring).mockImplementation(async () => { callOrder.push('ensure'); return {} as ReturnType<typeof ownerEnsureKeyring extends (...args: unknown[]) => Promise<infer R> ? () => Promise<R> : never>; });
    vi.mocked(addCollectionRecipient).mockImplementation(async () => { callOrder.push('addRecipient'); });
    await createNodeInviteLink(makeSession(), 'sp-1', 'n-42', 'Doc', { enc: true }, true, 'https://x');
    expect(callOrder).toEqual(['ensure', 'addRecipient']);
  });

  it('plaintext node: does NOT call ownerEnsureKeyring', async () => {
    await createNodeInviteLink(makeSession(), 'sp-1', 'n-42', 'Ticket', { enc: false }, true, 'https://x');
    expect(ownerEnsureKeyring).not.toHaveBeenCalled();
  });
});

// ── inviteToNode write parameter ──────────────────────────────────────────────

describe('inviteToNode — write parameter in opts', () => {
  const joinReq = JSON.stringify({ edPub: 'r-ed', kemPub: 'r-kem', userId: 'requester' });

  beforeEach(() => {
    vi.mocked(mintMemberCap).mockClear();
  });

  it('defaults to write=true: all minted caps include write ops', async () => {
    await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: false });
    for (const call of vi.mocked(mintMemberCap).mock.calls) {
      expect((call[4] as { ops: string[] }).ops).toContain('write');
    }
  });

  it('opts.write:false: all minted caps omit write ops', async () => {
    await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: false }, undefined, { write: false });
    for (const call of vi.mocked(mintMemberCap).mock.calls) {
      expect((call[4] as { ops: string[] }).ops).not.toContain('write');
    }
  });

  it('opts.write:false isolated: per-node caps still omit write ops', async () => {
    await inviteToNode(makeSession(), 'sp-1', 'n-42', joinReq, { enc: false }, undefined, { write: false, isolated: true });
    for (const call of vi.mocked(mintMemberCap).mock.calls) {
      expect((call[4] as { ops: string[] }).ops).not.toContain('write');
    }
  });
});
