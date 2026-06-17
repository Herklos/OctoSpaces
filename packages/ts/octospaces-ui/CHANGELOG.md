# Changelog — @drakkar.software/octospaces-ui

## 0.8.0 (2026-06-17)

### Added

- **`useTokens().type(key, fallback?)` typography accessor.** Resolves `theme.type[key]`
  to a complete `{ size, lineHeight, weight, letterSpacing? }` with per-field canonical
  fallbacks — a single source of truth for typography, analogous to the existing
  `sp`/`rad`/`lay`/`opa` numeric-token accessors. Exposed alongside the new
  `ResolvedTypeScale` type.

- **`RailSpace.name` (optional).** The full space name, used for a tile's
  `accessibilityLabel` (falling back to `short`). Previously the rail announced only the
  2-letter monogram to screen readers.

### Fixes

- **Typography fallback drift eliminated.** The `body` size was hardcoded as `14` in
  `MonthGrid` but `15` everywhere else, and `body` lineHeight as `20` vs `22`. All
  `theme.type[...]?.size ?? n` call sites (DiscoverScreen, DiscoverList, DiscoverRow,
  MonthGrid, SpaceSwitcher heading) now route through `useTokens().type()`, so the
  canonical `body = { size: 15, lineHeight: 22 }` applies consistently.

- **`DiscoverScreen`: search filtering is memoized.** `filterDiscoverEntries(allEntries,
  query)` ran on every render (per-keystroke full re-filter); it is now wrapped in
  `useMemo` keyed on `[allEntries, query]`, with a stable empty-array reference for the
  non-ready states.

### Internal — sidebar deduplication

- **`HoverablePressable`** — the web-hover `Pressable` re-cast that was copy-pasted in
  `SpacesRail`, `SidebarItem`, `SidebarActionButton`, and `SpaceSwitcher` is now a single
  shared module (`primitives/hoverable-pressable.ts`).
- **`interactionBg()`** — the `pressed ? … : hovered ? … : transparent` background ladder
  (duplicated across 5 sidebar/menu surfaces with drifting rgba fallbacks: hover 0.04-vs-0.05,
  pressed 0.08-vs-0.10) is centralised in `sidebar/interaction-bg.ts` with canonical
  fallbacks (pressed `rgba(0,0,0,0.08)`, hover `rgba(0,0,0,0.05)`). Host theme colors still
  take precedence, so themed apps are visually unchanged; only the no-theme fallback is normalised.
- **`CornerBadge`** — the bottom-corner lock/mute overlay `View` (3× in `SpacesRail`) is now
  one internal component parameterised by `side`.
- **`MenuRow`** — `SpaceRow` and `ActionRow` in `SpaceSwitcher` now share one row shell
  (Pressable + label layout); each supplies only its leading/trailing slots and label styling.

### Tests — React Native render harness

- Added a `react-native-web` + jsdom render harness as a second vitest project (`components`,
  matching `*.test.tsx`); pure-logic suites stay in the fast `logic` (node) project. New
  render suites: `Badge`, `SpacesRail` (accessibility label sourcing), `SpaceSwitcher`
  (dropdown rows). New unit suites: `useTokens().type()`, `interactionBg()`. 182 tests total.

## 0.7.1

### Fixes

- **`Radii` type narrowed to `Record<string, number>`.** The previous `number | string`
  union allowed string values like `'8px'` which React Native rejects at render time.
  Host apps must supply numeric pixel values only (they already did in practice).

- **`SpacesRail`: `tokens` now memoized.** `resolveRailTokens(theme)` returned a new object
  reference on every render, causing `tileShared` to always invalidate and `React.memo` on
  `PlainTile`, `DndTile`, and `SpecialTile` to be a no-op. Now memoized on `theme`.

- **`DiscoverScreen`: `reloadRef` wired via `useEffect` instead of `useImperativeHandle`.**
  `useImperativeHandle` is designed for `forwardRef`-forwarded refs; using it with a plain
  prop `RefObject` caused `readonly` TypeScript errors on strict configs. The behaviour is
  identical at runtime.

## 0.7.0

### BREAKING — generic `specialTiles` API replaces DM-specific rail props

**`SpacesRail`:** the DM-specific props `onSelectDms`, `dmsActive`, `dmUnread`, and
`dmLabel` have been **removed**. They are replaced by a generic
`specialTiles?: RailSpecialTile[]` prop that covers any pinned non-space tile (Notes,
DMs, Inbox, …). Each `RailSpecialTile` carries `key`, `icon`, `onPress`, `active?`,
`unread?`, and `label?`.

