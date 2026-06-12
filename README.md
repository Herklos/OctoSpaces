# octospaces

pnpm monorepo housing the shared spaces layer for Drakkar Software apps.

| Package | Version | Description |
|---|---|---|
| [`@drakkar.software/octospaces-sdk`](./packages/octospaces-sdk) | `0.1.0` | Headless spaces core — identity, sync, objects, registry |
| [`@drakkar.software/octospaces-ui`](./packages/octospaces-ui) | `0.1.0` | Shared UI primitives — theme plumbing only, no values |

## Architecture

Everything in a space is an **`ObjectNode`** — a typed, ordered, tree-able unit with an `id`, `type`, `subtype`, `parentId`, and `order`. Rooms, categories, docs, tasks are all objects discriminated by `type`. The SDK is domain-agnostic: no chat/page/board vocabulary in names, paths, or KV keys.

**Private and public spaces are unified on one path family.** Both live under `spaces/{spaceId}/**` with the same `OBJECT_COLLECTIONS` cap scopes. A public space has `visibility:'public'` in its `_rooms` access record; its object index is plaintext (no keyring, `encryptor: null`). The Starfish server never validates or decrypts content — auth is roster-based via the space-role enricher — so no server changes are required to host public spaces.

Sync is powered by the **Starfish** protocol (`@drakkar.software/starfish-*`, E2EE, cap-cert auth). The two apps (OctoChat and OctoVault) consume these packages as npm dependencies; the concrete theme values, env vars, and app-specific path extensions stay in each app.

```
octospaces/
├── packages/
│   ├── octospaces-sdk/          # headless core
│   │   └── src/
│   │       ├── core/            # config, types, ids, adapters, errors
│   │       ├── sync/            # identity, client, paths, encryptors, pairing, caps
│   │       ├── spaces/          # registry, members, object-index, pubspace
│   │       ├── objects/         # ObjectNode tree, reducers, legacy bridges
│   │       └── platform/        # kv / crypto split (.ts + .native.ts)
│   └── octospaces-ui/           # UI primitives
│       └── src/
│           └── theme/           # Palette/Theme types, provider, hook, helpers
├── tsconfig.base.json
├── pnpm-workspace.yaml
└── package.json
```

## Requirements

- Node ≥ 20
- pnpm ≥ 10

## Getting started

```sh
pnpm install
pnpm -r build       # build all packages
pnpm -r typecheck   # zero-error type check
pnpm -r test        # run all test suites
```

---

## `@drakkar.software/octospaces-sdk`

Headless, platform-agnostic spaces core. No React, no UI, no env reads.

### Setup

Call **once** at app boot, before any sync or identity API:

```ts
import { configureOctoSpaces } from '@drakkar.software/octospaces-sdk';

configureOctoSpaces({
  syncBase: process.env.EXPO_PUBLIC_STARFISH_URL,
  syncNamespace: process.env.EXPO_PUBLIC_STARFISH_NAMESPACE,
  // Optional: route space registry through a shared cross-app namespace
  sharedSpacesNamespace: process.env.EXPO_PUBLIC_STARFISH_SHARED_SPACES_NAMESPACE,
});
```

### Key APIs

#### Identity & session

```ts
import { buildSession, buildLinkedSession } from '@drakkar.software/octospaces-sdk';

// Build a session from a 24-word seed phrase
const session = await buildSession(seedWords, deviceLabel, kv);

// Link a new device to an existing account
const linked = await buildLinkedSession(pairingToken, deviceLabel, kv);
```

#### Spaces registry

```ts
import { createSpace, readSpaces, updateSpacesDoc } from '@drakkar.software/octospaces-sdk';

// Private (E2EE) space — default
const space = await createSpace(session, 'My Space');

// Public (plaintext) space — same path family, no keyring
const pub = await createSpace(session, 'Public Docs', { visibility: 'public' });

const spaces = await readSpaces(session.accountClient, session.userId);
```

#### Link-based joins (public spaces)

