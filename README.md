<div align="center">
  <img src="./logo.png" alt="OctoSpaces" width="320" />

  <h1>OctoSpaces</h1>

  <p><strong>The shared spaces layer for Drakkar Software apps.</strong><br/>
  E2EE sync, unified public/private spaces, domain-agnostic objects — headless by design.</p>

  <p>
    <img alt="pnpm monorepo" src="https://img.shields.io/badge/pnpm-monorepo-f69220?logo=pnpm&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
    <img alt="Node ≥ 20" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/license-private-red" />
  </p>
</div>

---

## Packages

**TypeScript**

| Package | Version | Description |
|---|---|---|
| [`@drakkar.software/octospaces-sdk`](./packages/ts/octospaces-sdk) | `0.10.0` | Headless spaces core — identity, sync, objects, registry |
| [`@drakkar.software/octospaces-ui`](./packages/ts/octospaces-ui) | `0.4.3` | Shared UI primitives — sidebar, discover, lightbox, theme |

**Python**

| Package | Version | Description |
|---|---|---|
| [`octospaces-sdk`](./packages/python/octospaces-sdk) | `0.4.3` | Python port of the headless spaces core — see [PYTHON_SDK.md](./PYTHON_SDK.md) |

---

## Architecture

Everything in a space is an **`ObjectNode`** — a typed, ordered, tree-able unit with an `id`, `type`, `parentId`, and `order`. The SDK defines **no domain object types**: apps (OctoChat, OctoVault, …) declare their own `type` strings and descriptors in their own SDKs. The SDK ships only the generic tree engine (`buildTree`, `addObject`, `reparentObject`, …) and the spaces infrastructure (keyring, access record, index).

**Spaces are neutral containers.** The shared `octospaces` namespace holds a **minimal cross-app registry only**: `spaces`, `spaceregistry`, `spacekeyring`, `profile`, `devices`, `pairing`. Per-node content collections (`objindex`, `objpub`, `objinv`, `obj*`) live in each **app's own namespace** (OctoChat, OctoVault, …).

