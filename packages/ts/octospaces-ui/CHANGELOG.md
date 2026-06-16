# Changelog — @drakkar.software/octospaces-ui

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

### `Palette` optional interaction fields (0.4.5)

> Released as `0.4.5` — listed here for completeness.

Added optional `pressed?`, `selected?`, `selectedHover?`, `disabledFill?`, and
`focusRing?` fields to the `Palette` type (all `string | undefined`). Existing
consumers that do not supply these fields are unaffected (the fields are optional
and no built-in component reads them — they are provided for host apps that use the
`focusRingStyle` helper or build their own interaction-state components).

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
