import { describe, it, expect, vi } from 'vitest';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import type { ObjectNode } from '../core/types.js';
import { pushIndexSeed } from './object-index.js';

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
const seedNodes: ObjectNode[] = [{ id: 'n1', type: 'page', parentId: null, order: 1, title: 'Intro', updatedAt: 1 }];
const plainIndexDoc = { objects: seedNodes };

// ── pushIndexSeed ──────────────────────────────────────────────────────────────

describe('pushIndexSeed — plaintext (null encryptor)', () => {
  it('pushes empty objects array when no seed provided', async () => {
    const client = makeClient(null, null as unknown as string);
    (client.pull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pushIndexSeed(client, null, spaceId);
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(Array.isArray(payload.objects)).toBe(true);
    expect((payload.objects as unknown[]).length).toBe(0);
    expect((payload as { _encrypted?: boolean })._encrypted).toBeUndefined();
  });

  it('pushes provided nodes plaintext', async () => {
    const client = makeClient(null, null as unknown as string);
    (client.pull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pushIndexSeed(client, null, spaceId, seedNodes);
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(Array.isArray(payload.objects)).toBe(true);
    expect((payload as { _encrypted?: boolean })._encrypted).toBeUndefined();
  });

  it('is idempotent when plaintext {objects} already exists', async () => {
    const client = makeClient(plainIndexDoc);
    await pushIndexSeed(client, null, spaceId, seedNodes);
    expect(client.push).not.toHaveBeenCalled();
  });
});

describe('pushIndexSeed — encrypted (with encryptor)', () => {
  it('pushes encrypted payload when encryptor provided', async () => {
    const enc = makeEncryptor({});
    (enc.encrypt as ReturnType<typeof vi.fn>).mockResolvedValue({ _encrypted: true, ct: 'x' });
    const client = makeClient(null, null as unknown as string);
    (client.pull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pushIndexSeed(client, enc, spaceId, seedNodes);
    expect(enc.encrypt).toHaveBeenCalled();
    expect(client.push).toHaveBeenCalled();
    const [, payload] = (client.push as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((payload as { _encrypted?: boolean })._encrypted).toBe(true);
  });

  it('is idempotent when encrypted doc already exists', async () => {
    const enc = makeEncryptor({});
    const client = makeClient({ _encrypted: true, ct: 'existing' });
    await pushIndexSeed(client, enc, spaceId, seedNodes);
    expect(client.push).not.toHaveBeenCalled();
  });
});
