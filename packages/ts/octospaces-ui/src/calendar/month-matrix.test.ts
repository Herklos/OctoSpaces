import { describe, it, expect } from 'vitest';
import {
  buildMonthMatrix,
  bucketEventsByDay,
  matrixDayKey,
  type MatrixDay,
} from './month-matrix.js';

// ── buildMonthMatrix ──────────────────────────────────────────────────────────

describe('buildMonthMatrix', () => {
  describe('grid shape', () => {
    it('always produces 7 columns per row', () => {
      // June 2026 starts on Monday — 5 rows needed.
      const matrix = buildMonthMatrix(2026, 5);
      for (const week of matrix) {
        expect(week).toHaveLength(7);
      }
    });

    it('produces enough rows to cover all days of the month', () => {
      // June 2026: 30 days, Mon-start → 5 rows.
      const matrix = buildMonthMatrix(2026, 5);
      const inMonthCells = matrix.flat().filter((d) => d.inMonth);
      expect(inMonthCells).toHaveLength(30);
    });

    it('produces 6 rows when the month needs it', () => {
      // October 2023: 31 days, starts on Sunday (weekStart=1 → Sun is last col).
      // startCol = (0 + 6) % 7 = 6. totalCells = 6+31=37 → 6 rows.
      const matrix = buildMonthMatrix(2023, 9, { weekStart: 1 });
      expect(matrix).toHaveLength(6);
    });

    it('produces 4 rows for short months that fit', () => {
      // February 2021: 28 days, starts on Monday (weekStart=1 → col 0).
      // startCol = 0, totalCells = 28, rows = ceil(28/7) = 4.
      const matrix = buildMonthMatrix(2021, 1, { weekStart: 1 });
      expect(matrix).toHaveLength(4);
    });
  });

  describe('day values', () => {
    it('first in-month cell has day=1', () => {
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1 });
      const flat = matrix.flat();
      const first = flat.find((d) => d.inMonth);
      expect(first?.day).toBe(1);
    });

    it('last in-month cell has the correct day count for the month', () => {
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1 });
      const inMonth = matrix.flat().filter((d) => d.inMonth);
      expect(inMonth.at(-1)?.day).toBe(30);
    });

    it('fills leading padding with previous month days', () => {
      // March 2026: starts on Sunday. weekStart=1 → Sun is col 6.
      // startCol = (0+6)%7 = 6. First 6 cells are February days.
      const matrix = buildMonthMatrix(2026, 2, { weekStart: 1 });
      const leading = matrix[0].filter((d) => !d.inMonth);
      expect(leading.length).toBe(6);
      // They should be from February (month=1)
      expect(leading.every((d) => d.month === 1)).toBe(true);
      // And consecutive ending on the last day of February (28th in 2026)
      expect(leading.at(-1)?.day).toBe(28);
    });

    it('fills trailing padding with next month days', () => {
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1 });
      const trailing = matrix.flat().filter((d) => !d.inMonth && matrix.flat().indexOf(d) >= 30);
      // All trailing should be July (month=6)
      expect(trailing.every((d) => d.month === 6)).toBe(true);
      // First trailing day is July 1
      expect(trailing[0]?.day).toBe(1);
    });
  });

  describe('weekStart', () => {
    it('weekStart=1 puts Monday in column 0', () => {
      // June 1 2026 is a Monday. With weekStart=1, it should be col 0 of row 0.
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1 });
      expect(matrix[0][0].day).toBe(1);
      expect(matrix[0][0].inMonth).toBe(true);
    });

    it('weekStart=0 puts Sunday in column 0', () => {
      // June 1 2026 is a Monday. With weekStart=0, Mon is col 1 of row 0.
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 0 });
      // col 0 should be Sunday May 31 (prev month)
      expect(matrix[0][0].inMonth).toBe(false);
      expect(matrix[0][0].month).toBe(4); // May
      expect(matrix[0][1].day).toBe(1);   // June 1 in col 1
    });
  });

  describe('isToday', () => {
    it('marks the correct cell as today', () => {
      // Suppose today is June 16 2026.
      const todayMs = new Date(2026, 5, 16).getTime();
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1, todayMs });
      const todayCells = matrix.flat().filter((d) => d.isToday);
      expect(todayCells).toHaveLength(1);
      expect(todayCells[0].day).toBe(16);
      expect(todayCells[0].month).toBe(5);
      expect(todayCells[0].year).toBe(2026);
    });

    it('marks no cell as today when todayMs is not in this month and not in padding', () => {
      const todayMs = new Date(2025, 0, 15).getTime(); // Jan 2025, far from Jun 2026
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1, todayMs });
      expect(matrix.flat().some((d) => d.isToday)).toBe(false);
    });

    it('marks no cell when todayMs is omitted', () => {
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1 });
      expect(matrix.flat().some((d) => d.isToday)).toBe(false);
    });
  });

  describe('timestamps', () => {
    it('each cell has a valid timestamp for its date', () => {
      const matrix = buildMonthMatrix(2026, 5, { weekStart: 1 });
      for (const week of matrix) {
        for (const day of week) {
          const d = new Date(day.timestamp);
          expect(d.getFullYear()).toBe(day.year);
          expect(d.getMonth()).toBe(day.month);
          expect(d.getDate()).toBe(day.day);
        }
      }
    });
  });
});

// ── matrixDayKey ─────────────────────────────────────────────────────────────

describe('matrixDayKey', () => {
  it('returns YYYY-MM-DD format', () => {
    const day: MatrixDay = { day: 3, month: 5, year: 2026, timestamp: 0, inMonth: true, isToday: false };
    expect(matrixDayKey(day)).toBe('2026-06-03');
  });

  it('pads single-digit month and day', () => {
    const day: MatrixDay = { day: 9, month: 0, year: 2026, timestamp: 0, inMonth: true, isToday: false };
    expect(matrixDayKey(day)).toBe('2026-01-09');
  });
});

// ── bucketEventsByDay ─────────────────────────────────────────────────────────

describe('bucketEventsByDay', () => {
  function msFor(y: number, mo: number, d: number) {
    return new Date(y, mo, d).getTime();
  }

  it('buckets a single-day event on its start day', () => {
    const events = [{ id: 'a', start: msFor(2026, 5, 16) }];
    const bucket = bucketEventsByDay(events);
    expect(bucket.get('2026-06-16')).toEqual(events);
  });

  it('buckets a multi-day event on every day it spans', () => {
    const event = { id: 'a', start: msFor(2026, 5, 15), end: msFor(2026, 5, 17) };
    const bucket = bucketEventsByDay([event]);
    expect(bucket.get('2026-06-15')).toHaveLength(1);
    expect(bucket.get('2026-06-16')).toHaveLength(1);
    expect(bucket.get('2026-06-17')).toHaveLength(1);
    // Not on adjacent days
    expect(bucket.get('2026-06-14')).toBeUndefined();
    expect(bucket.get('2026-06-18')).toBeUndefined();
  });

  it('uses start as end when end is omitted', () => {
    const event = { id: 'a', start: msFor(2026, 5, 20) };
    const bucket = bucketEventsByDay([event]);
    expect(bucket.get('2026-06-20')).toHaveLength(1);
  });

  it('multiple events on the same day accumulate', () => {
    const events = [
      { id: 'a', start: msFor(2026, 5, 10) },
      { id: 'b', start: msFor(2026, 5, 10) },
    ];
    const bucket = bucketEventsByDay(events);
    expect(bucket.get('2026-06-10')).toHaveLength(2);
  });

  it('returns an empty map for no events', () => {
    expect(bucketEventsByDay([]).size).toBe(0);
  });
});
