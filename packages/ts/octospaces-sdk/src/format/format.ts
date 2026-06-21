/** Display helpers shared across screens — keep formatting logic out of components. */

/**
 * Count + correctly pluralized noun, e.g. `plural(1, 'reply', 'replies')` →
 * "1 reply" and `plural(3, 'member')` → "3 members".
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Clock time `HH:MM` from a unix-ms timestamp (plaintext share feeds carry raw ts). */
export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 1–2 letter monogram from a display name, for an avatar with no uploaded image. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Human-readable byte size, e.g. 2_400_000 → "2.3 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// ── Relative timestamps ──────────────────────────────────────────────────────
//
// Compact relative timestamps for metadata captions ("Edited 3h ago", an archived
// row's "Archived yesterday"). Coarse on purpose: a knowledge app's "when" is
// orientation, not telemetry, so past a week we fall back to a short calendar date
// instead of counting ever-larger units. Pure (no React) — pass `now` in tests for
// determinism.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Ultra-compact variant for dense mono captions at the right edge of a result
 * row (quick-find, search): "now", "5m", "3h", "2d", "4w", then a calendar date
 * ("Mar 3", "Mar 2024" once the year differs). No "ago" — the column is narrow.
 */
export function relativeTimeShort(ts: number, now: number = Date.now()): string {
  if (!ts) return '';
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w`;
  const d = new Date(ts);
  return d.getFullYear() === new Date(now).getFullYear()
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
