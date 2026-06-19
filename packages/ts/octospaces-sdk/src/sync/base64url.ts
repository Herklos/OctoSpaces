/**
 * base64url for link fragments (UTF-8 safe, web + native) — the encoding both
 * invitation-link kinds ride in a URL `#fragment`. No padding, `+/` → `-_`.
 */
import { b64FromBinaryString, b64ToBinaryString } from './b64-primitives.js';

export function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return b64FromBinaryString(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64url: string): string {
  const bin = b64ToBinaryString(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
