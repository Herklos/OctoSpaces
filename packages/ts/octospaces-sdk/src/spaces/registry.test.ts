import { describe, it, expect, vi } from 'vitest';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { readSpaceAccess, writeSpaceAccess, addSpaceMember, removeSpaceMember } from './registry.js';

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
