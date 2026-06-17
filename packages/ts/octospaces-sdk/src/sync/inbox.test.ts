/**
 * Tests for sync/inbox.ts — shard rotation helpers.
 *
 * inboxShard() and inboxShards() use new Date() internally.
 * We test the format contract, the two-element guarantee, consistency between
 * the two functions, and the January→December wrap logic.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { inboxShard, inboxShards } from './inbox.js';

afterEach(() => {
  vi.useRealTimers();
});

// ── inboxShard ────────────────────────────────────────────────────────────────

describe('inboxShard', () => {
  it('returns a string matching YYYY-MM format', () => {
    const shard = inboxShard();
    expect(shard).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns current UTC month (Jan = 01, Dec = 12)', () => {
    // Mock to a known UTC date: 2024-03-15
    vi.setSystemTime(new Date('2024-03-15T10:00:00Z'));
    expect(inboxShard()).toBe('2024-03');
  });

  it('pads single-digit months with a leading zero', () => {
    vi.setSystemTime(new Date('2025-07-01T00:00:00Z'));
    expect(inboxShard()).toBe('2025-07');
  });

  it('handles December correctly (month 12)', () => {
    vi.setSystemTime(new Date('2024-12-31T23:59:59Z'));
    expect(inboxShard()).toBe('2024-12');
  });

  it('handles January correctly (month 01)', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    expect(inboxShard()).toBe('2025-01');
  });
});

// ── inboxShards ───────────────────────────────────────────────────────────────

describe('inboxShards', () => {
  it('returns exactly 2 elements', () => {
    const shards = inboxShards();
    expect(shards).toHaveLength(2);
  });

  it('first element is current shard (agrees with inboxShard)', () => {
    // Use a fixed clock so both calls see the same "now"
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    const [current] = inboxShards();
    expect(current).toBe(inboxShard());
  });

  it('second element is the previous UTC month', () => {
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    const [, previous] = inboxShards();
    expect(previous).toBe('2024-05');
  });

  it('wraps January previous month to December of prior year', () => {
    vi.setSystemTime(new Date('2025-01-10T00:00:00Z'));
    const [current, previous] = inboxShards();
    expect(current).toBe('2025-01');
    expect(previous).toBe('2024-12');
  });

  it('February previous month is January of same year', () => {
    vi.setSystemTime(new Date('2025-02-14T00:00:00Z'));
    const [current, previous] = inboxShards();
    expect(current).toBe('2025-02');
    expect(previous).toBe('2025-01');
  });

  it('December previous month is November of same year', () => {
    vi.setSystemTime(new Date('2024-12-01T00:00:00Z'));
    const [current, previous] = inboxShards();
    expect(current).toBe('2024-12');
    expect(previous).toBe('2024-11');
  });

  it('shards are sorted current-first (newest first)', () => {
    vi.setSystemTime(new Date('2024-08-20T00:00:00Z'));
    const [current, previous] = inboxShards();
    // current > previous lexicographically (YYYY-MM is sortable)
    expect(current > previous).toBe(true);
  });

  it('both elements match YYYY-MM format', () => {
    const shards = inboxShards();
    for (const shard of shards) {
      expect(shard).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});
