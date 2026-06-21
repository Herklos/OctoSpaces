/**
 * Encrypted blob upload/download for object files and images.
 *
 * Blobs live at `spaces/{spaceId}/objects/blobs/{blobId}` (the `objblob` collection)
 * and are sealed client-side with the space keyring CEK. The `objectBlobName` is bound
 * into the seal's AAD, preventing hostile relocation.
 *
 * For unencrypted (public/plaintext) nodes, pass `enc: null` — bytes are stored raw.
 *
 * This module supersedes the legacy `attachments.ts` pipeline (which targeted the
 * now-removed `attachments` collection keyed by node). Use {@link createObjectBlobStore}
 * to get a scoped instance with your app's KV prefixes and an in-memory + persisted
 * decrypted-blob cache; use the standalone {@link uploadObjectBlob} / {@link loadObjectBlob}
 * for one-off calls without caching.
 */
import { getBase64 } from '@drakkar.software/starfish-protocol';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import { kvGet, kvRemove, kvSet } from '../core/adapters.js';
import { objectBlobName, objectBlobPull, objectBlobPush } from './paths.js';
import { randomId } from '../core/ids.js';

export interface ByteSealer {
  sealBytes(bytes: Uint8Array, aad?: string): Promise<Uint8Array>;
  openBytes(blob: Uint8Array, aad?: string): Promise<Uint8Array>;
}

export function attachmentKind(mime: string): 'image' | 'file' {
  return mime.startsWith('image/') ? 'image' : 'file';
}

/**
 * Maximum allowed byte size for a single object blob upload.
 * Keep in sync with `maxBodyBytes` for the `objblob` collection in
 * `apps/server/src/config.ts` — both must be the same value.
 */
export const MAX_OBJECT_BLOB_BYTES = 11_534_336; // ~11 MB

/** Thrown when a file exceeds {@link MAX_OBJECT_BLOB_BYTES} before any upload attempt. */
export class FileTooLargeError extends Error {
  readonly size: number;
  readonly max: number;
  constructor(size: number, max: number) {
    super(`File is ${size} bytes — maximum allowed is ${max} bytes`);
    this.name = 'FileTooLargeError';
    this.size = size;
    this.max = max;
  }
}

export interface ObjectBlobRef {
  blobId: string;
  name: string;
  mime: string;
  size: number;
}

export interface ObjectBlobStore {
  uploadObjectBlob(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    bytes: Uint8Array,
    name: string,
    mime: string,
  ): Promise<ObjectBlobRef>;
  loadObjectBlob(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    ref: ObjectBlobRef,
  ): Promise<Uint8Array>;
  clearObjectBlobCache(): void;
}

// ── Shared seal/push/open core (used by both the standalone + cached paths) ────

/** Guard size, mint a blobId, seal (if `enc`) binding the objectBlobName AAD, and
 *  push. Returns the blobId and the stored (sealed) bytes for optional caching. */
async function sealAndPush(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  bytes: Uint8Array,
): Promise<{ blobId: string; stored: Uint8Array }> {
  if (bytes.length > MAX_OBJECT_BLOB_BYTES) {
    throw new FileTooLargeError(bytes.length, MAX_OBJECT_BLOB_BYTES);
  }
  const blobId = randomId();
  const stored = enc ? await enc.sealBytes(bytes, objectBlobName(spaceId, blobId)) : bytes;
  await client.pushBlob(objectBlobPush(spaceId, blobId), stored, 'application/octet-stream');
  return { blobId, stored };
}

/** Fetch the stored (post-seal) bytes of a blob. */
async function pullStored(client: StarfishClient, spaceId: string, blobId: string): Promise<Uint8Array> {
  const res = await client.pullBlob(objectBlobPull(spaceId, blobId));
  return new Uint8Array(res.data);
}

/** Open stored bytes back to plaintext (if `enc`), binding the objectBlobName AAD. */
async function openStored(enc: ByteSealer | null, spaceId: string, blobId: string, stored: Uint8Array): Promise<Uint8Array> {
  return enc ? enc.openBytes(stored, objectBlobName(spaceId, blobId)) : stored;
}

// ── Standalone (uncached) helpers ─────────────────────────────────────────────

/** Seal and upload bytes as an object blob; returns the ref to store in node props.
 *  Pass `enc: null` for plaintext (public) nodes — bytes are stored raw.
 *  Throws {@link FileTooLargeError} if `bytes` exceeds {@link MAX_OBJECT_BLOB_BYTES}. */
