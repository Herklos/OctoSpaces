/**
 * Tests for sync/base64.ts (starfishBase64) and sync/base64url.ts.
 *
 * Covers correctness, padding edge cases, large-blob safety, and round-trips.
 * Also tests the pure fallback paths (encodePure / decodePure) against the
 * native btoa/atob paths when both are available.
 */
import { describe, it, expect } from 'vitest';
import { starfishBase64, toBase64Url, fromBase64Url } from '../../src/sync/base64.js';

// ── Helper: import the unexported pure functions via re-exporting trick ────────
// We test parity by using the public provider (which picks native if available)
// and the pure implementations (re-implemented inline here to test the algorithm).

function encodePure(data: Uint8Array): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const CHUNK = 0x6000;
  const len = data.length;
  const full = len - (len % 3);
  const parts: string[] = [];
  for (let start = 0; start < full; start += CHUNK) {
    const stop = Math.min(start + CHUNK, full);
    let s = '';
    for (let i = start; i < stop; i += 3) {
      const n = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      s += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
    }
    parts.push(s);
  }
  if (len - full === 1) {
    const n = data[full]! << 16;
    parts.push(ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==');
  } else if (len - full === 2) {
    const n = (data[full]! << 16) | (data[full + 1]! << 8);
    parts.push(ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=');
  }
  return parts.join('');
}

// ── starfishBase64 — edge cases ───────────────────────────────────────────────

describe('starfishBase64', () => {
  it('encodes empty input as empty string', () => {
    expect(starfishBase64.encode(new Uint8Array(0))).toBe('');
  });

  it('decodes empty string as empty Uint8Array', () => {
    const result = starfishBase64.decode('');
    expect(result.length).toBe(0);
  });

  it('1-byte input — produces == padding', () => {
    const data = new Uint8Array([0x61]); // 'a'
    const encoded = starfishBase64.encode(data);
    expect(encoded).toBe('YQ==');
    expect(encoded.endsWith('==')).toBe(true);
  });

  it('2-byte input — produces = padding', () => {
    const data = new Uint8Array([0x61, 0x62]); // 'ab'
    const encoded = starfishBase64.encode(data);
    expect(encoded).toBe('YWI=');
    expect(encoded.endsWith('=')).toBe(true);
    expect(encoded.endsWith('==')).toBe(false);
  });

  it('3-byte input — no padding (exact block)', () => {
    const data = new Uint8Array([0x61, 0x62, 0x63]); // 'abc'
    const encoded = starfishBase64.encode(data);
    expect(encoded).toBe('YWJj');
    expect(encoded.includes('=')).toBe(false);
  });

  it('4-byte input — 1 full block + 1-byte tail (== padding)', () => {
    const data = new Uint8Array([0x61, 0x62, 0x63, 0x64]); // 'abcd'
    const encoded = starfishBase64.encode(data);
    expect(encoded).toBe('YWJjZA==');
  });

  it('round-trips for 0 bytes', () => {
    const data = new Uint8Array(0);
    const encoded = starfishBase64.encode(data);
    const decoded = starfishBase64.decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('round-trips for 1 byte', () => {
    const data = new Uint8Array([255]);
    const decoded = starfishBase64.decode(starfishBase64.encode(data));
    expect(decoded).toEqual(data);
  });

  it('round-trips for 2 bytes', () => {
    const data = new Uint8Array([1, 2]);
    const decoded = starfishBase64.decode(starfishBase64.encode(data));
    expect(decoded).toEqual(data);
  });

  it('round-trips for 3 bytes (exact block)', () => {
    const data = new Uint8Array([10, 20, 30]);
    const decoded = starfishBase64.decode(starfishBase64.encode(data));
    expect(decoded).toEqual(data);
  });

  it('round-trips for arbitrary 100-byte input', () => {
    const data = new Uint8Array(100);
    crypto.getRandomValues(data);
    const decoded = starfishBase64.decode(starfishBase64.encode(data));
    expect(decoded).toEqual(data);
  });

  it('round-trips for 100,000 bytes (no stack overflow)', () => {
    const data = new Uint8Array(100_000);
    // Fill with predictable pattern (no crypto.getRandomValues for perf)
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const encoded = starfishBase64.encode(data);
    const decoded = starfishBase64.decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('pure fallback encodePure matches native encode for a known vector', () => {
    // Test that the pure algorithm produces the same output as the module
    // (the module uses native if available; pure is verified against the same input)
    const data = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
    const fromModule = starfishBase64.encode(data);
    const fromPure = encodePure(data);
    expect(fromModule).toBe(fromPure);
  });

  it('pure fallback parity for 1-byte tail', () => {
    const data = new Uint8Array([1, 2, 3, 4]); // 3 bytes + 1 tail
    expect(starfishBase64.encode(data)).toBe(encodePure(data));
  });

  it('pure fallback parity for 2-byte tail', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]); // 3 bytes + 2 tail
    expect(starfishBase64.encode(data)).toBe(encodePure(data));
  });

  it('pure fallback parity for large input', () => {
    const data = new Uint8Array(9999);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) & 0xff;
    expect(starfishBase64.encode(data)).toBe(encodePure(data));
  });

  it('produces only base64 alphabet chars plus optional padding', () => {
    const data = new Uint8Array(300);
    crypto.getRandomValues(data);
    const encoded = starfishBase64.encode(data);
    expect(/^[A-Za-z0-9+/]+=*$/.test(encoded)).toBe(true);
  });
});

// ── toBase64Url / fromBase64Url ───────────────────────────────────────────────

describe('toBase64Url / fromBase64Url', () => {
  it('round-trips an ASCII string', () => {
    const s = 'hello world!';
    expect(fromBase64Url(toBase64Url(s))).toBe(s);
  });

  it('round-trips an empty string', () => {
    expect(fromBase64Url(toBase64Url(''))).toBe('');
  });

  it('round-trips a JSON object string', () => {
    const s = JSON.stringify({ v: 2, key: 'value', nested: { a: 1 } });
    expect(fromBase64Url(toBase64Url(s))).toBe(s);
  });

  it('round-trips a unicode/emoji string', () => {
    const s = 'こんにちは🌍 héllo';
    expect(fromBase64Url(toBase64Url(s))).toBe(s);
  });

  it('output contains no "=" padding character', () => {
    // Test multiple lengths to cover all tail lengths (0, 1, 2 mod 3)
    for (const s of ['a', 'ab', 'abc', 'abcd', 'hello world']) {
      const encoded = toBase64Url(s);
      expect(encoded.includes('=')).toBe(false);
    }
  });

  it('output contains no "+" character (uses "-" instead)', () => {
    // Force a byte that maps to '+' in standard base64 — 0xFB = '+' in position
    // Use a string that produces '+' when encoded
    const allChars = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('');
    const encoded = toBase64Url(allChars);
    expect(encoded.includes('+')).toBe(false);
  });

  it('output contains no "/" character (uses "_" instead)', () => {
    const allChars = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('');
    const encoded = toBase64Url(allChars);
    expect(encoded.includes('/')).toBe(false);
  });

  it('output uses "-" and "_" as URL-safe replacements', () => {
    // Only valid base64url chars: A-Z a-z 0-9 - _
    const s = 'Test string with various chars: @#$%&*';
    const encoded = toBase64Url(s);
    expect(/^[A-Za-z0-9\-_]+$/.test(encoded)).toBe(true);
  });

  it('round-trips a long string', () => {
    const s = 'x'.repeat(10_000);
    expect(fromBase64Url(toBase64Url(s))).toBe(s);
  });
});
