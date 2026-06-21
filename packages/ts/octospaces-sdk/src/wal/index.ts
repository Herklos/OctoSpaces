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
 *
 * The injected adapters (transport, snapshot store, encryptor, signer) are thin
 * wiring with no unit tests of their own, so they live inline here rather than in
 * separate one-function modules.
 */
import { WalDocument, createEd25519Signer, noopEncryptor } from '@drakkar.software/starfish-wal';
import type {
  ReaderPosture,
  WalAppendElement,
  WalEncryptor,
  WalSigner,
  WalSnapshotDoc,
  WalSnapshotStore,
  WalTransport,
} from '@drakkar.software/starfish-wal';
import { AppendLogCursor, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

// ── Transport ────────────────────────────────────────────────────────────────
//
// `WalTransport` over the live {@link StarfishClient}. The WAL document layer ships
// only the transport *interface* — the live adapter is the consumer's job.
//
//  - `append` → `StarfishClient.append(/push/<key>, data)`. The client auto-signs
//    the element with the cap's device key (the SAME Ed25519 key the WAL signer
//    uses), so the stored element's author proof is the one a reader verifies.
//  - `pull` → an {@link AppendLogCursor} seeded at `checkpoint`, returning the raw
//    elements (ciphertext `data` + `ts` + author fields). We do NOT decrypt or
//    verify here — `WalDocument` does both itself.
//
// `documentKey` is the bare storage key (e.g. `spaces/{spaceId}/objects/pages/{id}`);
// the client's `namespace` (empty in local dev) is prepended internally, so the key
// the client author-signs over matches the `documentKey` WAL verifies over.
function createWalTransport(client: StarfishClient): WalTransport {
  return {
    async append(documentKey, body) {
      const res = await client.append(`/push/${documentKey}`, body.data);
      return { ts: res.timestamp };
    },
    async pull(documentKey, checkpoint) {
      // A fresh stateless cursor per call: `since` makes the server return only
      // elements with `ts > checkpoint`, ascending — exactly the WAL contract.
      const cursor = new AppendLogCursor({
        client,
        pullPath: `/pull/${documentKey}`,
        since: checkpoint,
      });
      // A never-written object has no log doc yet — 404 is not an error, just an
      // empty starting state. Rethrow everything else (403, decrypt errors, etc.)
      const els = await cursor.pull().catch((e: unknown) => {
        if (e instanceof StarfishHttpError && e.status === 404) return [];
        throw e;
      });
      return els.map<WalAppendElement>((e) => ({
        ts: e.ts,
        data: e.data,
        authorPubkey: e.authorPubkey ?? '',
        authorSignature: e.authorSignature ?? '',
      }));
    },
  };
}

// ── Snapshot store ─────────────────────────────────────────────────────────────
//
// `WalSnapshotStore` over a regular LWW document at `<documentKey>__snapshot`. The
// snapshot is a normal (non-append) collection: we pull the current doc (caching its
// `hash` for the next conflict-checked push) and push the WAL-produced
// {@link WalSnapshotDoc} verbatim — it already carries its own `producedBy` + author
// signature for the reader to verify.
function createWalSnapshotStore(client: StarfishClient): WalSnapshotStore {
  const hashes = new Map<string, string | null>();
  return {
    async read(snapshotKey) {
      const res = await client.pull(`/pull/${snapshotKey}`).catch(() => null);
      hashes.set(snapshotKey, res?.hash ?? null);
      const data = res?.data as Partial<WalSnapshotDoc> | undefined;
      if (!data || typeof data.uptoTs !== 'number' || !data.state) return null;
      return data as WalSnapshotDoc;
    },
    async write(snapshotKey, doc) {
      // CAS push with retry: re-pull the current hash before each attempt so
      // concurrent writers don't permanently 409 each other. Snapshots are
      // infrequent so the extra round-trip(s) are cheap.
      const MAX_ATTEMPTS = 3;
      let lastErr: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let base = hashes.get(snapshotKey) ?? null;
        try {
          const cur = await client.pull(`/pull/${snapshotKey}`);
          base = cur.hash ?? null;
        } catch {
          /* use cached hash if the pull fails */
        }
        try {
          const res = await client.push(
            `/push/${snapshotKey}`,
            doc as unknown as Record<string, unknown>,
            base,
          );
          hashes.set(snapshotKey, res.hash ?? null);
          return; // success
        } catch (err) {
          lastErr = err;
          hashes.delete(snapshotKey); // force re-pull on next attempt
          if (!/conflict|stale|412|409/i.test(String(err))) throw err;
          // Conflict — another writer won; retry with fresh hash
        }
      }
      throw lastErr;
    },
  };
}

// ── Encryptor ────────────────────────────────────────────────────────────────
//
// Under `encryption: "delegated"` (private spaces) we back WAL's seal/open with the
// space keyring {@link Encryptor} (`{ encrypt, decrypt }` → `{ seal, open }`), so each
// op-batch and the snapshot `state` are sealed `{ _encrypted, _epoch }` exactly like
// every other space document. Under `encryption: "none"` (public spaces) we use the
// package's {@link noopEncryptor}.

/** Wrap a space keyring {@link Encryptor} as a {@link WalEncryptor}. */
function walEncryptorFromKeyring(enc: Encryptor): WalEncryptor {
  return {
    seal: (plain) => enc.encrypt(plain),
    open: (sealed) => enc.decrypt(sealed),
  };
}

// ── Signer ─────────────────────────────────────────────────────────────────────
//
// `WalSigner` from this device's Ed25519 keypair. {@link createEd25519Signer} reuses
// the protocol's `signAppendAuthor` / `signDocAuthor`, so the proof is byte-identical
// to what the server (and a reader's `verifyAppendAuthor`) checks. The key must be the
// same device key the StarfishClient cap signs requests with, so the client's
// auto-signed append and the WAL author proof agree.
function walSignerFromKeys(edPubHex: string, edPrivHex: string): WalSigner {
  return createEd25519Signer(edPubHex, edPrivHex);
}

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