Visibility and encryption are **per-node** axes — not per-space: `ObjectNode.access` (`'public' | 'space' | 'invite'`) controls who can reach a node; `ObjectNode.enc` adds E2EE under the **space-wide keyring** at `spaces/{spaceId}/_keyring` (`spacekeyring` collection). All `enc` nodes in a space share one CEK — holding the space key and having reach means you can decrypt every `enc` node in the space (coarse-grained by design). The object index (`objindex` collection, app namespace) is always plaintext — invite nodes have their title/emoji stripped before storage. The [Starfish](https://github.com/Drakkar-Software/Starfish) server never validates or decrypts content — auth is roster-based + cap-scope gated.

Sync is powered by the **[Starfish](https://github.com/Drakkar-Software/Starfish)** protocol (`@drakkar.software/starfish-*`, E2EE, cap-cert auth). OctoChat and OctoVault consume these packages as npm dependencies; concrete theme values, env vars, and app-specific path extensions stay in each app.

```
octospaces/
├── packages/
│   ├── ts/
│   │   ├── octospaces-sdk/          # headless core (TypeScript)
│   │   │   └── src/
│   │   │       ├── core/            # config, types, ids, adapters, errors
│   │   │       ├── sync/            # identity, client, paths, encryptors, pairing, caps
│   │   │       ├── spaces/          # registry, members, nodes, object-index, directory
│   │   │       ├── objects/         # ObjectNode tree, reducers (generic — no domain types)
│   │   │       ├── prefs/           # mutes + read-marks stores
│   │   │       ├── format/          # formatting utilities
│   │   │       └── utils/           # search ranking, live-sync bus, invite preview
│   │   └── octospaces-ui/           # UI primitives
│   │       └── src/
│   │           ├── theme/           # Palette/Theme types, provider, hook, helpers
│   │           ├── sidebar/         # Sidebar, SidebarItem, SpacesRail, SpaceSwitcher
│   │           ├── discover/        # DiscoverScreen, DiscoverList, DiscoverRow
│   │           └── lightbox/        # Lightbox
│   └── python/
│       └── octospaces-sdk/          # Python port (uv / pytest — see PYTHON_SDK.md)
│           └── octospaces_sdk/      # mirrors packages/ts/octospaces-sdk/src/
├── tests/
│   └── test-vectors/                # shared JSON vectors (TS vitest + Python pytest)
├── tsconfig.base.json
├── pnpm-workspace.yaml
├── PYTHON_SDK.md
└── package.json
```

---

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

Headless, platform-agnostic spaces core. No React, no UI, no env reads. See the [full SDK README](./packages/ts/octospaces-sdk/README.md) for detailed API docs.

### Setup

Call **once** at app boot, before any sync or identity API:

```ts
import { configureOctoSpaces, configureKv } from '@drakkar.software/octospaces-sdk';

configureOctoSpaces({
  syncBase: process.env.EXPO_PUBLIC_STARFISH_URL,
  syncNamespace: process.env.EXPO_PUBLIC_STARFISH_NAMESPACE,
  // Optional: route space registry through a shared cross-app namespace
  sharedSpacesNamespace: process.env.EXPO_PUBLIC_STARFISH_SHARED_SPACES_NAMESPACE,
});
configureKv({ get: kv.get, set: kv.set, remove: kv.remove });
```

### Key APIs

#### Identity & session

```ts
import { generateSeedWords, buildSession, buildLinkedSession } from '@drakkar.software/octospaces-sdk';

// Generate a recovery seed and build a session
const words = generateSeedWords();
const session = await buildSession({ seedWords: words, name: 'Alice' });

// Link a new device to an existing account
const linked = await buildLinkedSession(pairingToken);
```

#### Spaces registry

```ts
import { createSpace, readSpaces, createNode } from '@drakkar.software/octospaces-sdk';

// Create a space (neutral container)
const spaceId = await createSpace(session, { name: 'My Space', short: 'MS' });

// Nodes carry access/enc independently
await createNode(session, spaceId, { type: 'page', title: 'Public Docs', access: 'public', enc: false });
await createNode(session, spaceId, { type: 'page', title: 'Private', access: 'invite', enc: true });

const spaces = await readSpaces(session);
```

#### Link-based joins

```ts
import { createSpaceInviteLink, joinSpaceByLink, decodeSpaceInviteLink } from '@drakkar.software/octospaces-sdk';

// Owner: create a shareable link
const link = await createSpaceInviteLink(session, spaceId);

// Guest: redeem the link
await joinSpaceByLink(recipientSession, link);
```

#### Object tree

```ts
import { buildTree, addObject, reparentObject, readObjectTree } from '@drakkar.software/octospaces-sdk';

const { root } = await readObjectTree(session, spaceId);
const tree   = buildTree(root);                              // repairs cycles/orphans, sorts siblings
const next   = addObject(nodes, newNode);                    // pure reducer
const moved  = reparentObject(nodes, id, newParentId, afterSiblingId);
```

### Peer dependencies

```
starfish-client        >=3.0.0-alpha.27
starfish-identities    >=3.0.0-alpha.27
starfish-keyring       >=3.0.0-alpha.27
starfish-protocol      >=3.0.0-alpha.27
starfish-sharing       >=3.0.0-alpha.27
```

---

## `@drakkar.software/octospaces-ui`

Shared React Native UI primitives. **Ships zero theme values.** The host app builds a concrete `Theme` object and injects it via `<OctoSpacesThemeProvider>`. See the [full UI README](./packages/ts/octospaces-ui/README.md) for component docs.

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
  const { theme } = useOctoSpacesTheme();
  return <View style={{ backgroundColor: theme.colors.palette.surface, padding: theme.spacing.md }} />;
}
```

### Pure palette helpers

```ts
import {
  presenceColor, verificationColor, avatarTint,
  statusColor, swatch, paperBorder, glowShadow, focusRingStyle,
} from '@drakkar.software/octospaces-ui';

const color = presenceColor(colors, 'online');  // → colors.presenceOnline
const tint  = avatarTint(colors, userId);       // stable hash → palette key
const ring  = focusRingStyle(colors, 2);        // { borderWidth, borderColor, borderStyle }
```

### Theme contract

The `Theme` type your app must satisfy (all fields, values stay in the app):

```ts
interface Theme {
  scheme:  'light' | 'dark';
  colors:  Palette;       // includes editorCanvas, tooltipBg, onTooltip
  spacing: Record<string, number>;
  radii:   { sm: number; md: number; lg: number; full: number };
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

| Client | Purpose |
|---|---|
| `session.spacesRegistryClient` | Space registry reads/writes (shared namespace) |
| `session.spacesKeyringClient` | Space keyring ops (shared namespace) |

Without the namespace both fall back to the default clients — no behavior change for single-app deployments.