**Migration** (e.g. OctoChat):
```diff
- onSelectDms={openDms}
- dmsActive={isDmHome}
- dmUnread={dmUnread}
- dmLabel={DM_HOME_NAME}
+ specialTiles={[{
+   key: 'dm', icon: 'dm',
+   active: isDmHome, unread: dmUnread,
+   label: DM_HOME_NAME,
+   onPress: openDms,
+ }]}
```

**`RailIconName`:** `'notes'` added. The `'dm'` value is retained so DM tiles can still
be rendered via the new `specialTiles` API.

**`RailSpecialTile`** type exported from the package.

---

## 0.6.0

### New `calendar/` module — `MonthGrid`, `buildMonthMatrix`, `bucketEventsByDay`, `matrixDayKey`

Adds pure date-math helpers and a headless themed month calendar grid for building
editorial-style calendar surfaces in host apps.

#### Pure helpers (`month-matrix.ts`)

- **`buildMonthMatrix(year, month, opts?)`** — builds a `MonthMatrix` (4–6 rows × 7
  columns of `MatrixDay`) for the given month. Each `MatrixDay` carries its year/month/
  day values, a local-midnight `timestamp`, an `inMonth` flag (false for leading/trailing
  padding days), and an `isToday` flag (compared against `opts.todayMs`). `opts.weekStart`
  selects Monday (default, `1`) or Sunday (`0`) column ordering.
- **`bucketEventsByDay(events)`** — given any array of `{ start: number, end?: number }`
  objects, returns a `Map<string, T[]>` keyed by `YYYY-MM-DD`. Multi-day events appear in
  every day's bucket they span.
- **`matrixDayKey(day)`** — converts a `MatrixDay` to its `YYYY-MM-DD` bucket key, for use
  with `bucketEventsByDay` results.

All three functions are pure (no RN imports, no `Date.now()` calls) and fully covered by
vitest unit tests.

#### `MonthGrid` component

A headless themed month grid that reads only the injected `Theme` via
`useOctoSpacesTheme()`:

```tsx
import { MonthGrid, bucketEventsByDay, matrixDayKey } from '@drakkar.software/octospaces-ui';

// In the host app:
const bucket = useMemo(() => bucketEventsByDay(events), [events]);

<MonthGrid
  year={2026}
  month={5}         // June
  weekStart={1}     // Monday (default)
  todayTimestamp={Date.now()}
  onDayPress={(day) => openDay(day)}
  renderDayEvents={(day) => {
    const dayEvents = bucket.get(matrixDayKey(day)) ?? [];
    return dayEvents.map(e => <EventDot key={e.id} color={e.color} />);
  }}
/>
```

Visual conventions (all sourced from the injected Theme):
- Weekday labels: `fonts.mono` — uppercase, `labelTracking.mono` letter-spacing.
- Day numerals: `fonts.heading` — the host's serif face for an editorial feel.
- Today: `colors.primary` filled disc, `colors.textOnPrimary` numeral.
- Out-of-month padding: `colors.textDisabled`.
- Row hairlines: `StyleSheet.hairlineWidth` in `colors.borderSubtle`.

### New `dropShadow` helper

**`dropShadow(shadowColor, size?)`** — builds a scheme-aware drop-shadow `ShadowToken`.
Pass the active palette's `shadow` color so the tint stays correct in both light and dark
modes. Size is `'sm' | 'md' | 'lg'` (default `'md'`), mirroring standard elevation presets.

```ts
import { dropShadow } from '@drakkar.software/octospaces-ui';

// In a component:
const { colors } = useOctoSpacesTheme();
// …
style={[styles.card, dropShadow(colors.shadow, 'md')]}
```

Replaces the pattern of using static shadow constants (which bake in the light-scheme
tint) by accepting the active-palette `shadow` color at the call site.

---

## 0.5.0

### New `primitives/` family — `Divider`, `Badge`, `Toggle`, `ToggleRow`

Adds a new family of headless UI building blocks that depend only on React Native
core (no Expo packages, no icon library). All four components read their visual
properties from the host app's injected `Theme` via `useOctoSpacesTheme()`, so they
adapt to any host app's palette without configuration.

#### `Divider`

A one-pixel horizontal rule.

```tsx
<Divider />                       // borderSubtle (default)
<Divider tone="default" />        // border
<Divider tone="strong" />         // borderStrong
<Divider color="#hex" />          // explicit override
```

