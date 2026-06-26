import { describe, expect, it, vi } from 'vitest';
import {
  FileTooLargeError,
  MAX_OBJECT_PARQUET_ENC_BYTES,
  uploadObjectParquetEnc,
  loadObjectParquetEnc,
} from '../../src/sync/object-parquet.js';
import type { ByteSealer } from '../../src/sync/object-blobs.js';
import { objectParquetEncName } from '../../src/sync/paths.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

function normPath(p: string) {
  if (p.startsWith('/push/')) return p.slice('/push/'.length);
  if (p.startsWith('/pull/')) return p.slice('/pull/'.length);
  return p;
}

function makeFakeClient() {
  const blobs = new Map<string, Uint8Array>();
  return {
    pushBlob: vi.fn(async (path: string, data: Uint8Array) => {
      blobs.set(normPath(path), data);
      return { hash: 'fakehash' };
    }),
    pullBlob: vi.fn(async (path: string) => {
      const d = blobs.get(normPath(path));
      if (!d) throw new Error(`blob not found: ${path}`);
      return { data: d.buffer };
    }),
    blobs,
    pushPath: (path: string) => path, // raw path for assertions
  };
}

function makeXorSealer(): ByteSealer & { lastSealAad: string | undefined; lastOpenAad: string | undefined } {
  const sealer = {
    lastSealAad: undefined as string | undefined,
    lastOpenAad: undefined as string | undefined,
    sealBytes: vi.fn(async function (bytes: Uint8Array, aad?: string) {
      sealer.lastSealAad = aad;
      return bytes.map((b) => b ^ 0xaa);
    }),
    openBytes: vi.fn(async function (blob: Uint8Array, aad?: string) {
      sealer.lastOpenAad = aad;
      return blob.map((b) => b ^ 0xaa);
    }),
  };
  return sealer;
}

const BYTES = new Uint8Array([0x50, 0x41, 0x52, 0x31]); // "PAR1" parquet magic
const SPACE_ID = 'space-test-abc';

// ── uploadObjectParquetEnc ────────────────────────────────────────────────────

describe('uploadObjectParquetEnc', () => {
  it('seals bytes and pushes ciphertext under the parquet-enc path', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const objectId = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES);

    expect(enc.sealBytes).toHaveBeenCalledOnce();
    const storedKey = [...client.blobs.keys()][0]!;
    expect(storedKey).toContain('parquet-enc');
    expect(storedKey).toContain(objectId);
    // stored bytes must be ciphertext, not plaintext
    expect([...client.blobs.get(storedKey)!]).not.toEqual([...BYTES]);
  });

  it('AAD is objectParquetEncName(spaceId, objectId)', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const objectId = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES);

    expect(enc.lastSealAad).toBe(objectParquetEncName(SPACE_ID, objectId));
    expect(enc.lastSealAad).toContain('objects/parquet-enc/');
    expect(enc.lastSealAad).toContain(objectId);
  });

  it('returns a stable objectId that can be passed explicitly', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const returned = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES, 'obj-fixed-id');

    expect(returned).toBe('obj-fixed-id');
    const storedKey = [...client.blobs.keys()][0]!;
    expect(storedKey).toContain('obj-fixed-id');
  });

  it('generates a random objectId when none is supplied', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const id1 = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES);
    const id2 = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES);

    expect(id1).not.toBe(id2);
  });

  it('throws FileTooLargeError when bytes exceed MAX_OBJECT_PARQUET_ENC_BYTES', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const tooLarge = new Uint8Array(MAX_OBJECT_PARQUET_ENC_BYTES + 1);

    await expect(
      uploadObjectParquetEnc(client as never, enc, SPACE_ID, tooLarge),
    ).rejects.toThrow(FileTooLargeError);

    // No push should have occurred
    expect(client.pushBlob).not.toHaveBeenCalled();
  });

  it('does not throw when bytes equal MAX_OBJECT_PARQUET_ENC_BYTES', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const atLimit = new Uint8Array(MAX_OBJECT_PARQUET_ENC_BYTES);

    await expect(
      uploadObjectParquetEnc(client as never, enc, SPACE_ID, atLimit),
    ).resolves.not.toThrow();
  });
});

// ── loadObjectParquetEnc ──────────────────────────────────────────────────────

describe('loadObjectParquetEnc', () => {
  it('pulls ciphertext and returns the unsealed plaintext', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const objectId = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES);
    const result = await loadObjectParquetEnc(client as never, enc, SPACE_ID, objectId);

    expect(result).toEqual(BYTES);
  });

  it('AAD for open matches AAD used during seal (objectParquetEncName)', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    const objectId = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES, 'obj-aad-check');
    await loadObjectParquetEnc(client as never, enc, SPACE_ID, 'obj-aad-check');

    expect(enc.lastOpenAad).toBe(enc.lastSealAad);
    expect(enc.lastOpenAad).toBe(objectParquetEncName(SPACE_ID, 'obj-aad-check'));
  });

  it('fetches from the parquet-enc pull path', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();

    await uploadObjectParquetEnc(client as never, enc, SPACE_ID, BYTES, 'obj-pull-check');
    await loadObjectParquetEnc(client as never, enc, SPACE_ID, 'obj-pull-check');

    const [[pullPath]] = vi.mocked(client.pullBlob).mock.calls;
    expect(pullPath).toContain('/pull/');
    expect(pullPath).toContain('parquet-enc');
    expect(pullPath).toContain('obj-pull-check');
  });

  it('full round-trip: sealed bytes differ from plaintext; unseal returns original', async () => {
    const client = makeFakeClient();
    const enc = makeXorSealer();
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);

    const objectId = await uploadObjectParquetEnc(client as never, enc, SPACE_ID, payload);

    // Stored bytes must be ciphertext
    const storedKey = [...client.blobs.keys()][0]!;
    expect([...client.blobs.get(storedKey)!]).not.toEqual([...payload]);

    const recovered = await loadObjectParquetEnc(client as never, enc, SPACE_ID, objectId);
    expect(recovered).toEqual(payload);
  });
});
