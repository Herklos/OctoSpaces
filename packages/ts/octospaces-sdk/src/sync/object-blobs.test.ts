import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileTooLargeError,
  MAX_OBJECT_BLOB_BYTES,
  uploadObjectBlob,
  loadObjectBlob,
  createObjectBlobStore,
  type ObjectBlobRef,
} from './object-blobs.js';
import type { ByteSealer } from './object-blobs.js';
import { configureKv } from '../core/adapters.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

function makeKvStore() {
  const store = new Map<string, string>();
  configureKv({
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v) => { store.set(k, v); return Promise.resolve(); },
    remove: (k) => { store.delete(k); return Promise.resolve(); },
  });
  return store;
}

function makeFakeClient() {
  const blobs = new Map<string, Uint8Array>();
  return {
    pushBlob: vi.fn(async (path: string, data: Uint8Array) => void blobs.set(path, data)),
    pullBlob: vi.fn(async (path: string) => {
      const d = blobs.get(path);
      if (!d) throw new Error(`blob not found: ${path}`);
      return { data: d } as unknown as { data: Uint8Array };
    }),
    blobs,
  };
}

// XOR cipher — reversible, makes sealBytes/openBytes distinguishable from plaintext
const fakeSealer: ByteSealer = {
  sealBytes: vi.fn(async (bytes: Uint8Array, _aad?: string) => {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ 0xff;
    return out;
  }),
  openBytes: vi.fn(async (bytes: Uint8Array, _aad?: string) => {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ 0xff;
    return out;
  }),
};

const BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const SEALED = new Uint8Array([1 ^ 0xff, 2 ^ 0xff, 3 ^ 0xff, 4 ^ 0xff, 5 ^ 0xff]);

// Push path → pull path helper
function toPullPath(pushPath: string) {
  return pushPath.replace('/push/', '/pull/');
}

beforeEach(() => {
  vi.clearAllMocks();
  makeKvStore();
});

// ── Standalone helpers ────────────────────────────────────────────────────────

