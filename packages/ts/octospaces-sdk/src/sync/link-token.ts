/**
 * Shared URL-fragment encode/decode helpers for invite and identity link tokens.
 * Centralises the origin-trim + base64url fragment pack/unpack used by
 * members.ts, nodes.ts, and identity-link.ts.
 */
import { toBase64Url, fromBase64Url } from './base64url.js';

export function encodeLinkFragment(origin: string, path: string, token: unknown): string {
  const base = origin.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${base}/${p}#${toBase64Url(JSON.stringify(token))}`;
}

export function decodeLinkFragment<T>(fragment: string, validate: (tok: Partial<T>) => tok is T, errMsg: string): T {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  let tok: Partial<T>;
  try {
    tok = JSON.parse(fromBase64Url(frag)) as Partial<T>;
  } catch {
    throw new Error(errMsg);
  }
  if (!validate(tok)) throw new Error(errMsg);
  return tok;
}