```ts
import { createSpaceInviteLink, joinSpaceByLink, decodeSpaceInviteLink } from '@drakkar.software/octospaces-sdk';

// Owner: create a shareable link
const { link } = await createSpaceInviteLink(session, spaceId, 'Public Docs', true, 'https://app.example.com');

// Guest: redeem the link
const token = decodeSpaceInviteLink(fragment);
const joined = await joinSpaceByLink(session, token);
```

#### Object tree

```ts
import { buildTree, addObject, patchObject, reparentObject } from '@drakkar.software/octospaces-sdk';
import type { ObjectNode } from '@drakkar.software/octospaces-sdk';

const tree = buildTree(nodes);              // repairs cycles/orphans, sorts siblings
const next = addObject(nodes, newNode);     // pure reducer
const moved = reparentObject(nodes, id, newParentId, afterSiblingId);
```

#### Platform split (native)

Import the platform adapter in your native entrypoint to swap in `react-native-quick-crypto`:

```ts
// index.native.ts
import '@drakkar.software/octospaces-sdk/platform';
// or:
import { configureStarfishPlatform } from '@drakkar.software/octospaces-sdk/platform';
configureStarfishPlatform();
```

### Peer dependencies

```
@drakkar.software/starfish-client        >=3.0.0-alpha.27
@drakkar.software/starfish-identities    >=3.0.0-alpha.27
@drakkar.software/starfish-keyring       >=3.0.0-alpha.27
@drakkar.software/starfish-protocol      >=3.0.0-alpha.27
@drakkar.software/starfish-sharing       >=3.0.0-alpha.27
```

---

## `@drakkar.software/octospaces-ui`

Shared React / React Native UI primitives. **Ships zero theme values.** The host app builds a concrete `Theme` object and injects it via `<OctoSpacesThemeProvider>`.

### Setup

```tsx
import { OctoSpacesThemeProvider } from '@drakkar.software/octospaces-ui';
import { resolvedTheme } from '@/theme'; // your app's theme

export default function App() {
  return (
    <OctoSpacesThemeProvider theme={resolvedTheme}>
      <RootNavigator />
    </OctoSpacesThemeProvider>
  );
}
```

### Reading the theme

```tsx
import { useOctoSpacesTheme } from '@drakkar.software/octospaces-ui';

function MyComponent() {
  const { colors, spacing, radii } = useOctoSpacesTheme();
  return <View style={{ backgroundColor: colors.surface, padding: spacing[4] }} />;
}
```

### Pure palette helpers

```ts
import {
  presenceColor, verificationColor, avatarTint,
  statusColor, swatch, paperBorder, glowShadow, focusRingStyle,
} from '@drakkar.software/octospaces-ui';

const color = presenceColor(colors, 'online');     // → colors.presenceOnline
const tint  = avatarTint(colors, userId);          // stable hash → palette key
const ring  = focusRingStyle(colors, 2);           // { borderWidth, borderColor, borderStyle }
```

### Theme contract

The `Theme` type your app must satisfy (all fields, values stay in the app):

```ts
interface Theme {
  scheme:  'light' | 'dark';
  colors:  Palette;       // see Palette interface — includes editorCanvas, tooltipBg, onTooltip
  spacing: Record<string, number>;
  radii:   { sm, md, lg, full: number };
  type:    Record<string, unknown>;
  fonts:   Record<string, unknown>;
  motion:  Record<string, unknown>;
  shadows: Record<string, unknown>;
  layout:  Record<string, unknown>;
  opacity: { disabled: number; [key: string]: number };
  swatches:      Record<string, string>;
  layers:        Record<string, number>;
  easing:        Record<string, number[]>;
  labelTracking: Record<string, unknown>;
}
```

### Peer dependencies

```
react          >=18
react-native   >=0.75
```

---

## Cross-app shared spaces

When `sharedSpacesNamespace` is set, `buildSession` creates two extra Starfish clients on the `Session` object:

| Client | Used for |
|---|---|
| `session.spacesRegistryClient` | Space registry reads/writes (uses shared namespace) |
| `session.spacesKeyringClient` | Space keyring ops (uses shared namespace) |

Without the namespace both fall back to the default clients — no behavior change for single-app deployments.

## License

Private — Drakkar Software. All rights reserved.
