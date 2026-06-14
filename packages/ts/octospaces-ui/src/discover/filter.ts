import type { DiscoverEntry } from './types.js';

/**
 * Case-insensitive substring filter over a `DiscoverEntry[]`.
 *
 * Returns the original array reference unchanged when `query` is blank so the
 * caller can skip a re-render. Pure function — no side effects.
 */
export function filterDiscoverEntries(
  entries: DiscoverEntry[],
  query: string,
): DiscoverEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.title.toLowerCase().includes(q));
}

/**
 * Sort discover entries by updatedAt descending (most recent first).
 * Entries without an `updatedAt` field sort last. Pure function.
 */
export function sortDiscoverEntries(entries: DiscoverEntry[]): DiscoverEntry[] {
  return [...entries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
