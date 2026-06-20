import { describe, it, expect, vi } from 'vitest';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { ObjectNode } from '../../src/core/types.js';
import { pushIndexSeed, updateObjectIndex, readObjectTree } from '../../src/spaces/object-index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeClient(data: unknown, hash: string | null = 'h1'): StarfishClient {
  return {
    pull: vi.fn().mockResolvedValue(data != null ? { data, hash } : null),
    push: vi.fn().mockResolvedValue(undefined),
  } as unknown as StarfishClient;
}

const spaceId = 'sp-test';

const spaceNodes: ObjectNode[] = [
  { id: 'n1', type: 'page', parentId: null, order: 1, title: 'Intro', updatedAt: 1 },
  { id: 'n2', type: 'page', parentId: null, order: 2, title: 'About', updatedAt: 2, access: 'space' },
];

const mixedNodes: ObjectNode[] = [
  { id: 'n1', type: 'page', parentId: null, order: 1, title: 'Public Page', updatedAt: 1, access: 'public' },
  { id: 'n2', type: 'page', parentId: null, order: 2, title: 'Secret', emoji: '🔒', updatedAt: 2, access: 'invite' },
  { id: 'n3', type: 'page', parentId: null, order: 3, title: 'Members Only', updatedAt: 3 },
];

// ── pushIndexSeed ──────────────────────────────────────────────────────────────

describe('pushIndexSeed', () => {
  it('pushes an empty objects array when no seed nodes provided', async () => {
    const client = makeClient(null, null);
    await pushIndexSeed(client, spaceId);
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(Array.isArray(payload.objects)).toBe(true);
    expect((payload.objects as unknown[]).length).toBe(0);
  });

  it('pushes provided nodes plaintext (no encryption)', async () => {
    const client = makeClient(null, null);
    await pushIndexSeed(client, spaceId, spaceNodes);
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(Array.isArray(payload.objects)).toBe(true);
    expect((payload as { _encrypted?: boolean })._encrypted).toBeUndefined();
  });

  it('writes v:2 format', async () => {
    const client = makeClient(null, null);
    await pushIndexSeed(client, spaceId, spaceNodes);
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.v).toBe(2);
  });

  it('is idempotent when an objects array already exists', async () => {
    const client = makeClient({ v: 2, objects: spaceNodes });
    await pushIndexSeed(client, spaceId, spaceNodes);
    expect(client.push).not.toHaveBeenCalled();
  });

  it('strips title and emoji from invite nodes before storage', async () => {
    const client = makeClient(null, null);
    await pushIndexSeed(client, spaceId, mixedNodes);
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    const stored = payload.objects as ObjectNode[];

    // public node: title preserved
    expect(stored.find((n) => n.id === 'n1')?.title).toBe('Public Page');

    // invite node: title stripped to '', emoji omitted
    const inviteStored = stored.find((n) => n.id === 'n2');
    expect(inviteStored?.title).toBe('');
    expect(inviteStored).not.toHaveProperty('emoji');

    // space node (default): title preserved
    expect(stored.find((n) => n.id === 'n3')?.title).toBe('Members Only');
  });
});

// ── updateObjectIndex ─────────────────────────────────────────────────────────

describe('updateObjectIndex', () => {
  const fakeSession = {
    userId: 'alice',
    keys: { edPriv: 'priv', edPub: 'pub', kemPriv: 'kempriv', kemPub: 'kempub' },
    chatClient: makeClient({ v: 2, objects: spaceNodes }),
    accountClient: makeClient(null),
  } as unknown as import('../../src/sync/identity.js').Session;

  it('calls the mutator with current nodes and writes the result', async () => {
    const mutator = vi.fn().mockImplementation((nodes: ObjectNode[]) => [
      ...nodes,
      { id: 'n-new', type: 'page', parentId: null, order: 99, title: 'New', updatedAt: 100 },
    ]);

    await updateObjectIndex(fakeSession, spaceId, mutator);

    expect(mutator).toHaveBeenCalled();
    const [nodes] = mutator.mock.calls[0] as [ObjectNode[]];
    expect(nodes).toHaveLength(spaceNodes.length);
  });

  it('is a no-op when the mutator returns null', async () => {
    const client = makeClient({ v: 2, objects: spaceNodes });
    const session = { ...fakeSession, chatClient: client } as unknown as import('../../src/sync/identity.js').Session;
    await updateObjectIndex(session, spaceId, () => null);
    expect(client.push).not.toHaveBeenCalled();
  });

  it('strips invite titles before pushing', async () => {
    const client = makeClient({ v: 2, objects: [] });
    const session = { ...fakeSession, chatClient: client } as unknown as import('../../src/sync/identity.js').Session;

    await updateObjectIndex(session, spaceId, (nodes, now) => [
      ...nodes,
      { id: 'inv-1', type: 'page', parentId: null, order: 1, title: 'Hidden', emoji: '🔒', updatedAt: now, access: 'invite' as const },
    ]);

    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    const stored = payload.objects as ObjectNode[];
    const inv = stored.find((n) => n.id === 'inv-1');
    expect(inv?.title).toBe('');
    expect(inv).not.toHaveProperty('emoji');
  });
});

// ── readObjectTree ─────────────────────────────────────────────────────────────

describe('readObjectTree', () => {
  it('returns the objects array from the index', async () => {
    const client = makeClient({ v: 2, objects: spaceNodes });
    const session = {
      userId: 'alice',
      keys: { edPriv: 'priv', edPub: 'pub', kemPriv: 'kempriv', kemPub: 'kempub' },
      chatClient: client,
      accountClient: makeClient(null),
    } as unknown as import('../../src/sync/identity.js').Session;

    const result = await readObjectTree(session, spaceId);
    expect(result).toHaveLength(spaceNodes.length);
    expect(result[0]?.id).toBe('n1');
  });

  it('returns empty array when index is missing', async () => {
    const client = {
      pull: vi.fn().mockRejectedValue(new Error('not found')),
      push: vi.fn(),
    } as unknown as StarfishClient;
    const session = {
      userId: 'alice',
      keys: { edPriv: 'priv', edPub: 'pub', kemPriv: 'kempriv', kemPub: 'kempub' },
      chatClient: client,
      accountClient: makeClient(null),
    } as unknown as import('../../src/sync/identity.js').Session;

    const result = await readObjectTree(session, spaceId);
    expect(result).toEqual([]);
  });
});
