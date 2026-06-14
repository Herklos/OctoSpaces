import { describe, it, expect, vi } from 'vitest';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { readSpaceAccess, writeSpaceAccess, addSpaceMember, removeSpaceMember, removeJoinedSpace, moveSpace } from './registry.js';

// ── Fake client ────────────────────────────────────────────────────────────────

function makeAccessClient(data: unknown, hash = 'h1'): StarfishClient {
  return {
    pull: vi.fn().mockResolvedValue({ data, hash }),
    push: vi.fn().mockResolvedValue(undefined),
  } as unknown as StarfishClient;
}

// ── readSpaceAccess ────────────────────────────────────────────────────────────

describe('readSpaceAccess', () => {
  it('returns owner, members, name, image', async () => {
    const client = makeAccessClient({
      v: 1, owner: 'alice', members: ['bob'], name: 'My Space', image: 'data:image/png;base64,abc',
    });
    const result = await readSpaceAccess(client, 'sp-x');
    expect(result.owner).toBe('alice');
    expect(result.members).toEqual(['bob']);
    expect(result.name).toBe('My Space');
    expect(result.image).toBe('data:image/png;base64,abc');
  });

  it('returns null owner/name/image for missing fields', async () => {
    const client = makeAccessClient({});
    const result = await readSpaceAccess(client, 'sp-empty');
    expect(result.owner).toBeNull();
    expect(result.name).toBeNull();
    expect(result.image).toBeNull();
    expect(result.members).toEqual([]);
  });

  it('returns the hash from the pull response', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [] }, 'hash-abc');
    const result = await readSpaceAccess(client, 'sp-1');
    expect(result.hash).toBe('hash-abc');
  });

  it('does NOT return a visibility field', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [] });
    const result = await readSpaceAccess(client, 'sp-x');
    expect(result).not.toHaveProperty('visibility');
  });
});

// ── writeSpaceAccess ───────────────────────────────────────────────────────────

describe('writeSpaceAccess', () => {
  it('writes owner and members', async () => {
    const client = makeAccessClient(null);
    await writeSpaceAccess(client, 'sp-x', 'alice', ['bob'], null);
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toHaveProperty('owner', 'alice');
    expect((doc as { members: string[] }).members).toContain('bob');
  });

  it('preserves name and image', async () => {
    const client = makeAccessClient(null);
    await writeSpaceAccess(client, 'sp-x', 'alice', ['bob'], null, { name: 'Test', image: 'data:x' });
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toHaveProperty('name', 'Test');
    expect(doc).toHaveProperty('image', 'data:x');
  });

  it('does NOT write a visibility field', async () => {
    const client = makeAccessClient(null);
    await writeSpaceAccess(client, 'sp-x', 'alice', [], null);
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).not.toHaveProperty('visibility');
  });
});

// ── addSpaceMember / removeSpaceMember ────────────────────────────────────────

describe('addSpaceMember', () => {
  it('adds a member to the roster', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [] });
    await addSpaceMember(client, 'sp-x', 'alice', 'bob');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { members: string[] }).members).toContain('bob');
  });

  it('is a no-op when member already present', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: ['bob'] });
    await addSpaceMember(client, 'sp-x', 'alice', 'bob');
    expect(client.push).not.toHaveBeenCalled();
  });

  it('preserves name and image when adding a member', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [], name: 'S', image: 'data:i' });
    await addSpaceMember(client, 'sp-x', 'alice', 'bob');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toHaveProperty('name', 'S');
    expect(doc).toHaveProperty('image', 'data:i');
  });
});

describe('removeSpaceMember', () => {
  it('removes a member from the roster', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: ['bob', 'carol'], name: 'S' });
    await removeSpaceMember(client, 'sp-x', 'bob');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { members: string[] }).members).not.toContain('bob');
    expect((doc as { members: string[] }).members).toContain('carol');
  });

  it('is a no-op when member is not in the roster', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: ['carol'] });
    await removeSpaceMember(client, 'sp-x', 'unknown');
    expect(client.push).not.toHaveBeenCalled();
  });

  it('preserves name and image when removing a member', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: ['bob'], name: 'S', image: 'data:i' });
    await removeSpaceMember(client, 'sp-x', 'bob');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toHaveProperty('name', 'S');
    expect(doc).toHaveProperty('image', 'data:i');
  });
});

