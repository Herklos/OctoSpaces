/**
 * Per-node creation, access management, and invite flows.
 *
 * Nodes are the atomic content units of a space (rooms in OctoChat, pages/projects in
 * OctoVault). Each node carries two independent axes:
 *   - `access`: `'public' | 'space' | 'invite'` — who may reach the node.
 *   - `enc`:    `boolean` — whether content is E2EE under the node's own keyring.
 *
 * Invalid combo: `access:'public'` + `enc:true` is rejected outright.
 *
 * Invite flows mirror the space membership flows in `members.ts` but scoped per node.
 *
 * DIRECT INVITE:
 *   - `enc` node: owner adds invitee to node keyring + mints space cap → invitee calls
 *     `acceptNodeInvite`, storing the space cap (keyring is the content gate).
 *   - `invite+plaintext` node: owner mints per-node narrow cap (nodeMemberScope) →
 *     invitee calls `acceptNodeInvite`, storing the per-node cap.
 *
 * LINK INVITE:
 *   - Owner: `createNodeInviteLink` — ephemeral keypair, narrow per-node cap encoded in URL.
 *   - Bearer: `joinNodeByLink` — stores per-node `{kind:'link'}` entry.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';

import type { NodeAccess, ObjectNode, ObjectType } from '../core/types.js';
import { ownerEnsureKeyring } from '../sync/client.js';
import type { Session } from '../sync/identity.js';
import { ownerTrustedAdders } from '../sync/identity.js';
import {
  nodeKeyringName,
  nodeKeyringPull,
  nodeKeyringPush,
  nodeMemberScope,
  spaceMemberScope,
  userIdFromEdPub,
} from '../sync/paths.js';
import {
  getSpaceClient,
} from '../sync/space-access.js';
import {
  getNodeAccessEntry,
  saveNodeAccessEntry,
  saveSpaceAccessEntry,
} from '../sync/space-access-store.js';
import { sealToSelf } from '../sync/account-seal.js';
import { toBase64Url, fromBase64Url } from '../sync/base64url.js';
import { addObject } from '../objects/objects.js';
import { updateObjectIndex } from './object-index.js';
import { addSpaceMember, readSpaces } from './registry.js';
import { randomId } from '../core/ids.js';
import type { JoinRequest } from './members.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function isAlreadyPresentRecipient(err: unknown): boolean {
  return err instanceof Error && /already present in epoch/.test(err.message);
}

// ── createNode ────────────────────────────────────────────────────────────────

export interface CreateNodeInput {
  type: ObjectType;
  title: string;
  emoji?: string;
  parentId?: string | null;
  /** Who may reach this node. Default: `'space'`. */
  access?: NodeAccess;
  /** Whether node content is E2EE under its own keyring. Default: `false`. */
  enc?: boolean;
  /** App-specific metadata. */
  meta?: Record<string, unknown>;
}

/**
 * Create a new node in a space's object index.
 *
 * - Rejects the invalid combo `public+enc`.
 * - For `enc` nodes, mints a per-node keyring (owner-only).
 * - Returns the created node as it was inserted into the index.
 */
export async function createNode(
  session: Session,
  spaceId: string,
  input: CreateNodeInput,
  reg?: { owner: string | null; members: string[] } | null,
): Promise<ObjectNode> {
  const access = input.access ?? 'space';
  const enc = input.enc ?? false;
  if (access === 'public' && enc) throw new Error('public+enc is not a valid combination.');

  const nodeId = `obj-${randomId()}`;

  if (enc) {
    const client = getSpaceClient(spaceId, session);
    await ownerEnsureKeyring(
      client,
      session.keys,
      nodeKeyringPull(spaceId, nodeId),
      nodeKeyringPush(spaceId, nodeId),
      ownerTrustedAdders(session),
    );
  }

  let createdNode: ObjectNode | null = null;

  await updateObjectIndex(session, spaceId, (nodes, now) => {
    const { nodes: next, node } = addObject(nodes, {
      id: nodeId,
      type: input.type,
      title: input.title,
      ...(input.emoji ? { emoji: input.emoji } : {}),
      parentId: input.parentId ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
      access,
      enc: enc || undefined,
    }, now);
    createdNode = next.find((n) => n.id === nodeId) ?? node;
    return next;
  }, reg);

  if (!createdNode) throw new Error('createNode: index update did not produce a node');
  return createdNode;
}

// ── setNodeAccess ─────────────────────────────────────────────────────────────

