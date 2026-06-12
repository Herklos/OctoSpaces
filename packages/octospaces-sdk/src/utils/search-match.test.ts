import { describe, it, expect } from 'vitest';
import { matchTitle, rankResults, fold, isWordStart } from './search-match.js';

// ── fold ──────────────────────────────────────────────────────────────────────

describe('fold', () => {
  it('lowercases ASCII', () => expect(fold('Hello World')).toBe('hello world'));
  it('strips diacritics (é → e, ñ → n)', () => {
    expect(fold('café')).toBe('cafe');
    expect(fold('mañana')).toBe('manana');
  });
  it('preserves string length after stripping diacritics', () => {
    const s = 'crêpe';
    expect(fold(s).length).toBe(s.length);
  });
  it('passes through surrogate pairs unchanged', () => {
    const emoji = '🐙notes';
    expect(fold(emoji).length).toBe(emoji.length);
  });
});

// ── isWordStart ───────────────────────────────────────────────────────────────

describe('isWordStart', () => {
  it('position 0 is always a word start', () => expect(isWordStart('hello', 0)).toBe(true));
  it('letter after a space is a word start', () => expect(isWordStart('hello world', 6)).toBe(true));
  it('letter after another letter is not', () => expect(isWordStart('hello', 2)).toBe(false));
  it('letter after a dash is a word start', () => expect(isWordStart('hello-world', 6)).toBe(true));
});

// ── matchTitle tiers ──────────────────────────────────────────────────────────

describe('matchTitle', () => {
  it('returns null for empty query', () => expect(matchTitle('', 'Notes')).toBeNull());
  it('returns null on a miss', () => expect(matchTitle('xyz', 'Notes')).toBeNull());

  it('PREFIX tier — title starts with query', () => {
    const m = matchTitle('not', 'Notes');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(3900);
    expect(m!.ranges).toEqual([{ start: 0, end: 3 }]);
  });

  it('WORD tier — query matches at a word boundary', () => {
    const m = matchTitle('pa', 'New page');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(2900);
    expect(m!.score).toBeLessThan(4000);
    expect(m!.ranges[0]!.start).toBe(4); // 'p' in "page"
  });

  it('SUBSTRING tier — query appears mid-word', () => {
    const m = matchTitle('page', 'Homepage');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(1900);
    expect(m!.score).toBeLessThan(3000);
  });

  it('FUZZY tier — query is a subsequence', () => {
    const m = matchTitle('rdm', 'Roadmap');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(900);
    expect(m!.score).toBeLessThan(2000);
  });

  it('PREFIX beats WORD beats SUBSTRING beats FUZZY', () => {
    const prefix = matchTitle('no', 'Notes')!.score;
    const word = matchTitle('pa', 'New page')!.score;
    const substr = matchTitle('age', 'Homepage')!.score;
    const fuzzy = matchTitle('rdm', 'Roadmap')!.score;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(substr);
    expect(substr).toBeGreaterThan(fuzzy);
  });

  it('match is case-insensitive', () => {
    expect(matchTitle('NOTE', 'notes')).not.toBeNull();
    expect(matchTitle('note', 'NOTES')).not.toBeNull();
  });

  it('match is diacritic-insensitive', () => {
    expect(matchTitle('cafe', 'café au lait')).not.toBeNull();
    expect(matchTitle('creme', 'crème brûlée')).not.toBeNull();
  });

  it('fuzzy: spaces in query are ignored', () => {
    expect(matchTitle('new pg', 'New page')).not.toBeNull();
  });

  it('fuzzy: adjacent hits merge into one range', () => {
    const m = matchTitle('ab', 'xaby');
    expect(m).not.toBeNull();
    // 'ab' appears at position 1 as a substring; but if it fell through to fuzzy
    // the two chars 'a' and 'b' at positions 1 and 2 would be one merged range.
    expect(m!.ranges.length).toBe(1);
  });

  it('range spans index into original title (not folded)', () => {
    const title = 'New Page';
    const m = matchTitle('pa', title);
    expect(m).not.toBeNull();
    const { start, end } = m!.ranges[0]!;
    expect(title.slice(start, end).toLowerCase()).toBe('pa');
  });
});

// ── rankResults ───────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function item(title: string, updatedAt = NOW) {
  return { title, updatedAt };
}

describe('rankResults', () => {
  it('returns empty array for empty list', () => {
    expect(rankResults('test', [])).toEqual([]);
  });

  it('drops items that do not match', () => {
    const results = rankResults('xyz', [item('Notes'), item('Roadmap')]);
    expect(results).toHaveLength(0);
  });

  it('higher-tier match comes first', () => {
    // "Notes" is a prefix match for "not"; "Homepage" is only a substring match
    const results = rankResults('not', [item('Homepage notation'), item('Notes')]);
    expect(results[0]!.item.title).toBe('Notes');
  });

  it('recency breaks score ties', () => {
    const old = item('Notes', NOW - 10_000);
    const recent = item('Notes', NOW);
    const results = rankResults('not', [old, recent]);
    expect(results[0]!.item).toBe(recent);
  });

  it('respects limit', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`note ${i}`));
    const results = rankResults('note', items, 3);
    expect(results).toHaveLength(3);
  });

  it('each result carries score and ranges', () => {
    const results = rankResults('note', [item('Notes')]);
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.ranges.length).toBeGreaterThan(0);
  });
});
