/**
 * WAL/CRDT document layer — generic wiring of `@drakkar.software/starfish-wal`'s
 * injected interfaces onto a Starfish stack (client + space keyring + device signer).
 *
 * Exposed via the `./wal` package subpath so apps that don't use WAL (e.g. OctoChat)
 * can exclude it from their bundle. `@drakkar.software/starfish-wal` is an optional
 * peer dependency — install it only in apps that import from `./wal`.
 *
 * A logical document (a page's blocks, a board's columns/tasks) is one
 * {@link WalDocument}: an append-only op-log at `documentKey` plus an optional
 * sibling `<documentKey>__snapshot`. Apps build their domain shape on top via
 * their own model layers.
 */
import { WalDocument } from '@drakkar.software/starfish-wal';
import type { ReaderPosture, WalEncryptor, WalSnapshotStore } from '@drakkar.software/starfish-wal';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { createWalTransport } from './transport.js';
import { createWalSnapshotStore } from './snapshot-store.js';
import { noopEncryptor, walEncryptorFromKeyring } from './encryptor.js';
import { walSignerFromKeys } from './signer.js';

export interface CreateWalDocumentOptions {
  client: StarfishClient;
  /** Bare storage key, e.g. `spaces/{spaceId}/objects/pages/{objectId}`. */
  documentKey: string;
  /** This device's Ed25519 keypair (same key the client cap signs with). */
  edPubHex: string;
  edPrivHex: string;
  /** Space keyring encryptor for a private space; omit/null for a public (plaintext) space. */
  encryptor?: Encryptor | null;
  /** Per-session replica disambiguator (default the WalDocument's "0"). */
  sessionNonce?: string;
  /** Configure the sibling snapshot doc (cold-start + compaction). Default true. */
  withSnapshots?: boolean;
  posture?: ReaderPosture;
}

/** Build a {@link WalDocument} fully wired to the live Starfish client. */
export function createWalDocument(opts: CreateWalDocumentOptions): WalDocument {
  const encryptor: WalEncryptor = opts.encryptor
    ? walEncryptorFromKeyring(opts.encryptor)
    : noopEncryptor;
  const snapshotStore: WalSnapshotStore | undefined =
    opts.withSnapshots === false ? undefined : createWalSnapshotStore(opts.client);
  return new WalDocument({
    documentKey: opts.documentKey,
    transport: createWalTransport(opts.client),
    signer: walSignerFromKeys(opts.edPubHex, opts.edPrivHex),
    encryptor,
    snapshotStore,
    sessionNonce: opts.sessionNonce,
    posture: opts.posture ?? 'trust-retain-tail',
  });
}

export {
  WalDocument,
  createWalTransport,
  createWalSnapshotStore,
  walEncryptorFromKeyring,
  walSignerFromKeys,
  noopEncryptor,
};
