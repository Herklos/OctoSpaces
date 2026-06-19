/**
 * Small base64 primitives over a *binary* (latin1) string — the native `btoa`/`atob`
 * on web, the Node `Buffer` fallback elsewhere. Shared by the link-fragment codec
 * and the cap-cert auth header so the platform branch lives in one place.
 *
 * NOTE: these operate on short strings. For multi-megabyte byte arrays use the
 * chunked `starfishBase64` provider in `base64.ts` instead — it avoids the
 * call-stack overflow that a single `btoa(String.fromCharCode(...))` would hit.
 */

/** Standard base64 of a binary (latin1) string. */
export function b64FromBinaryString(bin: string): string {
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/** Binary (latin1) string from standard base64. */
export function b64ToBinaryString(b64: string): string {
  return typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
}
