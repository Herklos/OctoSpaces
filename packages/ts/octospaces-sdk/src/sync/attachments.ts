/**
 * Generic attachment upload/download over a Starfish raw-blob collection.
 *
 * For encrypted (E2EE) nodes, bytes are sealed client-side with the node's keyring
 * CEK (`sealBytes`), so the server only ever stores opaque ciphertext. The blob's
 * storage path is bound into the seal's AAD, preventing hostile relocation.
 *
 * For unencrypted (public/plaintext) nodes, pass `enc: null` — bytes are stored raw.
 *
 * Use {@link createAttachmentStore} to get a scoped instance with your app's KV prefixes.
 */
import { getBase64 } from '@drakkar.software/starfish-protocol';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import { randomId } from '../core/ids.js';
import { kvGet, kvRemove, kvSet } from '../core/adapters.js';
import { attachmentName, attachmentPull, attachmentPush } from './paths.js';

export interface ByteSealer {
  sealBytes(bytes: Uint8Array, aad?: string): Promise<Uint8Array>;
  openBytes(blob: Uint8Array, aad?: string): Promise<Uint8Array>;
}

export interface AttachmentRef {
  blobId: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'file';
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function attachmentKind(mime: string): 'image' | 'file' {
  return mime.startsWith('image/') ? 'image' : 'file';
}

type PersistIndex = { k: string; n: number }[];

const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const PERSIST_BUDGET_BYTES = 4 * 1024 * 1024;

export interface AttachmentStore {
  uploadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    roomId: string,
    bytes: Uint8Array,
    name: string,
    mime: string,
  ): Promise<AttachmentRef>;
  loadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    roomId: string,
    ref: AttachmentRef,
  ): Promise<Uint8Array>;
  clearAttachmentCache(): void;
}

/**
 * Create a scoped attachment store. Each app passes its own KV prefixes so
 * cached blobs from different apps don't collide in the shared KV store.
 */
export function createAttachmentStore(opts: {
  persistPrefix: string;
  persistIndex: string;
}): AttachmentStore {
  const { persistPrefix, persistIndex } = opts;

  const decryptedCache = new Map<string, Uint8Array>();
  let cacheBytes = 0;

  function cacheKey(roomId: string, blobId: string): string {
    return `${roomId}/${blobId}`;
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

  function persistStoreKey(roomId: string, blobId: string): string {
    return `${persistPrefix}${roomId}/${blobId}`;
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

  async function persistGet(roomId: string, blobId: string): Promise<Uint8Array | null> {
    const b64 = await kvGet(persistStoreKey(roomId, blobId));
    if (!b64) return null;
    try {
      return getBase64().decode(b64);
    } catch {
      return null;
    }
  }

  async function persistPut(roomId: string, blobId: string, stored: Uint8Array): Promise<void> {
    const storeKey = persistStoreKey(roomId, blobId);
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

  async function uploadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    roomId: string,
    bytes: Uint8Array,
    name: string,
    mime: string,
  ): Promise<AttachmentRef> {
    const blobId = randomId();
    const aad = attachmentName(roomId, blobId);
    const stored = enc ? await enc.sealBytes(bytes, aad) : bytes;
    await client.pushBlob(attachmentPush(roomId, blobId), stored, 'application/octet-stream');
    cachePut(cacheKey(roomId, blobId), bytes);
    await persistPut(roomId, blobId, stored);
    return { blobId, name, mime, size: bytes.length, kind: attachmentKind(mime) };
  }

  async function loadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    roomId: string,
    ref: AttachmentRef,
  ): Promise<Uint8Array> {
    const key = cacheKey(roomId, ref.blobId);
    const hit = decryptedCache.get(key);
    if (hit) return hit;
    let stored = await persistGet(roomId, ref.blobId);
    if (!stored) {
      const res = await client.pullBlob(attachmentPull(roomId, ref.blobId));
      stored = new Uint8Array(res.data);
      await persistPut(roomId, ref.blobId, stored);
    }
    const bytes = enc ? await enc.openBytes(stored, attachmentName(roomId, ref.blobId)) : stored;
    cachePut(key, bytes);
    return bytes;
  }

  function clearAttachmentCache(): void {
    decryptedCache.clear();
    cacheBytes = 0;
  }

  return { uploadAttachment, loadAttachment, clearAttachmentCache };
}
