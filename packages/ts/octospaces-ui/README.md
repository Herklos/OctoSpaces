# @drakkar.software/octospaces-ui

Headless React Native UI primitives for OctoSpaces apps — sidebar, discover, and lightbox components with full theme injection.

## Installation

```bash
pnpm add @drakkar.software/octospaces-ui
```

### Peer dependencies

```bash
pnpm add react react-native
```

## Philosophy

- **No theme values shipped.** All colors, spacing, and typography come from the host app via `OctoSpacesThemeProvider`.
- **Headless components.** Icons, images, avatars, and buttons are injected as render-props — no dependency on `@expo/vector-icons`, `expo-image`, or animation libraries.
- **Cross-platform.** Built on React Native primitives; works on iOS, Android, and web via React Native Web.

## Setup

Wrap your app root with `OctoSpacesThemeProvider`:

```tsx
import { OctoSpacesThemeProvider } from '@drakkar.software/octospaces-ui'
import { theme } from './theme'

export default function App() {
  return (
    <OctoSpacesThemeProvider theme={theme}>
      <YourApp />
    </OctoSpacesThemeProvider>
  )
}
```

Access the theme anywhere in the tree:

```tsx
import { useOctoSpacesTheme } from '@drakkar.software/octospaces-ui'

const { theme } = useOctoSpacesTheme()
```

## Components

### Sidebar

A 240px desktop panel with optional header/footer slots and a scrollable body.

```tsx
import { Sidebar, SidebarHeader, SidebarItem, SidebarActionButton } from '@drakkar.software/octospaces-ui'

<Sidebar
  header={
    <SidebarHeader
      leading={<SpaceTitle />}
      actions={[<SidebarActionButton onPress={openSearch} renderIcon={() => <SearchIcon />} />]}
    />
  }
  footer={<AccountWidget />}
>
  <SidebarItem
    label="General"
    active={true}
    renderIcon={() => <HashIcon />}
    onPress={() => navigate('general')}
  />
</Sidebar>
```

### SpacesRail

A 64px-wide vertical rail of space tiles with an optional DM-home tile and an "add space" tile.

```tsx
import { SpacesRail } from '@drakkar.software/octospaces-ui'

<SpacesRail
  spaces={spaces}
  activeSpaceId={currentSpaceId}
  onSpacePress={(id) => switchSpace(id)}
  onAddSpacePress={openSpaceCreation}
  renderTileImage={(space) => <Image uri={space.image} />}
  renderBadge={(space) => space.unread ? <Badge count={space.unread} /> : null}
  // Optional drag-and-drop — inject a hook per tile:
  useTileDnd={(spaceId) => dndHooks[spaceId]}
/>
```

### SpaceSwitcher

A trigger button + dropdown for switching between spaces.

```tsx
import { SpaceSwitcher } from '@drakkar.software/octospaces-ui'

<SpaceSwitcher
  spaces={spaces}
  activeSpace={currentSpace}
  onSpaceSelect={(id) => switchSpace(id)}
  onCreateSpace={openSpaceCreation}
  renderIcon={(name) => <Icon name={name} />}
/>
```

### DiscoverScreen

Full-screen public object browser with search, load state, and error retry.

```tsx
import { DiscoverScreen, filterDiscoverEntries } from '@drakkar.software/octospaces-ui'

<DiscoverScreen
  entries={entries}
  loading={isLoading}
  error={error}
  onOpen={(entry) => navigate(entry.id)}
  onRetry={reload}
  renderIcon={(entry) => <Emoji value={entry.emoji} />}
/>
```

Entries can also be filtered and sorted manually:

```ts
import { filterDiscoverEntries, sortDiscoverEntries } from '@drakkar.software/octospaces-ui'

const filtered = filterDiscoverEntries(entries, query)
const sorted = sortDiscoverEntries(filtered) // by updatedAt desc
```

### Lightbox

Full-screen media overlay. Dismissed by backdrop tap, close button, hardware back (Android), or Escape (web).

```tsx
import { Lightbox } from '@drakkar.software/octospaces-ui'

<Lightbox
  visible={isOpen}
  onClose={() => setIsOpen(false)}
  renderCloseButton={(onClose) => <CloseButton onPress={onClose} />}
  renderActions={() => <ShareButton />}
>
  <Image source={media} style={{ width: '100%', height: '100%' }} />
</Lightbox>
```

## Theme contract

The `Theme` type defines all values the host app must provide. No defaults are included.

| Category | Field | Description |
|----------|-------|-------------|
| Colors | `colors.palette` | 45+ semantic color tokens |
| Spacing | `spacing` | Numeric scale (px values) |
| Typography | `type` | Per-variant: size, lineHeight, weight, letterSpacing |
| Borders | `radii` | Border-radius values |
| Fonts | `fonts` | Font-family strings |
| Motion | `motion`, `easing` | Duration + easing curve pairs |
| Shadows | `shadows` | Elevation + glow definitions |
| Layout | `layout` | sidebarWidth, railWidth, nav heights |
| Opacity | `opacity` | Numeric scale |
| Swatches | `swatches` | Named accent colors (railTile, railGlow, …) |
| Z-index | `layers` | Stacking order constants |

## Palette helpers

Pure functions that derive colors from a resolved palette:

```ts
import {
  avatarTint, presenceColor, verificationColor,
  statusColor, focusRingStyle, glowShadow, paperBorder,
} from '@drakkar.software/octospaces-ui'

const tint = avatarTint(theme.colors.palette, userId)  // stable hash-based color
const ring = focusRingStyle(theme.colors.palette, 2)
const glow = glowShadow(accentColor, 12, 0.4)
```

## ESM only

This package ships ESM only. Requires a bundler (Metro, Vite, etc.) and React ≥ 18, React Native ≥ 0.75.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
