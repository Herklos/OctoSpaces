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
  it('returns visibility null for a private space doc', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [] });
    const result = await readSpaceAccess(client, 'sp-private');
    expect(result.visibility).toBeNull();
  });

  it('returns visibility "public" when doc has visibility:"public"', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [], visibility: 'public' });
    const result = await readSpaceAccess(client, 'sp-pub');
    expect(result.visibility).toBe('public');
  });

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
});

// ── writeSpaceAccess ───────────────────────────────────────────────────────────

describe('writeSpaceAccess', () => {
  it('omits visibility field for a private space', async () => {
    const client = makeAccessClient(null);
    await writeSpaceAccess(client, 'sp-priv', 'alice', [], null);
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).not.toHaveProperty('visibility');
  });

  it('emits visibility:"public" for a public space', async () => {
    const client = makeAccessClient(null);
    await writeSpaceAccess(client, 'sp-pub', 'alice', [], null, { visibility: 'public' });
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toHaveProperty('visibility', 'public');
  });

  it('preserves name and image', async () => {
    const client = makeAccessClient(null);
    await writeSpaceAccess(client, 'sp-x', 'alice', ['bob'], null, { name: 'Test', image: 'data:x' });
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(doc).toHaveProperty('name', 'Test');
    expect(doc).toHaveProperty('image', 'data:x');
  });
});

// ── addSpaceMember / removeSpaceMember ────────────────────────────────────────

describe('addSpaceMember', () => {
  it('adds a member and preserves visibility', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: [], visibility: 'public' });
    await addSpaceMember(client, 'sp-pub', 'alice', 'bob');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { members: string[] }).members).toContain('bob');
    expect(doc).toHaveProperty('visibility', 'public');
  });

  it('is a no-op when member already present', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: ['bob'] });
    await addSpaceMember(client, 'sp-x', 'alice', 'bob');
    expect(client.push).not.toHaveBeenCalled();
  });
});

describe('removeSpaceMember', () => {
  it('removes a member and preserves name/image/visibility', async () => {
    const client = makeAccessClient({
      v: 1, owner: 'alice', members: ['bob', 'carol'], name: 'S', visibility: 'public',
    });
    await removeSpaceMember(client, 'sp-pub', 'bob');
    const [, doc] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((doc as { members: string[] }).members).not.toContain('bob');
    expect((doc as { members: string[] }).members).toContain('carol');
    expect(doc).toHaveProperty('visibility', 'public');
  });

  it('is a no-op when member is not in the roster', async () => {
    const client = makeAccessClient({ v: 1, owner: 'alice', members: ['carol'] });
    await removeSpaceMember(client, 'sp-x', 'unknown');
    expect(client.push).not.toHaveBeenCalled();
  });
});
