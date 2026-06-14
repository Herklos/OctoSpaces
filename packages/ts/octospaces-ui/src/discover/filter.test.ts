import { describe, it, expect } from 'vitest';
import { filterDiscoverEntries, sortDiscoverEntries } from './filter.js';
import type { DiscoverEntry } from './types.js';

const entry = (id: string, title: string, updatedAt = 0): DiscoverEntry => ({
  id,
  spaceId: 'sp-1',
  title,
  type: 'page',
  updatedAt,
});

// ── filterDiscoverEntries ─────────────────────────────────────────────────────

describe('filterDiscoverEntries', () => {
  it('returns original reference for empty query', () => {
    const arr = [entry('a', 'Alpha')];
    expect(filterDiscoverEntries(arr, '')).toBe(arr);
    expect(filterDiscoverEntries(arr, '  ')).toBe(arr);
  });

  it('filters case-insensitively by substring', () => {
    const arr = [entry('a', 'Alpha Page'), entry('b', 'Beta Board'), entry('c', 'alpha task')];
    const result = filterDiscoverEntries(arr, 'alpha');
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('returns empty array when no matches', () => {
    const arr = [entry('a', 'Hello'), entry('b', 'World')];
    expect(filterDiscoverEntries(arr, 'xyz')).toHaveLength(0);
  });

  it('matches mid-word substrings', () => {
    const arr = [entry('a', 'Product Design'), entry('b', 'Roadmap')];
    expect(filterDiscoverEntries(arr, 'oduct')).toHaveLength(1);
  });

  it('handles empty entries array', () => {
    expect(filterDiscoverEntries([], 'query')).toEqual([]);
  });
});

// ── sortDiscoverEntries ───────────────────────────────────────────────────────

describe('sortDiscoverEntries', () => {
  it('sorts descending by updatedAt', () => {
    const arr = [entry('a', 'Old', 100), entry('b', 'New', 999), entry('c', 'Mid', 500)];
    const sorted = sortDiscoverEntries(arr);
    expect(sorted.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts entries without updatedAt last', () => {
    const arr: DiscoverEntry[] = [
      { id: 'a', spaceId: 'sp', title: 'A', type: 'page' },
      entry('b', 'B', 100),
    ];
    const sorted = sortDiscoverEntries(arr);
    expect(sorted[0].id).toBe('b');
    expect(sorted[1].id).toBe('a');
  });

  it('does not mutate the original array', () => {
    const arr = [entry('a', 'A', 200), entry('b', 'B', 100)];
    sortDiscoverEntries(arr);
    expect(arr[0].id).toBe('a');
  });

  it('handles empty array', () => {
    expect(sortDiscoverEntries([])).toEqual([]);
  });
});
