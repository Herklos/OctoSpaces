/**
 * Per-node keyring helpers — the E2EE primitive behind invite-node encryption
 * (e.g. OctoDesk tickets). Each `invite+enc` node carries its OWN keyring at
 * `spaces/{spaceId}/objects/n/{nodeId}/_keyring` (collection `nodekeyring`), whose
 * CEK is wrapped ONLY to that node's participants — not the space-wide keyring. An
 * external requester can therefore read/write their ticket E2EE without ever
 * holding the space key.
 *
 * These are thin wrappers over the path-generic helpers in `client.ts`
 * (`ownerEnsureKeyring`/`openEncryptor`/`buildEncryptor`) and the collection-scoped
 * `addCollectionRecipient` from `starfish-keyring`, specialised to the node keyring
 * path so call sites can't accidentally target the space keyring.
 *
 * INVARIANT (mirrors the space keyring rule): `ownerEnsureNodeKeyring` MUST run
 * before `addNodeKeyringRecipient`. Use `ensureNodeKeyringRecipient` to get both in
 * the correct order.
 */
import { addCollectionRecipient, removeRecipient, listRecipients } from '@drakkar.software/starfish-keyring';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { buildRevocationList } from '@drakkar.software/starfish-protocol';
import type { RevocationList, RevokedSubject } from '@drakkar.software/starfish-protocol';

import { openEncryptor, buildEncryptor, ownerEnsureKeyring, isAlreadyPresentRecipient } from './client.js';
import type { DeviceKeys } from './client.js';
import { ownerTrustedAdders } from './identity.js';
import type { Session } from './identity.js';
import { nodeKeyringName, nodeKeyringPull, nodeKeyringPush } from './paths.js';
import { getSyncBase, getSyncPrefix } from '../core/config.js';
import { fetchWithTimeout } from './fetch-timeout.js';

/** A keyring recipient, referenced by their X25519 KEM pubkey (hex). */
export interface NodeKeyringRecipient {
  subKem: string;
  userId?: string;
  label?: string;
}

// Use the shared isAlreadyPresentRecipient from client.ts (same regex, single source of truth).

/**
 * Owner/creator side: create the node's keyring if missing, return an encryptor.
 * Delegates to the generic `ownerEnsureKeyring` with the NODE keyring paths.
 */
export function ownerEnsureNodeKeyring(
  session: Session,
  spaceId: string,
  nodeId: string,
  trustedAdders: string[] = ownerTrustedAdders(session),
): Promise<Encryptor> {
  return ownerEnsureKeyring(
    session.chatClient,
    session.keys,
    nodeKeyringPull(spaceId, nodeId),
    nodeKeyringPush(spaceId, nodeId),
    trustedAdders,
  );
}

/**
 * Open the node keyring as a recipient (hard — throws SpaceAccessError when the
 * keyring is missing or the caller is not a recipient). `client` is whatever client
 * carries read access to the node keyring (a requester's cap client, or
 * `session.chatClient` for a space member).
 */
export function openNodeEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  nodeId: string,
  trustedAdders: string[],
): Promise<Encryptor> {
  return openEncryptor(client, keys, nodeKeyringPull(spaceId, nodeId), trustedAdders);
}

/** Soft variant of {@link openNodeEncryptor}: resolves null instead of throwing. */
export function buildNodeEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  spaceId: string,
  nodeId: string,
  trustedAdders: string[],
): Promise<Encryptor | null> {
  return buildEncryptor(client, keys, nodeKeyringPull(spaceId, nodeId), trustedAdders);
}

/**
 * Add a recipient (requester / assigned agent / bot) to the node keyring. The
 * keyring MUST already exist (call {@link ownerEnsureNodeKeyring} first, or use
 * {@link ensureNodeKeyringRecipient}). "Already present" is swallowed so re-inviting
 * the same KEM is idempotent; every other error propagates.
 */
export async function addNodeKeyringRecipient(
  session: Session,
  spaceId: string,
  nodeId: string,
  recipient: NodeKeyringRecipient,
  opts: { trustedAdders?: string[] } = {},
): Promise<void> {
  try {
    await addCollectionRecipient(
      session.chatClient,
      nodeKeyringName(spaceId, nodeId),
      recipient,
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: opts.trustedAdders ?? ownerTrustedAdders(session) },
    );
  } catch (e) {
    if (isAlreadyPresentRecipient(e)) return;
    throw e;
  }
}

/**
 * Ensure the node keyring exists, then add a recipient — in that order (the keyring
 * invariant). Returns the owner's encryptor so the creator can immediately seal.
 */
export async function ensureNodeKeyringRecipient(
  session: Session,
  spaceId: string,
  nodeId: string,
  recipient: NodeKeyringRecipient,
  opts: { trustedAdders?: string[] } = {},
): Promise<Encryptor> {
  const enc = await ownerEnsureNodeKeyring(session, spaceId, nodeId, opts.trustedAdders);
  await addNodeKeyringRecipient(session, spaceId, nodeId, recipient, opts);
  return enc;
}

