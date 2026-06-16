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

##### Per-node keyring (E2EE invite nodes)

`access: 'invite'` + `enc: true` nodes (e.g. OctoDesk tickets) can instead use a **per-node keyring** at `spaces/{spaceId}/objects/n/{nodeId}/_keyring` (collection `nodekeyring`). The node's content key is wrapped to **only that node's participants** — never the space-wide keyring — so an isolated external requester reads/writes one ticket E2EE without ever holding the space key.

```ts
import {
  ensureNodeKeyringRecipient, // ensure-then-add (correct ordering)
  openNodeEncryptor,          // recipient opens to decrypt/seal
  addNodeKeyringRecipient,    // grant another participant (e.g. on ticket assignment)
} from '@drakkar.software/octospaces-sdk'

// Creator: mint the keyring and add the requester as a recipient, in order.
await ensureNodeKeyringRecipient(session, spaceId, nodeId, { subKem: requesterKemPub, userId: requesterId })

// Requester: open the keyring (via their cap client) and seal/unseal content.
const enc = await openNodeEncryptor(reqClient, reqKeys, spaceId, nodeId, [creatorEdPub])
```

> **Invariant:** call `ownerEnsureNodeKeyring` before `addNodeKeyringRecipient` (or just use `ensureNodeKeyringRecipient`). `nodeKeyringScope` is a single-collection, **read-only** cap — the requester reads the keyring to decrypt; only `space:member`s write it.

### Invite-only nodes

```ts
const link = await createNodeInviteLink(session, spaceId, nodeId)
// Recipient:
await joinNodeByLink(recipientSession, link)
```

For an `enc` invite node, pass `{ isolated: true }` to use the **per-node keyring** (E2EE
ticket model): the invitee is isolated to that single node and decrypts via the node's own
keyring — never the space-wide key. The bundle/token then also carries a read-only
`keyringCap`, and `getNodeAccess` / `buildNodeAccess` open the node keyring for
`access:'invite' + enc` nodes. A non-isolated `enc` invite keeps the legacy space-keyring
behaviour (back-compat).

```ts
// E2EE, isolated requester (e.g. an OctoDesk ticket):
const { link } = await createNodeInviteLink(session, spaceId, nodeId, name, { enc: true }, true, origin, { isolated: true })
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
