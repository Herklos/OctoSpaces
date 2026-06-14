/**
 * Unit tests for the public-object directory helpers.
 *
 * `parseObjectDirectoryDoc` is a pure function and is tested directly without
 * any network mocking. `readObjectDirectory` wraps a live StarfishClient pull;
 * its integration is exercised by the E2E smoke test, not unit tests here.
 */
import { describe, it, expect } from 'vitest';
import { parseObjectDirectoryDoc } from './object-directory.js';

describe('parseObjectDirectoryDoc', () => {
  it('returns empty array for null / undefined / non-object', () => {
    expect(parseObjectDirectoryDoc(null)).toEqual([]);
    expect(parseObjectDirectoryDoc(undefined)).toEqual([]);
    expect(parseObjectDirectoryDoc('not-object')).toEqual([]);
    expect(parseObjectDirectoryDoc(42)).toEqual([]);
  });

  it('returns empty array for an array (not a map)', () => {
    expect(parseObjectDirectoryDoc([{ id: 'n1' }])).toEqual([]);
  });

  it('returns empty array for an empty map', () => {
    expect(parseObjectDirectoryDoc({})).toEqual([]);
  });

  it('flattens a single space bucket into entries', () => {
    const data = {
      'sp-1': {
        nodes: [{ id: 'n1', title: 'Public Page', type: 'page', updatedAt: 1000 }],
        ts: 9000,
      },
    };
    const result = parseObjectDirectoryDoc(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      spaceId: 'sp-1',
      id: 'n1',
      title: 'Public Page',
      type: 'page',
      updatedAt: 1000,
    });
  });

  it('flattens multiple spaces into a flat entry list', () => {
    const data = {
      'sp-1': { nodes: [{ id: 'a', title: 'A', type: 'page', updatedAt: 1 }] },
      'sp-2': {
        nodes: [
          { id: 'b', title: 'B', type: 'board', updatedAt: 2 },
          { id: 'c', title: 'C', type: 'page', updatedAt: 3 },
        ],
      },
    };
    const result = parseObjectDirectoryDoc(data);
    expect(result).toHaveLength(3);
    const spaceIds = result.map((e) => e.spaceId);
    expect(spaceIds.filter((s) => s === 'sp-1')).toHaveLength(1);
    expect(spaceIds.filter((s) => s === 'sp-2')).toHaveLength(2);
  });

  it('includes emoji when present, omits when absent', () => {
    const data = {
      'sp-1': {
        nodes: [
          { id: 'n1', title: 'Board', type: 'board', emoji: '📋', updatedAt: 1 },
          { id: 'n2', title: 'Page', type: 'page', updatedAt: 2 },
        ],
      },
    };
    const result = parseObjectDirectoryDoc(data);
    expect(result).toHaveLength(2);
    expect(result[0].emoji).toBe('📋');
    expect(result[1].emoji).toBeUndefined();
  });

  it('skips buckets with no nodes array', () => {
    const data = {
      'sp-1': { ts: 1000 },          // missing nodes
      'sp-2': null,                    // null bucket
      'sp-3': { nodes: [{ id: 'n1', title: 'OK', type: 'page', updatedAt: 5 }] },
    };
    const result = parseObjectDirectoryDoc(data);
    expect(result).toHaveLength(1);
    expect(result[0].spaceId).toBe('sp-3');
  });

  it('skips non-object nodes inside a bucket', () => {
    const data = {
      'sp-1': { nodes: [null, 'not-a-node', 42, { id: 'n1', title: 'Good', type: 'page', updatedAt: 1 }] },
    };
    const result = parseObjectDirectoryDoc(data);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });

  it('defaults missing string fields to empty/page', () => {
    const data = {
      'sp-1': { nodes: [{ id: 42, updatedAt: 'not-number', access: 'public' }] },
    };
    const result = parseObjectDirectoryDoc(data);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('');
    expect(result[0].type).toBe('page');
    expect(result[0].updatedAt).toBe(0);
  });
});
