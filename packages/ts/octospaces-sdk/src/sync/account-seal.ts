/**
 * Seal a small secret to an X25519 KEM key so it can ride in a plaintext synced
 * doc without exposing it to the server.
 *
 *  - {@link sealToSelf}/{@link unsealFromSelf} — sealed to THIS account's own key
 *    (public-space join credentials, which embed a bearer secret). Recovered on
 *    any device with the same seed.
 *  - {@link sealToRecipient}/{@link unsealFromRecipient} — sealed to ANOTHER user's
 *    published KEM key (DM-invite delivery).
 */
import {
  bytesToHex,
  hexToBytes,
  unwrapFromEntry,
  verifyEntrySignature,
  wrapForRecipient,
} from '@drakkar.software/starfish-keyring';
import type { WrappedKeyEntry } from '@drakkar.software/starfish-keyring';

import type { Session } from './identity.js';

/** A payload sealed to a KEM key: the wrapped CEK + hex(iv ‖ AES-GCM ct). */
export interface SealedBlob {
  entry: WrappedKeyEntry;
  ct: string;
  /** v:1 indicates AAD context-binding was applied during sealing. */
  v?: 1;
}

const SELF_EPOCH = 0;

const subtle = () => globalThis.crypto.subtle;

async function seal(session: Session, recipientKemPub: string, plaintext: string, aad?: string): Promise<SealedBlob> {
  const cek = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const entry = await wrapForRecipient(cek, recipientKemPub, {
    adderEdPrivHex: session.keys.edPriv,
    adderEdPubHex: session.keys.edPub,
    addedAt: Math.floor(Date.now() / 1000),
    epoch: SELF_EPOCH,
  });
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await subtle().importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encParams: AesGcmParams = aad
    ? { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }
    : { name: 'AES-GCM', iv };
  const ctBuf = await subtle().encrypt(encParams, key, new TextEncoder().encode(plaintext));
  const packed = new Uint8Array(iv.length + ctBuf.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ctBuf), iv.length);
  const blob: SealedBlob = { entry, ct: bytesToHex(packed) };
  if (aad) blob.v = 1;
  return blob;
}

async function open(session: Session, blob: SealedBlob, aad?: string): Promise<string> {
  // S1 fix: v:1 blobs were sealed with context AAD — opening without it is a
  // downgrade / relocation attack. Reject eagerly before any crypto operation.
  if (blob.v === 1 && !aad) {
    throw new Error('aad required: this blob (v:1) was sealed with context binding — pass the matching aad to open it.');
  }
  const cek = await unwrapFromEntry(blob.entry, session.keys.kemPriv);
  const packed = hexToBytes(blob.ct);
  const iv = new Uint8Array(packed.subarray(0, 12));
  const ctBytes = new Uint8Array(packed.subarray(12));
  const key = await subtle().importKey('raw', new Uint8Array(cek), { name: 'AES-GCM' }, false, ['decrypt']);
  const decParams: AesGcmParams = aad
    ? { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }
    : { name: 'AES-GCM', iv };
  const out = await subtle().decrypt(decParams, key, ctBytes);
  return new TextDecoder().decode(out);
}

/** Seal `plaintext` so only this account (its seed) can open it. */
export function sealToSelf(session: Session, plaintext: string, aad?: string): Promise<SealedBlob> {
  return seal(session, session.keys.kemPub, plaintext, aad);
}

/** Open a {@link SealedBlob} sealed by {@link sealToSelf} for this account. */
export async function unsealFromSelf(session: Session, blob: SealedBlob, aad?: string): Promise<string> {
  if (blob.entry.addedBy !== session.keys.edPub) throw new Error('sealed blob not self-signed');
  if (!(await verifyEntrySignature(blob.entry, SELF_EPOCH))) throw new Error('sealed blob signature invalid');
  return open(session, blob, aad);
}

/** Seal `plaintext` to ANOTHER user's published KEM key, signed by this session. */
export function sealToRecipient(session: Session, recipientKemPub: string, plaintext: string, aad?: string): Promise<SealedBlob> {
  return seal(session, recipientKemPub, plaintext, aad);
}

/** Open a {@link SealedBlob} sealed to THIS account by some (arbitrary) sender. */
export async function unsealFromRecipient(session: Session, blob: SealedBlob, aad?: string): Promise<string> {
  if (!(await verifyEntrySignature(blob.entry, SELF_EPOCH))) throw new Error('sealed blob signature invalid');
  return open(session, blob, aad);
}
