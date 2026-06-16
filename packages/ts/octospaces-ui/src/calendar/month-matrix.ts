/**
 * Pure date-math helpers for building a calendar month grid.
 *
 * No React, no React Native — these functions are pure transformations over
 * numbers and can be unit-tested without any platform setup.
 */

/** Represents one cell in the month grid. */
export interface MatrixDay {
  /** Day-of-month for this cell, 1–31. Out-of-month padding cells show the
   *  neighboring month's day number (so the grid is always fully populated). */
  day: number;
  /** JavaScript month index (0–11) for this cell's date. Padding cells carry
   *  the neighboring month's index. */
  month: number;
  /** Full year for this cell's date. */
  year: number;
  /**
   * Unix milliseconds for midnight **local time** of this cell's date.
   * Use as a stable key for event bucketing (see {@link bucketEventsByDay}).
   */
  timestamp: number;
  /** `true` when this cell belongs to the displayed month; `false` for
   *  leading/trailing padding days from the previous/next month. */
  inMonth: boolean;
  /** `true` when this cell represents the current calendar date, determined
   *  by comparing against the `todayMs` option passed to {@link buildMonthMatrix}. */
  isToday: boolean;
}

export type WeekRow = MatrixDay[];

/**
 * A month grid: 4–6 week rows × 7 day columns.
 * Row count is the minimum needed to accommodate the month plus leading/trailing
 * padding (never a fixed 6 rows).
 */
export type MonthMatrix = WeekRow[];

export interface BuildMonthMatrixOptions {
  /**
   * Which weekday opens each row.
   * `0` = Sunday (US convention), `1` = Monday (EU/editorial, default).
   */
  weekStart?: 0 | 1;
  /**
   * Unix milliseconds representing "today". Used to set `isToday` on the
   * matching cell. Pass explicitly rather than relying on `Date.now()` inside
   * the function so the result is deterministic in tests and server-side renders.
   *
   * If omitted, no cell will have `isToday = true`.
   */
  todayMs?: number;
}

/**
 * Build a {@link MonthMatrix} for the given year and month.
 *
 * @param year   Full year (e.g. 2026).
 * @param month  JavaScript month index, 0–11.
 * @param opts   Optional {@link BuildMonthMatrixOptions}.
 */
export function buildMonthMatrix(
  year: number,
  month: number,
  opts?: BuildMonthMatrixOptions,
): MonthMatrix {
  const weekStart = opts?.weekStart ?? 1;

  // Parse "today" if provided.
  let todayYear: number | undefined;
  let todayMonth: number | undefined;
  let todayDay: number | undefined;
  if (opts?.todayMs !== undefined) {
    const t = new Date(opts.todayMs);
    todayYear = t.getFullYear();
    todayMonth = t.getMonth();
    todayDay = t.getDate();
  }

  // First day of the displayed month, used to compute its day-of-week.
  const firstOfMonth = new Date(year, month, 1);
  // Number of days in the displayed month.
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Column index (0-based) of the first day of the month.
  //   weekStart=1 (Mon): Mon→0, Tue→1, Wed→2, Thu→3, Fri→4, Sat→5, Sun→6
  //   weekStart=0 (Sun): Sun→0, Mon→1, Tue→2, Wed→3, Thu→4, Fri→5, Sat→6
  const firstDayOfWeek = firstOfMonth.getDay(); // JS: 0=Sun … 6=Sat
  const startCol =
    weekStart === 1
      ? (firstDayOfWeek + 6) % 7 // Mon-start: rotate so Mon=0
      : firstDayOfWeek;           // Sun-start: unchanged

  const totalCells = startCol + daysInMonth;
  const numRows = Math.ceil(totalCells / 7);

  const matrix: MonthMatrix = [];

  for (let row = 0; row < numRows; row++) {
    const week: WeekRow = [];
    for (let col = 0; col < 7; col++) {
      const cellIndex = row * 7 + col;
      // Day-of-month for this cell in the displayed month's coordinate space.
      // Negative values are leading padding (prev month); values > daysInMonth
      // are trailing padding (next month).
      const dayOfMonth = cellIndex - startCol + 1;

      let cellYear: number;
      let cellMonth: number;
      let cellDay: number;
      let inMonth: boolean;

      if (dayOfMonth < 1) {
        // ── Leading padding (previous month) ───────────────────────────────
        inMonth = false;
        // new Date(year, month, 0) = last day of the previous month.
        const lastOfPrev = new Date(year, month, 0);
        cellDay = lastOfPrev.getDate() + dayOfMonth; // dayOfMonth ≤ 0
        cellMonth = lastOfPrev.getMonth();
        cellYear = lastOfPrev.getFullYear();
      } else if (dayOfMonth > daysInMonth) {
        // ── Trailing padding (next month) ───────────────────────────────────
        inMonth = false;
        cellDay = dayOfMonth - daysInMonth;
        const firstOfNext = new Date(year, month + 1, 1);
        cellMonth = firstOfNext.getMonth();
        cellYear = firstOfNext.getFullYear();
      } else {
        // ── Normal cell (displayed month) ───────────────────────────────────
        inMonth = true;
        cellDay = dayOfMonth;
        cellMonth = month;
        cellYear = year;
      }

      // Local-midnight timestamp for this cell.
      const timestamp = new Date(cellYear, cellMonth, cellDay).getTime();

      const isToday =
        todayYear !== undefined &&
        cellYear === todayYear &&
        cellMonth === todayMonth &&
        cellDay === todayDay;

      week.push({ day: cellDay, month: cellMonth, year: cellYear, timestamp, inMonth, isToday });
    }
    matrix.push(week);
  }

  return matrix;
}

/**
 * Build the string key used by {@link bucketEventsByDay} for a given
 * {@link MatrixDay}. Use this when looking up the bucket for a day cell:
 *
 * ```ts
 * const bucket = bucketEventsByDay(events);
 * const dayEvents = bucket.get(matrixDayKey(day)) ?? [];
 * ```
 */
export function matrixDayKey(day: MatrixDay): string {
  return `${day.year}-${String(day.month + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

/**
 * Bucket a list of events by local calendar day, returning a `Map` from
 * `YYYY-MM-DD` key → events array.
 *
 * Events that span multiple days (where `end` falls on a later date than
 * `start`) appear in the bucket for **every** day they cover. Single-day
 * events appear in the bucket for their start day only.
 *
 * This function is generic over the event shape: it only requires a `start`
 * (ms) field; `end` is optional (defaults to `start`).
 *
 * ```ts
 * const bucket = bucketEventsByDay(events);
 * // In the render loop:
 * const todayEvents = bucket.get(matrixDayKey(day)) ?? [];
 * ```
 */
export function bucketEventsByDay<T extends { start: number; end?: number }>(
  events: T[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();

  function localDayKey(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  for (const event of events) {
    const startKey = localDayKey(event.start);
    const endMs = event.end ?? event.start;
    const endKey = localDayKey(endMs);

    if (startKey === endKey) {
      // Single-day event.
      const list = result.get(startKey) ?? [];
      list.push(event);
      result.set(startKey, list);
    } else {
      // Multi-day event — add to every day between start and end (inclusive).
      const cursor = new Date(event.start);
      cursor.setHours(0, 0, 0, 0);
      const endDate = new Date(endMs);
      endDate.setHours(0, 0, 0, 0);

      while (cursor <= endDate) {
        const key = localDayKey(cursor.getTime());
        const list = result.get(key) ?? [];
        list.push(event);
        result.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }

  return result;
}
