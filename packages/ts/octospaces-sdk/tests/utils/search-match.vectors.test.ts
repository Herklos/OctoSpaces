/**
 * Cross-language conformance for utils/search-match.ts.
 * Shares tests/test-vectors/search-match.json with the Python suite.
 */
import { describe, it, expect } from 'vitest';
import { fold, isWordStart, matchTitle, rankResults } from '../../src/utils/search-match.js';
import vectors from '../../../../../tests/test-vectors/search-match.json';

describe('fold (vectors)', () => {
  for (const c of vectors.fold) {
    it(`fold(${JSON.stringify(c.input)})`, () => {
      const result = fold(c.input);
      if ('expected' in c) {
        expect(result).toBe((c as { expected: string }).expected);
      }
      // 'length_preserved' means fold(s).length == s.length in the host language's terms.
      // TS .length is UTF-16 code units — different from Python codepoints for emoji,
      // but the property (fold preserves length) holds in both.
      if ('length_preserved' in c && (c as { length_preserved: boolean }).length_preserved) {
        expect(result.length).toBe(c.input.length);
      }
    });
  }
});

describe('isWordStart (vectors)', () => {
  for (const c of vectors.isWordStart) {
    it(`isWordStart(${JSON.stringify(c.folded)}, ${c.i}) → ${c.expected}`, () => {
      expect(isWordStart(c.folded, c.i)).toBe(c.expected);
    });
  }
});

describe('matchTitle (vectors)', () => {
  for (const c of vectors.matchTitle) {
    const label = `matchTitle(${JSON.stringify(c.query)}, ${JSON.stringify(c.title)})`;
    it(label, () => {
      const result = matchTitle(c.query, c.title);
      if ('expected' in c && (c as { expected: unknown }).expected === null) {
        expect(result).toBeNull();
        return;
      }
      expect(result).not.toBeNull();
      if ('min_score' in c) {
        expect(result!.score).toBeGreaterThanOrEqual((c as { min_score: number }).min_score);
      }
      if ('max_score' in c) {
        expect(result!.score).toBeLessThan((c as { max_score: number }).max_score);
      }
      if ('expected_ranges' in c) {
        const expected = (c as { expected_ranges: { start: number; end: number }[] }).expected_ranges;
        expect(result!.ranges).toEqual(expected);
      }
      if ('expected_range_start' in c) {
        expect(result!.ranges[0]!.start).toBe((c as { expected_range_start: number }).expected_range_start);
      }
    });
  }
});

describe('rankResults (vectors)', () => {
  it('top id', () => {
    const c = vectors.rankResults[0]!;
    const ranked = rankResults(c.query, c.items);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.item.id).toBe((c as { expected_top_id: string }).expected_top_id);
  });

  it('matched ids', () => {
    const c = vectors.rankResults[1]!;
    const ranked = rankResults(c.query, c.items);
    const matchedIds = new Set(ranked.map((r) => r.item.id));
    for (const expectedId of (c as { expected_match_ids: string[] }).expected_match_ids) {
      expect(matchedIds.has(expectedId)).toBe(true);
    }
  });
});
