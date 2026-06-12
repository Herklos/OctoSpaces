import { describe, it, expect, vi } from 'vitest';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { readIndexRooms, pushIndexSeed } from './object-index.js';
import type { SeedRoom } from './object-index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeClient(data: unknown, hash = 'h1'): StarfishClient {
  return {
    pull: vi.fn().mockResolvedValue({ data, hash }),
    push: vi.fn().mockResolvedValue(undefined),
  } as unknown as StarfishClient;
}

function makeEncryptor(decryptOutput: Record<string, unknown>): Encryptor {
  return {
    decrypt: vi.fn().mockResolvedValue(decryptOutput),
    encrypt: vi.fn().mockImplementation(async (v: Record<string, unknown>) => ({ _encrypted: true, ...v })),
  } as unknown as Encryptor;
}

const spaceId = 'sp-test';
const plainNodes = [{ id: 'r1', type: 'room', subtype: 'channel', parentId: null, order: 0, title: 'general', updatedAt: 1 }];
const plainIndexDoc = { objects: plainNodes };

// ── readIndexRooms ─────────────────────────────────────────────────────────────

describe('readIndexRooms — plaintext (null encryptor)', () => {
  it('returns rooms from a plaintext objects doc', async () => {
    const client = makeClient(plainIndexDoc);
    const result = await readIndexRooms(client, null, '/pull/spaces/sp-test/objects/_index', spaceId);
    expect(result).not.toBeNull();
    expect(result!.rooms.length).toBeGreaterThan(0);
  });

  it('returns null when pull returns no data', async () => {
    const client = makeClient(null);
    const result = await readIndexRooms(client, null, '/pull/x', spaceId);
    expect(result).toBeNull();
  });
});

describe('readIndexRooms — encrypted (with encryptor)', () => {
  it('calls encryptor.decrypt and projects rooms', async () => {
    const enc = makeEncryptor(plainIndexDoc);
    const client = makeClient({ _encrypted: true, ct: 'abc' });
    const result = await readIndexRooms(client, enc, '/pull/x', spaceId);
    expect(enc.decrypt).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.rooms.length).toBeGreaterThan(0);
  });

  it('returns null on decrypt error', async () => {
    const enc = {
      decrypt: vi.fn().mockRejectedValue(new Error('bad key')),
      encrypt: vi.fn(),
    } as unknown as Encryptor;
    const client = makeClient({ _encrypted: true });
    const result = await readIndexRooms(client, enc, '/pull/x', spaceId);
    expect(result).toBeNull();
  });
});

// ── pushIndexSeed ──────────────────────────────────────────────────────────────

const seedRooms: SeedRoom[] = [{ id: 'sp-test-general', name: 'general', kind: 'channel', category: 'CHANNELS' }];

describe('pushIndexSeed — plaintext', () => {
  it('pushes plaintext objects when encryptor is null', async () => {
    const client = makeClient(null, null as unknown as string);
    (client.pull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pushIndexSeed(client, null, spaceId, seedRooms);
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(Array.isArray(payload.objects)).toBe(true);
    expect((payload as { _encrypted?: boolean })._encrypted).toBeUndefined();
  });

  it('is idempotent when plaintext {objects} already exists', async () => {
    const client = makeClient(plainIndexDoc);
    await pushIndexSeed(client, null, spaceId, seedRooms);
    expect(client.push).not.toHaveBeenCalled();
  });
});

describe('pushIndexSeed — encrypted', () => {
  it('pushes encrypted payload when encryptor provided', async () => {
    const enc = makeEncryptor({});
    (enc.encrypt as ReturnType<typeof vi.fn>).mockResolvedValue({ _encrypted: true, ct: 'x' });
    const client = makeClient(null, null as unknown as string);
    (client.pull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pushIndexSeed(client, enc, spaceId, seedRooms);
    expect(enc.encrypt).toHaveBeenCalled();
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((payload as { _encrypted?: boolean })._encrypted).toBe(true);
  });

  it('is idempotent when encrypted doc already exists', async () => {
    const enc = makeEncryptor({});
    const client = makeClient({ _encrypted: true, ct: 'existing' });
    await pushIndexSeed(client, enc, spaceId, seedRooms);
    expect(client.push).not.toHaveBeenCalled();
  });
});
