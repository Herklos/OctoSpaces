/**
 * A chunked base64 provider for the Starfish platform.
 *
 * The SDK's default web encoder is `btoa(String.fromCharCode(...data))`, which
 * spreads the entire byte array into one call — a multi-megabyte attachment
 * overflows the argument/stack limit and throws "Maximum call stack size exceeded".
 * This provider walks the bytes in fixed windows instead, so it scales to large blobs.
 *
 * Prefers the platform's own `btoa`/`atob` (web) and falls back to a pure
 * implementation where they're absent (Hermes/native).
 */
import type { Base64Provider } from '@drakkar.software/starfish-protocol';

const CHUNK = 0x6000; // 24 576 bytes — multiple of 3, well under V8's apply limit

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const REVERSE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

const nativeCodec =
  typeof globalThis !== 'undefined' &&
  typeof globalThis.btoa === 'function' &&
  typeof globalThis.atob === 'function';

function encodeViaBtoa(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return globalThis.btoa(binary);
}

function decodeViaAtob(encoded: string): Uint8Array {
  const binary = globalThis.atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encodePure(data: Uint8Array): string {
  const len = data.length;
  const full = len - (len % 3);
  const parts: string[] = [];
  for (let start = 0; start < full; start += CHUNK) {
    const stop = Math.min(start + CHUNK, full);
    let s = '';
    for (let i = start; i < stop; i += 3) {
      const n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
    }
    parts.push(s);
  }
  if (len - full === 1) {
    const n = data[full] << 16;
    parts.push(ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==');
  } else if (len - full === 2) {
    const n = (data[full] << 16) | (data[full + 1] << 8);
    parts.push(ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=');
  }
  return parts.join('');
}

function decodePure(encoded: string): Uint8Array {
  let validLen = encoded.length;
  while (validLen > 0 && encoded.charCodeAt(validLen - 1) === 61) validLen--;
  const out = new Uint8Array((validLen * 3) >> 2);
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < validLen; i++) {
    const code = encoded.charCodeAt(i);
    const v = code < 128 ? REVERSE[code] : -1;
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Spread-free, chunked base64 — a drop-in for the SDK's default provider. */
export const starfishBase64: Base64Provider = nativeCodec
  ? { encode: encodeViaBtoa, decode: decodeViaAtob }
  : { encode: encodePure, decode: decodePure };