// ── Helpers for _spaces doc tests ─────────────────────────────────────────────

type SpaceShape = { id: string; name: string; short: string; members: number };

function makeSpacesClient(spaces: SpaceShape[], caps: Record<string, string> = {}, pubAccess: Record<string, unknown> = {}): StarfishClient {
  return {
    pull: vi.fn().mockResolvedValue({
      data: { v: 1, spaces, caps, pubAccess, mutes: { rooms: {}, spaces: {} }, reads: { rooms: {} }, dms: {}, quickReactions: [], archivedDms: {} },
      hash: 'h1',
    }),
    push: vi.fn().mockResolvedValue(undefined),
  } as unknown as StarfishClient;
}

// ── removeJoinedSpace ─────────────────────────────────────────────────────────

describe('removeJoinedSpace', () => {
  it('removes the space entry, its cap, and its pubAccess credential', async () => {
    const spaces = [{ id: 'sp-1', name: 'One', short: 'ON', members: 1 }];
    const client = makeSpacesClient(spaces, { 'sp-1': 'cap-json' }, { 'sp-1': { sealed: 'x' } });
    await removeJoinedSpace(client, 'alice', 'sp-1');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { spaces: unknown[] }).spaces).toHaveLength(0);
    expect(doc.caps).not.toHaveProperty('sp-1');
    expect(doc.pubAccess).not.toHaveProperty('sp-1');
  });

  it('preserves sibling spaces when removing one', async () => {
    const spaces = [
      { id: 'sp-1', name: 'One', short: 'ON', members: 1 },
      { id: 'sp-2', name: 'Two', short: 'TW', members: 1 },
    ];
    const client = makeSpacesClient(spaces);
    await removeJoinedSpace(client, 'alice', 'sp-1');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { spaces: SpaceShape[] }).spaces.map((s) => s.id)).toEqual(['sp-2']);
  });

  it('is a no-op when the space is not in the list', async () => {
    const client = makeSpacesClient([{ id: 'sp-1', name: 'One', short: 'ON', members: 1 }]);
    await removeJoinedSpace(client, 'alice', 'sp-unknown');
    expect(client.push).not.toHaveBeenCalled();
  });
});

// ── moveSpace ─────────────────────────────────────────────────────────────────

describe('moveSpace', () => {
  it('moves a space to an absolute index', async () => {
    const spaces = [
      { id: 'sp-1', name: 'One', short: 'ON', members: 1 },
      { id: 'sp-2', name: 'Two', short: 'TW', members: 1 },
      { id: 'sp-3', name: 'Three', short: 'TH', members: 1 },
    ];
    const client = makeSpacesClient(spaces);
    await moveSpace(client, 'alice', 'sp-3', 0);
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { spaces: SpaceShape[] }).spaces.map((s) => s.id)).toEqual(['sp-3', 'sp-1', 'sp-2']);
  });

  it('clamps an out-of-range index to the end of the list', async () => {
    const spaces = [
      { id: 'sp-1', name: 'One', short: 'ON', members: 1 },
      { id: 'sp-2', name: 'Two', short: 'TW', members: 1 },
    ];
    const client = makeSpacesClient(spaces);
    await moveSpace(client, 'alice', 'sp-1', 99);
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { spaces: SpaceShape[] }).spaces.map((s) => s.id)).toEqual(['sp-2', 'sp-1']);
  });

  it('is a no-op when the space is absent', async () => {
    const client = makeSpacesClient([{ id: 'sp-1', name: 'One', short: 'ON', members: 1 }]);
    await moveSpace(client, 'alice', 'sp-unknown', 0);
    expect(client.push).not.toHaveBeenCalled();
  });

  it('is a no-op when the space is already at the target index', async () => {
    const spaces = [
      { id: 'sp-1', name: 'One', short: 'ON', members: 1 },
      { id: 'sp-2', name: 'Two', short: 'TW', members: 1 },
    ];
    const client = makeSpacesClient(spaces);
    await moveSpace(client, 'alice', 'sp-1', 0);
    expect(client.push).not.toHaveBeenCalled();
  });
});