/** One recipient of a node keyring, projected for listing (provenance-filtered). */
export interface ListedNodeRecipient {
  subKem: string;
  addedBy: string;
  addedAt: number;
}

/**
 * REVOKE one or more recipients from a node keyring: rotates to a NEW epoch, mints a fresh
 * CEK, and re-wraps it ONLY to the retained recipients — so a removed party (e.g. an
 * unassigned agent) loses access to FUTURE messages (already-seen messages remain readable;
 * forward secrecy only). Returns the new epoch number.
 *
 * Only entries whose `addedBy` is a trusted adder are retained on rotation, so pass the
 * key(s) that granted the recipients you want to keep (defaults to the caller — correct when
 * the desk owner/bot manages the keyring). The caller must hold the current CEK.
 */
export async function removeNodeKeyringRecipient(
  session: Session,
  spaceId: string,
  nodeId: string,
  removeSubKems: string[],
  opts: { trustedAdders?: string[] } = {},
): Promise<{ newEpoch: number }> {
  return removeRecipient(
    session.chatClient,
    nodeKeyringName(spaceId, nodeId),
    removeSubKems,
    { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
    { trustedAdders: opts.trustedAdders ?? ownerTrustedAdders(session) },
  );
}

/**
 * List the current recipients of a node keyring (provenance-filtered: only entries from a
 * trusted adder with a valid signature surface). Returns `{epoch:0, recipients:[]}` when no
 * keyring exists yet.
 */
export async function listNodeKeyringRecipients(
  session: Session,
  spaceId: string,
  nodeId: string,
  opts: { trustedAdders?: string[] } = {},
): Promise<{ epoch: number; recipients: ListedNodeRecipient[] }> {
  return listRecipients(session.chatClient, nodeKeyringName(spaceId, nodeId), {
    trustedAdders: opts.trustedAdders ?? ownerTrustedAdders(session),
  });
}

// ── Full revocation ───────────────────────────────────────────────────────────

/**
 * POST a signed {@link RevocationList} to the server's `/revocations` endpoint.
 * Default transport for `revokeNodeAccess`; override via `opts.submitRevocation`.
 */
async function defaultSubmitRevocation(list: RevocationList): Promise<void> {
  const url = `${getSyncBase()}${getSyncPrefix()}/revocations`;
  const res = await fetchWithTimeout()(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit revocation list: HTTP ${res.status}`);
  }
}

/**
 * True eviction of one or more node-keyring recipients.
 *
 * Composes two cryptographic steps:
 *   1. **Keyring rotation** (forward secrecy) — rotates to a new epoch so the
 *      removed parties cannot decrypt future messages. Delegates to
 *      `removeNodeKeyringRecipient`.
 *   2. **Cap revocation** (access cut-off) — builds a signed {@link RevocationList}
 *      (subject-level, invalidates every cap for the subject regardless of nonce)
 *      and submits it to the server via `submitRevocation`. The server's
 *      `isRevoked` check then rejects authenticated requests from the revoked
 *      subjects.
 *
 * Cap revocation only runs when `opts.revokedSubjects` is non-empty.  The caller
 * is responsible for mapping `subKem` → `{ sub: edPub, exp }` (cap subject +
 * expiry), which they had at invite time.
 *
 * `opts.generation` MUST be strictly greater than any prior generation submitted
 * by this issuer (`session.keys.edPub`). The server rejects out-of-order lists.
 * Callers should persist the last-used generation and increment it. If omitted,
 * the current unix-second timestamp is used (sufficient when revocations are
 * spaced more than 1 second apart; use an explicit counter for burst scenarios).
 */
export async function revokeNodeAccess(
  session: Session,
  spaceId: string,
  nodeId: string,
  removeSubKems: string[],
  opts: {
    trustedAdders?: string[];
    revokedSubjects?: RevokedSubject[];
    generation?: number;
    submitRevocation?: (list: RevocationList) => Promise<void>;
  } = {},
): Promise<{ newEpoch: number; revoked: boolean }> {
  // Step 1: rotate the keyring (forward secrecy).
  const { newEpoch } = await removeNodeKeyringRecipient(session, spaceId, nodeId, removeSubKems, {
    trustedAdders: opts.trustedAdders,
  });

  // Step 2: revoke the cap(s) so the server stops honouring authenticated requests.
  if (!opts.revokedSubjects || opts.revokedSubjects.length === 0) {
    return { newEpoch, revoked: false };
  }
  const generation = opts.generation ?? Math.floor(Date.now() / 1000);
  const list = buildRevocationList({
    issEdPubHex: session.keys.edPub,
    issEdPrivHex: session.keys.edPriv,
    generation,
    revoked: [],
    revokedSubjects: opts.revokedSubjects,
  });
  const submit = opts.submitRevocation ?? defaultSubmitRevocation;
  await submit(list);
  return { newEpoch, revoked: true };
}