/**
 * Patch the `access`/`enc` axes of a node in the index.
 *
 * - Rejects `public+enc`.
 * - For enabling `enc`, mints the node keyring (owner-only, idempotent).
 * - Content migration (moving between `objpub`/`objdoc`/`objinv`) is the caller's
 *   responsibility — this only flips the metadata flags.
 */
export async function setNodeAccess(
  session: Session,
  spaceId: string,
  nodeId: string,
  patch: { access?: NodeAccess; enc?: boolean },
  reg?: { owner: string | null; members: string[] } | null,
): Promise<void> {
  if (patch.access === 'public' && patch.enc) throw new Error('public+enc is not valid.');

  if (patch.enc) {
    const client = getSpaceClient(spaceId, session);
    await ownerEnsureKeyring(
      client,
      session.keys,
      nodeKeyringPull(spaceId, nodeId),
      nodeKeyringPush(spaceId, nodeId),
      ownerTrustedAdders(session),
    );
  }

  await updateObjectIndex(session, spaceId, (nodes, now) => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return null;
    const cur = nodes[idx]!;

    const next: ObjectNode = { ...cur, updatedAt: now };

    if (patch.access !== undefined) {
      if (patch.access === 'space') {
        delete (next as unknown as Record<string, unknown>).access;
      } else {
        next.access = patch.access;
      }
    }

    if (patch.enc !== undefined) {
      if (!patch.enc) {
        delete (next as unknown as Record<string, unknown>).enc;
      } else {
        next.enc = true;
      }
    }

    // Re-validate after applying both patches
    if (next.access === 'public' && next.enc) throw new Error('public+enc is not valid.');

    const unchanged =
      next.access === cur.access &&
      (next.enc ?? false) === (cur.enc ?? false);
    if (unchanged) return null;

    return nodes.map((n, i) => (i === idx ? next : n));
  }, reg);
}

// ── Direct invite ─────────────────────────────────────────────────────────────

export interface NodeInviteBundle {
  spaceId: string;
  nodeId: string;
  nodeName: string;
  /** Space-level member cap (always present — grants index read access). */
  cap: unknown;
  /** Per-node narrow cap (only for `invite+plaintext` nodes). */
  nodeCap?: unknown;
}

/**
 * Owner: invite an identity to a specific node.
 *
 * - For `enc` nodes: adds the invitee to the per-node keyring and mints a
 *   space-level member cap so they can read the index + keyring.
 * - For `invite+plaintext` nodes: mints both a space-level cap (index) and a
 *   narrow per-node cap (`nodeMemberScope`, covers `objinv` content).
 *
 * Returns the invite bundle JSON; pass to the invitee who calls `acceptNodeInvite`.
 */
export async function inviteToNode(
  session: Session,
  spaceId: string,
  nodeId: string,
  requestJson: string,
  node: { enc?: boolean },
  nodeName?: string,
): Promise<string> {
  const req = JSON.parse(requestJson) as JoinRequest;
  if (!req.edPub || !req.kemPub || !req.userId) throw new Error('Invalid join request.');

  if (node.enc) {
    // Add invitee's KEM key to the per-node keyring
    try {
      await addCollectionRecipient(
        session.chatClient,
        nodeKeyringName(spaceId, nodeId),
        { subKem: req.kemPub, userId: req.userId, label: req.userId.slice(0, 8) },
        { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
        { trustedAdders: [session.keys.edPub] },
      );
    } catch (err) {
      if (!isAlreadyPresentRecipient(err)) throw err;
    }
  }

  // Always ensure space membership (for index access)
  await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);

  const spaceCap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
    'chat',
    spaceMemberScope(spaceId, true),
  );

  const bundle: NodeInviteBundle = {
    spaceId,
    nodeId,
    nodeName: nodeName ?? nodeId,
    cap: spaceCap,
  };

  if (!node.enc) {
    // invite+plaintext: also mint narrow per-node cap for objinv content
    const perNodeCap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
      'chat',
      nodeMemberScope(spaceId, nodeId, true),
    );
    bundle.nodeCap = perNodeCap;
  }

  return JSON.stringify(bundle);
}

/**
 * Invitee: accept a direct node invite — store the cap(s) and register access.
 * Returns the nodeId.
 */