export async function uploadObjectBlob(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<ObjectBlobRef> {
  const { blobId } = await sealAndPush(client, enc, spaceId, bytes);
  return { blobId, name, mime, size: bytes.length };
}

/** Fetch + decrypt an object blob back to its original bytes.
 *  Pass `enc: null` for plaintext (public) nodes.
 *  Accepts either a raw `blobId` string or an {@link ObjectBlobRef} object. */
export async function loadObjectBlob(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  blobIdOrRef: string | ObjectBlobRef,
): Promise<Uint8Array> {
  const blobId = typeof blobIdOrRef === 'string' ? blobIdOrRef : blobIdOrRef.blobId;
  const stored = await pullStored(client, spaceId, blobId);
  return openStored(enc, spaceId, blobId, stored);
}

// ── Cached store ──────────────────────────────────────────────────────────────

const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const PERSIST_BUDGET_BYTES = 4 * 1024 * 1024;

type PersistIndex = { k: string; n: number }[];

/**
 * Create a scoped object-blob store. Each app passes its own KV prefixes so
 * cached blobs from different apps don't collide in the shared KV store.
 *
 * The store keeps an in-memory LRU cache (64 MB cap) of decrypted bytes and
 * a KV-persisted cache of the stored (post-seal) ciphertext (4 MB cap) so blobs
 * can be reopened offline or after a hot-reload without a network round-trip.
 */
export function createObjectBlobStore(opts: {
  persistPrefix: string;
  persistIndex: string;
}): ObjectBlobStore {
  const { persistPrefix, persistIndex } = opts;

  const decryptedCache = new Map<string, Uint8Array>();
  let cacheBytes = 0;

  function cacheKey(spaceId: string, blobId: string): string {
    return `${spaceId}/${blobId}`;
  }

  function cachePut(key: string, bytes: Uint8Array): void {
    const existing = decryptedCache.get(key);
    if (existing) cacheBytes -= existing.length;
    decryptedCache.set(key, bytes);
    cacheBytes += bytes.length;
    for (const [k, v] of decryptedCache) {
      if (cacheBytes <= CACHE_BUDGET_BYTES) break;
      if (k === key) continue;
      decryptedCache.delete(k);
      cacheBytes -= v.length;
    }
  }

  function persistStoreKey(spaceId: string, blobId: string): string {
    return `${persistPrefix}${spaceId}/${blobId}`;
  }

  async function readPersistIndex(): Promise<PersistIndex> {
    const raw = await kvGet(persistIndex);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as PersistIndex) : [];
    } catch {
      return [];
    }
  }

  async function persistGet(spaceId: string, blobId: string): Promise<Uint8Array | null> {
    const b64 = await kvGet(persistStoreKey(spaceId, blobId));
    if (!b64) return null;
    try {
      return getBase64().decode(b64);
    } catch {
      return null;
    }
  }

  async function persistPut(spaceId: string, blobId: string, stored: Uint8Array): Promise<void> {
    const storeKey = persistStoreKey(spaceId, blobId);
    const b64 = getBase64().encode(stored);
    const index = (await readPersistIndex()).filter((e) => e.k !== storeKey);
    index.push({ k: storeKey, n: b64.length });
    let total = index.reduce((s, e) => s + e.n, 0);
    while (total > PERSIST_BUDGET_BYTES && index.length > 1) {
      const victim = index.shift()!;
      if (victim.k === storeKey) {
        index.push(victim);
        continue;
      }
      await kvRemove(victim.k);
      total -= victim.n;
    }
    await kvSet(storeKey, b64);
    await kvSet(persistIndex, JSON.stringify(index));
  }

  async function storeUploadObjectBlob(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    bytes: Uint8Array,
    name: string,
    mime: string,
  ): Promise<ObjectBlobRef> {
    const { blobId, stored } = await sealAndPush(client, enc, spaceId, bytes);
    cachePut(cacheKey(spaceId, blobId), bytes);
    await persistPut(spaceId, blobId, stored);
    return { blobId, name, mime, size: bytes.length };
  }

  async function storeLoadObjectBlob(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    ref: ObjectBlobRef,
  ): Promise<Uint8Array> {
    const key = cacheKey(spaceId, ref.blobId);
    const hit = decryptedCache.get(key);
    if (hit) return hit;
    let stored = await persistGet(spaceId, ref.blobId);
    if (!stored) {
      stored = await pullStored(client, spaceId, ref.blobId);
      await persistPut(spaceId, ref.blobId, stored);
    }
    const bytes = await openStored(enc, spaceId, ref.blobId, stored);
    cachePut(key, bytes);
    return bytes;
  }

  function clearObjectBlobCache(): void {
    decryptedCache.clear();
    cacheBytes = 0;
  }

  return {
    uploadObjectBlob: storeUploadObjectBlob,
    loadObjectBlob: storeLoadObjectBlob,
    clearObjectBlobCache,
  };
}