`tone` selects from the three Theme border tiers (`borderSubtle` / `border` /
`borderStrong`). An explicit `color` prop wins over `tone`.

#### `Badge`

A count disc or dot indicator.

```tsx
<Badge count={3} />               // accent pill: "3"
<Badge count={0} dot />           // dot-only (shows even when count = 0)
<Badge count={99} clamp />        // "99+" when count > 99 (default)
<Badge count={2} tone="danger" /> // danger-colored pill
<Badge count={5} tone="neutral" />// muted neutral pill
```

Props: `count`, `dot`, `clamp` (default `true`), `tone` (`'accent' | 'danger' | 'neutral'`,
default `'accent'`), `size` (`'sm' | 'md'`, default `'sm'`).

#### `Toggle`

Wraps the platform `Switch` with the Theme's `primary` accent track color.

```tsx
<Toggle value={on} onValueChange={setOn} accessibilityLabel="Enable X" />
```

Props: `value`, `onValueChange`, `disabled`, `accessibilityLabel`.

#### `ToggleRow`

A settings row (label + optional detail) with a trailing `Toggle`. Headless:
the leading icon is injected as a `ReactNode` so the host supplies its own icon.

```tsx
<ToggleRow
  icon={<MyIcon name="bell" size={18} />}
  label="Notifications"
  detail="Push and in-app"
  value={enabled}
  onValueChange={setEnabled}
/>
```

Props: `icon?`, `label`, `detail?`, `value`, `onValueChange`, `disabled`.

---

---

## 0.4.5

### Added

- **Optional palette interaction tokens.** Added optional `pressed?`, `selected?`,
  `selectedHover?`, `disabledFill?`, and `focusRing?` fields to the `Palette` type
  (all `string | undefined`). Existing consumers that do not supply these fields are
  unaffected (the fields are optional and no built-in component reads them — they are
  reserved for host apps that use the `focusRingStyle` helper or build their own
  interaction-state components).

### Changed

- **`SpacesRail` memoization improvements.** `tileShared` is now wrapped in `useMemo`;
  `TileContent`, `PlainTile`, and `DndTile` sub-components are wrapped in `React.memo`
  to prevent re-renders when unrelated rail state changes (e.g. DM hover state).

### Fixed

- **Stale `@drakkar.software/octochat-sdk` reference** in `sidebar/types.ts` comment
  updated to `@drakkar.software/octospaces-sdk`.
- Removed stray no-op `eslint-disable-next-line @typescript-eslint/no-explicit-any`
  comment above `DndTileProps` interface in `SpacesRail.tsx`.

---

## 0.4.4

### `SpaceSwitcher` — `emptyLabel` prop

Added an optional `emptyLabel?: string` prop to `SpaceSwitcher` (default `'Spaces'`).

When the user has no active space (i.e. `spaces` is empty and `activeId` matches
nothing), the trigger button now shows `emptyLabel` instead of the hardcoded
`'Spaces'` fallback. The `accessibilityLabel` is also derived from `emptyLabel` in
this state.

Fully backward-compatible — existing consumers that do not pass `emptyLabel` retain
identical behaviour (the `'Spaces'` fallback is unchanged).

Typical use: `emptyLabel="Create a space"` to turn the switcher into an entry point
for the join/create flow when the user hasn't joined a space yet.

---

## 0.4.2

### `SpaceSwitcher` — `onTriggerPress` override

Added an optional `onTriggerPress?: () => void` prop to `SpaceSwitcher`.

When provided:
- The trigger button's `onPress` calls `onTriggerPress` instead of opening the
  built-in dropdown.
- The chevron icon is hidden (the button no longer implies a picker).
- The `renderContainer` callback is never invoked.

Use this on surfaces where a dropdown is redundant (e.g. a desktop sidebar that
already has a rail for space switching) and a single tap to navigate to the
space-details page is the right UX.

Fully backward-compatible — existing consumers that do not pass `onTriggerPress`
retain identical behaviour.

---

## 0.4.1

- `Lightbox` component added (headless fullscreen media viewer + zoom).

## 0.4.0

- `Sidebar`, `SidebarHeader`, `SidebarActionButton`, `SidebarItem` — shared
  desktop sidebar panel shell and primitives.
- `SpaceSwitcher` — headless space picker trigger with `renderContainer` delegation.
- `sidebarPanel` added to `Palette` type (panel background distinct from rail
  background `sidebar`).
