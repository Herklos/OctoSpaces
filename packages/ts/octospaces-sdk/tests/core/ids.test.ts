import { describe, it, expect } from 'vitest';
import { randomId, slugify } from '../../src/core/ids.js';

describe('randomId', () => {
  it('returns a non-empty string', () => {
    expect(typeof randomId()).toBe('string');
    expect(randomId().length).toBeGreaterThan(0);
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
  });

  it('contains only URL-safe characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('General Channel')).toBe('general-channel');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Off-Topic!')).toBe('off-topic');
  });

  it('handles empty string — returns the non-empty fallback', () => {
    // slugify falls back to 'item' for empty input.
    expect(slugify('')).toBe('item');
  });

  it('returns lowercase for single word', () => {
    expect(slugify('General')).toBe('general');
  });

  it('trims leading/trailing hyphens', () => {
    const slug = slugify('  hello  ');
    expect(slug).not.toMatch(/^-|-$/);
  });
});
