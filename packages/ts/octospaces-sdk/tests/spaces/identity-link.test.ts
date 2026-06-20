/**
 * Tests for identity-link.ts — v:2 token encode/decode/verify.
 *
 * Uses real Ed25519 / X25519 crypto from @noble/curves (no mocks on the crypto layer).
 * readProfile is mocked for verifyIdentityLinkKeys tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hexToBytes, bytesToHex } from '@drakkar.software/starfish-keyring';

import {
  encodeIdentityLink,
  decodeIdentityLink,
  verifyIdentityLinkBinding,
  verifyIdentityLinkKeys,
} from '../../src/spaces/identity-link.js';
import type { IdentityLink } from '../../src/spaces/identity-link.js';
import { toBase64Url } from '../../src/sync/base64.js';
import { userIdFromEdPub } from '../../src/sync/paths.js';

// ── Mock readProfile (used by verifyIdentityLinkKeys) ─────────────────────────
vi.mock('../../src/sync/client.js', () => ({
  readProfile: vi.fn(),
}));

// ── Key generation helpers ────────────────────────────────────────────────────

function makeEdKeypair(): { edPriv: string; edPub: string } {
  const privBytes = new Uint8Array(32);
  crypto.getRandomValues(privBytes);
  const edPriv = bytesToHex(privBytes);
  const edPub = bytesToHex(ed25519.getPublicKey(privBytes));
  return { edPriv, edPub };
}

function makeKemKeypair(): { kemPriv: string; kemPub: string } {
  const privBytes = new Uint8Array(32);
  crypto.getRandomValues(privBytes);
  const kemPriv = bytesToHex(privBytes);
  const kemPub = bytesToHex(x25519.getPublicKey(privBytes));
  return { kemPriv, kemPub };
}

async function makeToken(overrides: Partial<IdentityLink> = {}): Promise<{
  token: IdentityLink;
  edPriv: string;
}> {
  const { edPriv, edPub } = makeEdKeypair();
  const { kemPub } = makeKemKeypair();
  const kemSig = bytesToHex(ed25519.sign(hexToBytes(kemPub), hexToBytes(edPriv)));
  const ownerId = await userIdFromEdPub(edPub);
  const token: IdentityLink = {
    v: 2,
    ownerId,
    pseudo: 'Tester',
    edPub,
    kemPub,
    kemSig,
    ...overrides,
  };
  return { token, edPriv };
}

// ── encodeIdentityLink / decodeIdentityLink round-trip ────────────────────────

describe('encodeIdentityLink / decodeIdentityLink', () => {
  it('round-trips a valid v:2 token', async () => {
    const { token } = await makeToken();
    const link = encodeIdentityLink('https://example.com', 'request', token);
    const frag = link.slice(link.indexOf('#'));
    const decoded = decodeIdentityLink(frag);
    expect(decoded.v).toBe(2);
    expect(decoded.ownerId).toBe(token.ownerId);
    expect(decoded.edPub).toBe(token.edPub);
    expect(decoded.kemPub).toBe(token.kemPub);
    expect(decoded.kemSig).toBe(token.kemSig);
    expect(decoded.pseudo).toBe(token.pseudo);
  });

  it('strips leading # from fragment', async () => {
    const { token } = await makeToken();
    const link = encodeIdentityLink('https://example.com', 'request', token);
    const withHash = link.slice(link.indexOf('#'));
    const withoutHash = withHash.slice(1);
    expect(decodeIdentityLink(withHash)).toEqual(decodeIdentityLink(withoutHash));
  });

  it('encodeIdentityLink strips trailing slash from origin', async () => {
    const { token } = await makeToken();
    const a = encodeIdentityLink('https://example.com/', 'request', token);
    const b = encodeIdentityLink('https://example.com', 'request', token);
    expect(a).toBe(b);
  });

  it('encodeIdentityLink strips leading slash from path', async () => {
    const { token } = await makeToken();
    const a = encodeIdentityLink('https://example.com', '/request', token);
    const b = encodeIdentityLink('https://example.com', 'request', token);
    expect(a).toBe(b);
  });

  it('round-trip preserves empty pseudo', async () => {
    const { token } = await makeToken({ pseudo: '' });
    const link = encodeIdentityLink('https://example.com', 'r', token);
    const decoded = decodeIdentityLink(link.slice(link.indexOf('#') + 1));
    expect(decoded.pseudo).toBe('');
  });
});

// ── decodeIdentityLink error cases ────────────────────────────────────────────

describe('decodeIdentityLink — malformed inputs', () => {
  it('throws on empty string', () => {
    expect(() => decodeIdentityLink('')).toThrow();
  });

  it('throws on plain non-base64url garbage', () => {
    expect(() => decodeIdentityLink('not-valid-base64url!!!')).toThrow();
  });

  it('throws on v:1 token (clean break)', () => {
    const v1 = toBase64Url(JSON.stringify({
      v: 1,
      ownerId: 'a'.repeat(32),
      pseudo: 'old',
      edPub: 'b'.repeat(64),
      kemPub: 'c'.repeat(64),
    }));
    expect(() => decodeIdentityLink(v1)).toThrow();
  });

  it('throws when kemSig field is missing', () => {
    const { edPub } = makeEdKeypair();
    const { kemPub } = makeKemKeypair();
    const raw = toBase64Url(JSON.stringify({
      v: 2,
      ownerId: 'a'.repeat(32),
      pseudo: 'test',
      edPub,
      kemPub,
      // kemSig intentionally omitted
    }));
    expect(() => decodeIdentityLink(raw)).toThrow();
  });

  it('throws when kemSig has wrong length (< 128 hex chars)', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, kemSig: 'a'.repeat(64) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when kemSig has wrong length (> 128 hex chars)', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, kemSig: 'a'.repeat(130) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when kemPub has wrong length (< 64 hex chars)', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, kemPub: 'a'.repeat(32) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when kemPub has wrong length (> 64 hex chars)', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, kemPub: 'a'.repeat(66) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when ownerId has wrong length (not 32 hex chars)', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, ownerId: 'a'.repeat(31) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when edPub has wrong length (not 64 hex chars)', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, edPub: 'a'.repeat(63) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when kemSig contains non-hex chars', async () => {
    const { token } = await makeToken();
    const bad = toBase64Url(JSON.stringify({ ...token, kemSig: 'g'.repeat(128) }));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });

  it('throws when v is missing', async () => {
    const { token } = await makeToken();
    const { v: _v, ...noV } = token;
    const bad = toBase64Url(JSON.stringify(noV));
    expect(() => decodeIdentityLink(bad)).toThrow();
  });
});

// ── verifyIdentityLinkBinding ─────────────────────────────────────────────────

describe('verifyIdentityLinkBinding', () => {
  it('returns true for a correctly constructed token', async () => {
    const { token } = await makeToken();
    expect(await verifyIdentityLinkBinding(token)).toBe(true);
  });

  it('returns false when ownerId does not match sha256(edPub)[0:32]', async () => {
    const { token } = await makeToken();
    const flipped = token.ownerId.endsWith('0')
      ? token.ownerId.slice(0, -1) + '1'
      : token.ownerId.slice(0, -1) + '0';
    expect(await verifyIdentityLinkBinding({ ...token, ownerId: flipped })).toBe(false);
  });

  it('returns false when kemPub is tampered (valid hex/length, wrong sig)', async () => {
    const { token } = await makeToken();
    // Generate a different kemPub
    const { kemPub: otherKemPub } = makeKemKeypair();
    // kemSig still signs the original kemPub — mismatches after swap
    expect(await verifyIdentityLinkBinding({ ...token, kemPub: otherKemPub })).toBe(false);
  });

  it('returns false when kemSig is garbage (correct length, wrong bytes)', async () => {
    const { token } = await makeToken();
    const garbleSig = '0'.repeat(128);
    expect(await verifyIdentityLinkBinding({ ...token, kemSig: garbleSig })).toBe(false);
  });

  it('returns false when edPub is replaced (binding breaks)', async () => {
    const { token } = await makeToken();
    const { edPub: otherEdPub } = makeEdKeypair();
    // ownerId was computed from original edPub — now mismatch on both checks
    expect(await verifyIdentityLinkBinding({ ...token, edPub: otherEdPub })).toBe(false);
  });
});

// ── verifyIdentityLinkKeys ────────────────────────────────────────────────────

describe('verifyIdentityLinkKeys', () => {
  it('passes silently when profile keys match the token', async () => {
    const { token } = await makeToken();
    const { readProfile } = await import('../../src/sync/client.js');
    vi.mocked(readProfile).mockResolvedValueOnce({
      pseudo: token.pseudo,
      avatar: null,
      edPub: token.edPub,
      kemPub: token.kemPub,
      kemSig: token.kemSig,
    });
    await expect(verifyIdentityLinkKeys(token)).resolves.toBeUndefined();
  });

  it('throws when profile edPub differs from token edPub', async () => {
    const { token } = await makeToken();
    const { edPub: differentEdPub } = makeEdKeypair();
    const { readProfile } = await import('../../src/sync/client.js');
    vi.mocked(readProfile).mockResolvedValueOnce({
      pseudo: null,
      avatar: null,
      edPub: differentEdPub,
      kemPub: token.kemPub,
      kemSig: token.kemSig,
    });
    await expect(verifyIdentityLinkKeys(token)).rejects.toThrow();
  });

  it('throws when profile kemPub differs from token kemPub', async () => {
    const { token } = await makeToken();
    const { kemPub: differentKemPub } = makeKemKeypair();
    const { readProfile } = await import('../../src/sync/client.js');
    vi.mocked(readProfile).mockResolvedValueOnce({
      pseudo: null,
      avatar: null,
      edPub: token.edPub,
      kemPub: differentKemPub,
      kemSig: null,
    });
    await expect(verifyIdentityLinkKeys(token)).rejects.toThrow();
  });

  it('passes silently when readProfile throws (fail-open for offline)', async () => {
    const { token } = await makeToken();
    const { readProfile } = await import('../../src/sync/client.js');
    vi.mocked(readProfile).mockRejectedValueOnce(new Error('network error'));
    await expect(verifyIdentityLinkKeys(token)).resolves.toBeUndefined();
  });

  it('passes silently when profile fields are null (no keys published yet)', async () => {
    const { token } = await makeToken();
    const { readProfile } = await import('../../src/sync/client.js');
    vi.mocked(readProfile).mockResolvedValueOnce({
      pseudo: null,
      avatar: null,
      edPub: null,
      kemPub: null,
      kemSig: null,
    });
    await expect(verifyIdentityLinkKeys(token)).resolves.toBeUndefined();
  });
});
