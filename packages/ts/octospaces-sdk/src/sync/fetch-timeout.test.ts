import { describe, it, expect } from 'vitest';
import { CONNECT_TIMEOUT_MS, fetchWithTimeout } from './fetch-timeout.js';

describe('CONNECT_TIMEOUT_MS', () => {
  it('is 12 seconds', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(12_000);
  });
});

describe('fetchWithTimeout', () => {
  it('returns a fetch function', () => {
    const fn = fetchWithTimeout();
    expect(typeof fn).toBe('function');
  });

  it('returns a fetch function with custom timeout', () => {
    const fn = fetchWithTimeout(5_000);
    expect(typeof fn).toBe('function');
  });

  it('aborts on timeout', async () => {
    // Use a very short timeout and a never-resolving URL to trigger abort.
    const fn = fetchWithTimeout(10);
    await expect(fn('https://httpbin.org/delay/10')).rejects.toThrow();
  }, 2_000);
});
