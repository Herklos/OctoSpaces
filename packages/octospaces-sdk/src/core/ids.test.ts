import { describe, it, expect } from 'vitest';
import { randomId, roomSlug } from './ids.js';

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

describe('roomSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(roomSlug('General Channel')).toBe('general-channel');
  });

  it('strips non-alphanumeric characters', () => {
    expect(roomSlug('Off-Topic!')).toBe('off-topic');
  });

  it('handles empty string — returns a non-empty fallback or empty string', () => {
    // roomSlug may return a fallback (e.g. 'room') for empty input.
    const result = roomSlug('');
    expect(typeof result).toBe('string');
  });

  it('returns lowercase for single word', () => {
    expect(roomSlug('General')).toBe('general');
  });

  it('trims leading/trailing hyphens', () => {
    const slug = roomSlug('  hello  ');
    expect(slug).not.toMatch(/^-|-$/);
  });
});