export async function acceptNodeInvite(session: Session, bundleJson: string): Promise<string> {
  const bundle = JSON.parse(bundleJson) as Partial<NodeInviteBundle>;
  const cap = bundle.cap as { kind?: string; sub?: string } | undefined;
  if (!cap || !bundle.spaceId || !bundle.nodeId) throw new Error('Invalid node invite.');
  if (cap.kind !== 'member') throw new Error('Invalid node invite.');
  if (!cap.sub || cap.sub !== session.keys.edPub) {
    throw new Error('This invite was issued for a different identity.');
  }

  const capJson = JSON.stringify(cap);
  // Store space-level cap so the invitee can read the index
  saveSpaceAccessEntry(bundle.spaceId, { kind: 'member', cap: capJson });

  if (bundle.nodeCap) {
    // invite+plaintext: also store narrow per-node cap
    const nodeCapJson = JSON.stringify(bundle.nodeCap);
    saveNodeAccessEntry(bundle.spaceId, bundle.nodeId, { kind: 'member', cap: nodeCapJson });
  }

  return bundle.nodeId;
}

// ── Link-based node invite ────────────────────────────────────────────────────

/** A node invite link token (v:1). */
export interface NodeInviteLinkToken {
  v: 1;
  spaceId: string;
  nodeId: string;
  nodeName: string;
  /** Per-node narrow cap (nodeMemberScope). */
  cap: unknown;
  /** The ephemeral subject's Ed25519 private key (hex). */
  key: string;
  write: boolean;
}

export function encodeNodeInviteLink(origin: string, token: NodeInviteLinkToken): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/join/node#${toBase64Url(JSON.stringify(token))}`;
}

export function decodeNodeInviteLink(fragment: string): NodeInviteLinkToken {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const tok = JSON.parse(fromBase64Url(frag)) as Partial<NodeInviteLinkToken>;
  if (!tok || !tok.spaceId || !tok.nodeId || !tok.cap || !tok.key) {
    throw new Error('That node invite link is malformed or incomplete.');
  }
  return {
    v: 1,
    spaceId: tok.spaceId,
    nodeId: tok.nodeId,
    nodeName: tok.nodeName ?? tok.nodeId,
    cap: tok.cap,
    key: tok.key,
    write: !!tok.write,
  };
}

/**
 * Owner: create a shareable invite link for a specific node.
 *
 * Mints an ephemeral Ed/KEM keypair, adds its userId to the space roster, and
 * encodes a narrow per-node cap + private key in the URL. For `enc` nodes the
 * ephemeral KEM key is also added to the node keyring.
 *
 * Anyone with the link can access the node; revoke by calling
 * `removeSpaceMember(ephemeralUserId)` or rotating the node keyring.
 */
export async function createNodeInviteLink(
  session: Session,
  spaceId: string,
  nodeId: string,
  nodeName: string,
  node: { enc?: boolean },
  write: boolean,
  origin: string,
): Promise<{ token: NodeInviteLinkToken; link: string }> {
  const ek = generateDeviceKeys();
  const ephemeralUserId = await userIdFromEdPub(ek.edPub);

  await addSpaceMember(session.accountClient, spaceId, session.userId, ephemeralUserId);

  if (node.enc) {
    // Add ephemeral KEM to the node keyring
    try {
      await addCollectionRecipient(
        session.chatClient,
        nodeKeyringName(spaceId, nodeId),
        { subKem: ek.kemPub, userId: ephemeralUserId, label: ephemeralUserId.slice(0, 8) },
        { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
        { trustedAdders: [session.keys.edPub] },
      );
    } catch (err) {
      if (!isAlreadyPresentRecipient(err)) throw err;
    }
  }

  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex: ephemeralUserId },
    'chat',
    nodeMemberScope(spaceId, nodeId, write),
  );

  const token: NodeInviteLinkToken = { v: 1, spaceId, nodeId, nodeName, cap, key: ek.edPriv, write };
  return { token, link: encodeNodeInviteLink(origin, token) };
}

/**
 * Any user: access a node by redeeming an invite link token.
 * Stores the per-node link entry locally and seals it into the synced `_spaces` doc.
 */
export async function joinNodeByLink(session: Session, token: NodeInviteLinkToken): Promise<string> {
  const accessPayload = { cap: token.cap, key: token.key, write: token.write };
  const sealed = await sealToSelf(session, JSON.stringify(accessPayload));

  // Persist sealed entry into _spaces.pubAccess keyed by spaceId:nodeId
  const { updateSpacesDoc } = await import('./registry.js');
  await updateSpacesDoc(session.accountClient, session.userId, (cur) => ({
    spaces: cur.spaces,
    caps: cur.caps,
    pubAccess: {
      ...cur.pubAccess,
      [`${token.spaceId}:${token.nodeId}`]: sealed,
    },
  }));

  saveNodeAccessEntry(token.spaceId, token.nodeId, {
    kind: 'link',
    cap: token.cap,
    key: token.key,
    write: token.write,
  });

  return token.nodeId;
}