describe('uploadObjectBlob (standalone)', () => {
  it('seals bytes with AAD = objectBlobName(spaceId, blobId) and pushes ciphertext', async () => {
    const client = makeFakeClient();
    const ref: ObjectBlobRef = await uploadObjectBlob(client as never, fakeSealer, 'sp-abc', BYTES, 'file.pdf', 'application/pdf');

    expect(fakeSealer.sealBytes).toHaveBeenCalledOnce();
    const [[, aad]] = vi.mocked(fakeSealer.sealBytes).mock.calls;
    expect(aad).toContain('sp-abc');
    expect(aad).toContain(ref.blobId);
    expect(client.blobs.get([...client.blobs.keys()][0]!)).toEqual(SEALED);
  });

  it('plaintext path (enc: null) pushes raw bytes', async () => {
    const client = makeFakeClient();
    await uploadObjectBlob(client as never, null, 'sp-abc', BYTES, 'f.txt', 'text/plain');
    expect(fakeSealer.sealBytes).not.toHaveBeenCalled();
    expect(client.blobs.get([...client.blobs.keys()][0]!)).toEqual(BYTES);
  });

  it('returns correct ObjectBlobRef fields', async () => {
    const client = makeFakeClient();
    const ref = await uploadObjectBlob(client as never, fakeSealer, 'sp-abc', BYTES, 'img.png', 'image/png');
    expect(ref.name).toBe('img.png');
    expect(ref.mime).toBe('image/png');
    expect(ref.size).toBe(5);
    expect(ref.blobId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('throws FileTooLargeError before sealing when bytes exceed MAX_OBJECT_BLOB_BYTES', async () => {
    const client = makeFakeClient();
    const huge = new Uint8Array(MAX_OBJECT_BLOB_BYTES + 1);
    await expect(uploadObjectBlob(client as never, fakeSealer, 'sp-abc', huge, 'big.bin', 'application/octet-stream'))
      .rejects.toBeInstanceOf(FileTooLargeError);
    expect(fakeSealer.sealBytes).not.toHaveBeenCalled();
    expect(client.pushBlob).not.toHaveBeenCalled();
  });

  it('FileTooLargeError carries size and max', () => {
    const size = MAX_OBJECT_BLOB_BYTES + 42;
    const err = new FileTooLargeError(size, MAX_OBJECT_BLOB_BYTES);
    expect(err.size).toBe(size);
    expect(err.max).toBe(MAX_OBJECT_BLOB_BYTES);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('loadObjectBlob (standalone)', () => {
  it('pulls, opens with AAD = objectBlobName(spaceId, blobId), returns plaintext', async () => {
    const client = makeFakeClient();
    const blobId = 'deadbeefcafebabe0123456789abcdef';
    client.blobs.set(`/pull/spaces/sp-abc/objects/blobs/${blobId}`, SEALED);

    const loaded = await loadObjectBlob(client as never, fakeSealer, 'sp-abc', blobId);
    expect(loaded).toEqual(BYTES);
    const [[, aad]] = vi.mocked(fakeSealer.openBytes).mock.calls;
    expect(aad).toContain('sp-abc');
    expect(aad).toContain(blobId);
  });

  it('plaintext path (enc: null) returns raw bytes without calling openBytes', async () => {
    const client = makeFakeClient();
    const blobId = 'abcd1234abcd1234abcd1234abcd1234';
    client.blobs.set(`/pull/spaces/sp-abc/objects/blobs/${blobId}`, BYTES);
    const loaded = await loadObjectBlob(client as never, null, 'sp-abc', blobId);
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).not.toHaveBeenCalled();
  });

  it('round-trip: upload then load returns original plaintext', async () => {
    const client = makeFakeClient();
    const ref = await uploadObjectBlob(client as never, fakeSealer, 'sp-xyz', BYTES, 'f.bin', 'application/octet-stream');
    vi.clearAllMocks();

    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(toPullPath(pushPath), client.blobs.get(pushPath)!);

    const loaded = await loadObjectBlob(client as never, fakeSealer, 'sp-xyz', ref.blobId);
    expect(loaded).toEqual(BYTES);
  });
});

// ── createObjectBlobStore — cache + persist ───────────────────────────────────

describe('createObjectBlobStore', () => {
  it('upload + load round-trip (encrypted)', async () => {
    const client = makeFakeClient();
    const store = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const ref = await store.uploadObjectBlob(client as never, fakeSealer, 'sp-1', BYTES, 'f.pdf', 'application/pdf');

    // Make the pull path available
    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(toPullPath(pushPath), client.blobs.get(pushPath)!);
    vi.clearAllMocks();

    const loaded = await store.loadObjectBlob(client as never, fakeSealer, 'sp-1', ref);
    // In-memory cache — no network pull on the second call
    expect(loaded).toEqual(BYTES);
    expect(client.pullBlob).not.toHaveBeenCalled();
    expect(fakeSealer.openBytes).not.toHaveBeenCalled();
  });

  it('upload + load round-trip (plaintext enc: null)', async () => {
    const client = makeFakeClient();
    const store = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const ref = await store.uploadObjectBlob(client as never, null, 'sp-2', BYTES, 'f.txt', 'text/plain');
    expect(fakeSealer.sealBytes).not.toHaveBeenCalled();

    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(toPullPath(pushPath), client.blobs.get(pushPath)!);
    vi.clearAllMocks();

    const loaded = await store.loadObjectBlob(client as never, null, 'sp-2', ref);
    expect(loaded).toEqual(BYTES);
  });

  it('in-memory cache: second load skips network pull', async () => {
    const client = makeFakeClient();
    const store = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const ref = await store.uploadObjectBlob(client as never, fakeSealer, 'sp-3', BYTES, 'a.png', 'image/png');

    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(toPullPath(pushPath), client.blobs.get(pushPath)!);
    vi.clearAllMocks();

    const first = await store.loadObjectBlob(client as never, fakeSealer, 'sp-3', ref);
    const second = await store.loadObjectBlob(client as never, fakeSealer, 'sp-3', ref);
    expect(first).toEqual(BYTES);
    expect(second).toEqual(BYTES);
    // Network pulled at most once (first load hits KV persist or cache; second always cache)
    expect(client.pullBlob).not.toHaveBeenCalled(); // warm from upload's cachePut
  });

  it('KV-persist fallback: loads from KV without a network pull on cold in-memory cache', async () => {
    const client = makeFakeClient();
    const store = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const ref = await store.uploadObjectBlob(client as never, fakeSealer, 'sp-4', BYTES, 'b.txt', 'text/plain');
    vi.clearAllMocks();

    // Clear in-memory cache by creating a fresh store over the SAME KV
    const store2 = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const loaded = await store2.loadObjectBlob(client as never, fakeSealer, 'sp-4', ref);
    expect(loaded).toEqual(BYTES);
    expect(client.pullBlob).not.toHaveBeenCalled(); // served from KV, not network
  });

  it('clearObjectBlobCache forces a fresh load on next call', async () => {
    const client = makeFakeClient();
    const store = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const ref = await store.uploadObjectBlob(client as never, fakeSealer, 'sp-5', BYTES, 'c.bin', 'application/octet-stream');

    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(toPullPath(pushPath), client.blobs.get(pushPath)!);
    vi.clearAllMocks();

    // Warm the in-memory cache
    await store.loadObjectBlob(client as never, fakeSealer, 'sp-5', ref);
    store.clearObjectBlobCache();
    vi.clearAllMocks();

    // Now the in-memory cache is empty; KV persist still has it, so no network pull
    const loaded = await store.loadObjectBlob(client as never, fakeSealer, 'sp-5', ref);
    expect(loaded).toEqual(BYTES);
  });

  it('throws FileTooLargeError in store context', async () => {
    const client = makeFakeClient();
    const store = createObjectBlobStore({ persistPrefix: 'test.blob.', persistIndex: 'test.idx' });
    const huge = new Uint8Array(MAX_OBJECT_BLOB_BYTES + 1);
    await expect(store.uploadObjectBlob(client as never, fakeSealer, 'sp-6', huge, 'huge.bin', 'application/octet-stream'))
      .rejects.toBeInstanceOf(FileTooLargeError);
    expect(client.pushBlob).not.toHaveBeenCalled();
  });
});
