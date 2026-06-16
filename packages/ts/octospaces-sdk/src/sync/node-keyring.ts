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

import { openEncryptor, buildEncryptor, ownerEnsureKeyring } from './client.js';
import type { DeviceKeys } from './client.js';
import type { Session } from './identity.js';
import { nodeKeyringName, nodeKeyringPull, nodeKeyringPush } from './paths.js';

/** A keyring recipient, referenced by their X25519 KEM pubkey (hex). */
export interface NodeKeyringRecipient {
  subKem: string;
  userId?: string;
  label?: string;
}

/** "Already a recipient" is benign on re-invite — same regex family as members.ts. */
const isAlreadyPresent = (e: unknown): boolean =>
  /already (present|a recipient|exists)|duplicate/i.test(e instanceof Error ? e.message : String(e));

/**
 * Owner/creator side: create the node's keyring if missing, return an encryptor.
 * Delegates to the generic `ownerEnsureKeyring` with the NODE keyring paths.
 */
export function ownerEnsureNodeKeyring(
  session: Session,
  spaceId: string,
  nodeId: string,
  trustedAdders: string[] = [session.keys.edPub],
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
      { trustedAdders: opts.trustedAdders ?? [session.keys.edPub] },
    );
  } catch (e) {
    if (isAlreadyPresent(e)) return;
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
    { trustedAdders: opts.trustedAdders ?? [session.keys.edPub] },
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
    trustedAdders: opts.trustedAdders ?? [session.keys.edPub],
  });
}
