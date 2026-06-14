# Changelog — @drakkar.software/octospaces-ui

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
