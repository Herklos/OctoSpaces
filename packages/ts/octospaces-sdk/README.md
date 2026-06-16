# @drakkar.software/octospaces-sdk

Headless TypeScript SDK for the OctoSpaces platform — identity, E2EE, object trees, member management, and real-time sync.

## Installation

```bash
pnpm add @drakkar.software/octospaces-sdk
```

### Peer dependencies

```bash
pnpm add starfish-client starfish-identities starfish-keyring starfish-protocol starfish-sharing
```

## Overview

This SDK is platform-agnostic and ships no DOM, AsyncStorage, or localStorage references. Host apps inject a key-value store at startup; the SDK handles the rest.

```ts
import { configureOctoSpaces, configureKv } from '@drakkar.software/octospaces-sdk'

configureOctoSpaces({ syncBase: 'https://sync.example.com', syncNamespace: 'v1/my-app' })
configureKv({ get: kv.get, set: kv.set, remove: kv.remove })
```

## Core concepts

### Identity & session

A session is derived from a 12-word BIP-39 seed phrase. All device keys and identities are deterministic from the seed.

```ts
import { generateSeedWords, buildSession } from '@drakkar.software/octospaces-sdk'

const words = generateSeedWords()
const session = await buildSession({ seedWords: words, name: 'Alice' })
```

Pair a second device via a pairing link:

```ts
// On the primary device:
const { pairingLink } = await startDevicePairing(session)
// On the new device:
const linkedSession = await completeDevicePairing(pairingLink)
```

### Spaces

```ts
import { createSpace, readSpaces, inviteToSpace } from '@drakkar.software/octospaces-sdk'

const spaceId = await createSpace(session, { name: 'My Team', short: 'MT' })
const spaces = await readSpaces(session)
await inviteToSpace(session, spaceId, inviteeId)
```

Link-based invite (no prior contact needed):

```ts
const link = await createSpaceInviteLink(session, spaceId)
// Recipient:
await joinSpaceByLink(recipientSession, link)
```

### Object tree

Every space has a union-merged object tree. Nodes support three access levels and optional E2EE.

```ts
import { addObject, readObjectTree, buildTree, randomId } from '@drakkar.software/octospaces-sdk'

await addObject(session, spaceId, {
  id: randomId(),
  type: 'document',
  title: 'My Doc',
  access: 'space', // 'public' | 'space' | 'invite'
  enc: false,
})

const { root } = await readObjectTree(session, spaceId)
const tree = buildTree(root)
```

#### Access & encryption

Two independent axes per node:

| Axis | Values | Effect |
|------|--------|--------|
| `access` | `'public'` \| `'space'` \| `'invite'` | Who can fetch this node |
| `enc` | `true` \| `false` | Whether content is E2EE under the space keyring |

All `enc: true` nodes in a space share one content-encryption key — inviting someone to one encrypted node grants them access to all encrypted nodes in that space.

> `access: 'public'` and `enc: true` cannot be combined.

### Invite-only nodes

```ts
const link = await createNodeInviteLink(session, spaceId, nodeId)
// Recipient:
await joinNodeByLink(recipientSession, link)
```

### Sealed blobs & attachments

```ts
import { sealToSelf, unsealFromSelf, createAttachmentStore } from '@drakkar.software/octospaces-sdk'

const sealed = await sealToSelf(session, payload)
const plain = await unsealFromSelf(session, sealed)

const store = createAttachmentStore(session, spaceId)
const ref = await store.upload(file)
const bytes = await store.download(ref)
```

### Preferences

```ts
import { createMutesStore, createReadsStore } from '@drakkar.software/octospaces-sdk'

const mutes = createMutesStore(session)
await mutes.set(spaceId, 'all')

const reads = createReadsStore(session)
await reads.markRead(spaceId, nodeId)
```

### Live sync

```ts
import { subscribeChanges } from '@drakkar.software/octospaces-sdk'

subscribeChanges(session, spaceId, {
  onObjectsChange: (delta) => { /* re-render tree */ },
})
```

## Utilities

```ts
import { rankResults, relativeTime, formatBytes, initialsFor } from '@drakkar.software/octospaces-sdk'

const hits = rankResults(nodes, query)   // 4-tier fuzzy title ranking
const label = relativeTime(ts)           // "2 hours ago"
const initials = initialsFor('Alice B.') // "AB"
const size = formatBytes(1048576)        // "1 MB"
```

## ESM only

This package ships ESM only. Set `"type": "module"` in your `package.json` or use a bundler (Vite, tsup, Metro, etc.).

## Running tests

```bash
cd packages/ts/octospaces-sdk
../../node_modules/.bin/vitest run
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
