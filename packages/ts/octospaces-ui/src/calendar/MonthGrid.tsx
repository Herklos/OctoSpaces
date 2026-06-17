/**
 * Headless month calendar grid.
 *
 * Reads only the injected Theme via `useOctoSpacesTheme()`. No icons,
 * images, or event data are bundled — everything is delegated to the host
 * app through render-props, keeping this component free of any app-specific
 * dependencies (expo-image, @expo/vector-icons, reanimated, etc.).
 *
 * Visual identity (applied through the Theme):
 * - Weekday row: `fonts.mono` in uppercase with `labelTracking.mono` tracking.
 * - Day numerals: `fonts.heading` (expected to be the host app's serif face).
 * - Today disc: `colors.primary` fill, `colors.textOnPrimary` numeral.
 * - Leading/trailing padding days: `colors.textDisabled`.
 * - Grid lines: `StyleSheet.hairlineWidth` in `colors.borderSubtle`.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useOctoSpacesTheme } from '../theme/provider.js';
import { useTokens } from '../theme/tokens.js';
import { buildMonthMatrix, type MatrixDay } from './month-matrix.js';

const WEEKDAY_LABELS_MON = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const WEEKDAY_LABELS_SUN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Diameter of the "today" filled disc behind the day numeral. */
const TODAY_DISC = 28;

export interface MonthGridProps {
  /** Full year (e.g. 2026). */
  year: number;
  /** JavaScript month index, 0–11. */
  month: number;
  /**
   * Which weekday opens each column.
   * `0` = Sunday (US), `1` = Monday (EU/editorial, default).
   */
  weekStart?: 0 | 1;
  /**
   * Unix milliseconds representing "today". Used to highlight the matching day
   * with the `primary`-filled disc. Defaults to `Date.now()` at render time;
   * pass explicitly for deterministic snapshot tests.
   */
  todayTimestamp?: number;
  /** Called when the user taps a day cell. Receives the {@link MatrixDay} data. */
  onDayPress?: (day: MatrixDay) => void;
  /**
   * Optional content rendered below the day numeral inside each cell.
   * Use this to show event chips, dots, or other day-specific UI.
   *
   * ```tsx
   * renderDayEvents={(day) => {
   *   const events = bucket.get(matrixDayKey(day)) ?? [];
   *   return events.map(e => <EventDot key={e.id} color={e.color} />);
   * }}
   * ```
   */
  renderDayEvents?: (day: MatrixDay) => React.ReactNode;
}

/**
 * A themed month calendar grid that renders a 4–6 row × 7 column layout
 * for the given year/month. Inject event content and day-press handling
 * via props; the component handles only layout and theming.
 */
export function MonthGrid({
  year,
  month,
  weekStart = 1,
  todayTimestamp,
  onDayPress,
  renderDayEvents,
}: MonthGridProps) {
  const theme = useOctoSpacesTheme();
  const t = useTokens();
  const { colors } = theme;

  const todayMs = todayTimestamp ?? Date.now();
  const matrix = buildMonthMatrix(year, month, { weekStart, todayMs });
  const weekdayLabels = weekStart === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;

  // Font / scale values from the injected Theme — fall back to sensible defaults
  // so the component renders even if the host hasn't set every key.
  const monoFont: string | undefined = theme.fonts['mono'] ?? theme.fonts['body'];
  const serifFont: string | undefined = theme.fonts['heading'] ?? theme.fonts['display'] ?? theme.fonts['body'];
  const microSize: number = t.type('micro').size;
  const microLineHeight: number = t.type('micro').lineHeight;
  const bodySize: number = t.type('body').size;
  const bodyLineHeight: number = t.type('body').lineHeight;
  const labelSpacing: number = theme.labelTracking['mono'] ?? 0.8;

  return (
    <View>
      {/* ── Weekday header row ─────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        {weekdayLabels.map((label) => (
          <View key={label} style={styles.headerCell}>
            <Text
              style={{
                fontFamily: monoFont,
                fontSize: microSize,
                lineHeight: microLineHeight,
                letterSpacing: labelSpacing,
                // textTransform is not universally supported in all RN targets;
                // labels are already uppercase constants so no transform needed.
                color: colors.textTertiary,
                textAlign: 'center',
              }}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Week rows ─────────────────────────────────────────────────── */}
      {matrix.map((week, wi) => (
        <View
          key={wi}
          style={[
            styles.weekRow,
            {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.borderSubtle,
            },
          ]}
        >
          {week.map((day, di) => {
            const isToday = day.isToday;
            const numeralColor = isToday
              ? colors.textOnPrimary
              : day.inMonth
              ? colors.text
              : colors.textDisabled;

            return (
              <Pressable
                key={`${wi}-${di}`}
                style={({ pressed }) => [styles.dayCell, pressed && styles.dayCellPressed]}
                onPress={() => onDayPress?.(day)}
                accessibilityRole="button"
                accessibilityLabel={`${day.year}-${String(day.month + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`}
              >
                {/* ── Numeral ── */}
                <View style={styles.numeralRow}>
                  <View
                    style={[
                      styles.numeralDisc,
                      isToday && { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={{
                        fontFamily: serifFont,
                        fontSize: bodySize,
                        lineHeight: bodyLineHeight,
                        color: numeralColor,
                        textAlign: 'center',
                        includeFontPadding: false,
                      } as object}
                    >
                      {day.day}
                    </Text>
                  </View>
                </View>

                {/* ── Events slot ── */}
                {renderDayEvents ? (
                  <View style={styles.eventsSlot}>{renderDayEvents(day)}</View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    paddingBottom: 6,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    minHeight: 52,
    paddingBottom: 4,
  },
  dayCellPressed: {
    opacity: 0.55,
  },
  numeralRow: {
    alignItems: 'flex-end',
    paddingRight: 4,
    paddingTop: 4,
  },
  numeralDisc: {
    width: TODAY_DISC,
    height: TODAY_DISC,
    borderRadius: TODAY_DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventsSlot: {
    paddingHorizontal: 3,
    paddingTop: 2,
    gap: 2,
  },
});
