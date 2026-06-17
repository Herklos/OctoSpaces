/**
 * Per-node creation, access management, and invite flows.
 *
 * Nodes are the atomic content units of a space (rooms in OctoChat, pages/projects in
 * OctoVault). Each node carries two independent axes:
 *   - `access`: `'public' | 'space' | 'invite'` — who may reach the node.
 *   - `enc`:    `boolean` — whether content is E2EE under the SPACE-WIDE keyring.
 *
 * Invalid combo: `access:'public'` + `enc:true` is rejected outright.
 *
 * Encryption uses ONE space keyring (at `spaces/{spaceId}/_keyring`). Any space member
 * holding the keyring can decrypt ALL `enc` nodes in the space — the keyring is coarse-
 * grained by design. For `access:'invite'` + `enc:true` nodes, inviting someone to the
 * node also grants them the space key (and thus access to all enc content in the space).
 *
 * Invite flows mirror the space membership flows in `members.ts` but scoped per node.
 *
 * DIRECT INVITE:
 *   - `enc` node: owner adds invitee to space keyring + mints space cap → invitee calls
 *     `acceptNodeInvite`, storing the space cap.
 *   - `invite+plaintext` node: owner mints per-node narrow cap (nodeMemberScope) →
 *     invitee calls `acceptNodeInvite`, storing the per-node cap.
 *
 * LINK INVITE:
 *   - `enc` node: owner adds ephemeral KEM to space keyring; link cap uses spaceMemberScope.
 *   - `invite+plaintext` node: ephemeral keypair, narrow per-node cap (nodeMemberScope).
 *   - Bearer: `joinNodeByLink` — stores per-node `{kind:'link'}` entry.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import { hexToBytes } from '@drakkar.software/starfish-keyring';
import { ed25519 } from '@noble/curves/ed25519.js';

import type { NodeAccess, ObjectNode, ObjectType } from '../core/types.js';
import { addSpaceKeyringRecipient, ownerEnsureKeyring } from '../sync/client.js';
import type { Session } from '../sync/identity.js';
import { ownerTrustedAdders } from '../sync/identity.js';
import {
  keyringPull,
  keyringPush,
  nodeKeyringScope,
  nodeMemberScope,
  nodeStreamScope,
  spaceMemberScope,
  userIdFromEdPub,
} from '../sync/paths.js';
import {
  getSpaceClient,
} from '../sync/space-access.js';
import { ensureNodeKeyringRecipient } from '../sync/node-keyring.js';
import {
  getNodeAccessEntry,
  saveNodeAccessEntry,
  saveNodeStreamAccessEntry,
  saveNodeKeyringAccessEntry,
  saveSpaceAccessEntry,
} from '../sync/space-access-store.js';
import { sealToSelf } from '../sync/account-seal.js';
import { encodeLinkFragment, decodeLinkFragment } from '../sync/link-token.js';
import { addObject } from '../objects/objects.js';
import { updateObjectIndex } from './object-index.js';
import { addSpaceMember, buildSpace, readSpaces } from './registry.js';
import { randomId } from '../core/ids.js';
import type { JoinRequest } from './members.js';

// ── createNode ────────────────────────────────────────────────────────────────

export interface CreateNodeInput {
  type: ObjectType;
  title: string;
  emoji?: string;
  parentId?: string | null;
  /** Who may reach this node. Default: `'space'`. */
  access?: NodeAccess;
  /** Whether node content is E2EE under the space-wide keyring. Default: `false`. */
  enc?: boolean;
  /** App-specific metadata. */
  meta?: Record<string, unknown>;
}

/**
 * Create a new node in a space's object index.
 *
 * - Rejects the invalid combo `public+enc`.
 * - For `enc` nodes, ensures the space-wide keyring exists (minted once per space,
 *   idempotent on subsequent creates).
 * - Returns the created node as it was inserted into the index.
 */
export async function createNode(
  session: Session,
  spaceId: string,
  input: CreateNodeInput,
): Promise<ObjectNode> {
  const access = input.access ?? 'space';
  const enc = input.enc ?? false;
  if (access === 'public' && enc) throw new Error('public+enc is not a valid combination.');

  const nodeId = `obj-${randomId()}`;

  if (enc) {
    // Ensure the space-wide keyring exists (idempotent — minted once per space).
    const client = getSpaceClient(spaceId, session);
    await ownerEnsureKeyring(
      client,
      session.keys,
      keyringPull(spaceId),
      keyringPush(spaceId),
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
  });

  if (!createdNode) throw new Error('createNode: index update did not produce a node');
  return createdNode;
}

// ── setNodeAccess ─────────────────────────────────────────────────────────────

/**
 * Patch the `access`/`enc` axes of a node in the index.
 *
 * - Rejects `public+enc`.
 * - For enabling `enc`, ensures the space keyring exists (idempotent).
 * - Content migration (moving between `objpub`/`objdoc`/`objinv`) is the caller's
 *   responsibility — this only flips the metadata flags.
 */
export async function setNodeAccess(
  session: Session,
  spaceId: string,
  nodeId: string,
  patch: { access?: NodeAccess; enc?: boolean },
): Promise<void> {
  if (patch.access === 'public' && patch.enc) throw new Error('public+enc is not valid.');

  if (patch.enc) {
    // Ensure the space-wide keyring exists (idempotent).
    const client = getSpaceClient(spaceId, session);
    await ownerEnsureKeyring(
      client,
      session.keys,
      keyringPull(spaceId),
      keyringPush(spaceId),
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
  });
}

// ── Direct invite ─────────────────────────────────────────────────────────────

export interface NodeInviteBundle {
  spaceId: string;
  nodeId: string;
  nodeName: string;
  /**
   * Space-level member cap — grants index read access (and thus visibility of every
   * node's metadata). Omitted for `isolated` invites that must NOT grant space-wide
   * access (e.g. OctoDesk tickets, where an external requester should reach only their
   * own ticket).
   */
  cap?: unknown;
  /** Per-node content cap (`objinv`) — for `invite+plaintext` AND per-node-keyring enc nodes. */
  nodeCap?: unknown;
  /** Per-node STREAM cap (`objinvlog`) — for nodes with a message log. */
  streamCap?: unknown;
  /**
   * Per-node KEYRING cap (`nodekeyring`, READ-only) — present ONLY for per-node-keyring
   * E2EE nodes (`enc + isolated`, e.g. an OctoDesk ticket). Lets the isolated requester
   * read the node keyring to decrypt content WITHOUT holding the space-wide keyring.
   */
  keyringCap?: unknown;
}

/**
 * Owner: invite an identity to a specific node.
 *
 * - For `enc` nodes: adds the invitee to the space-wide keyring (granting decryption
 *   access to ALL enc nodes in the space) and mints a space-level member cap.
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
  opts: { isolated?: boolean; write?: boolean } = {},
): Promise<string> {
  const req = JSON.parse(requestJson) as JoinRequest;
  if (!req.edPub || !req.kemPub || !req.userId) throw new Error('Invalid join request.');
  // M2/I1 fix: reject requests whose claimed userId doesn't derive from their edPub.
  if ((await userIdFromEdPub(req.edPub)) !== req.userId) {
    throw new Error('Invalid join request: userId does not match edPub.');
  }
  // K4 fix: verify kemSig — Ed25519 sig of kemPub by edPriv — prevents KEM-key substitution.
  let kemSigValid = false;
  try {
    kemSigValid = !!req.kemSig && ed25519.verify(hexToBytes(req.kemSig), hexToBytes(req.kemPub), hexToBytes(req.edPub));
  } catch { /* malformed hex — treat as invalid */ }
  if (!kemSigValid) {
    throw new Error('Invalid join request: kemSig is missing or invalid.');
  }

  // `isolated` withholds space membership + the space cap, so the invitee reaches ONLY
  // this node — never the index or other nodes. For an `enc` node, `isolated` ALSO selects
  // the PER-NODE keyring (a CEK wrapped only to this node's participants) instead of the
  // space-wide keyring — the E2EE-ticket model. A non-isolated `enc` invite keeps the
  // legacy space-keyring behaviour (back-compat for shared-space encrypted nodes).
  const isolated = !!opts.isolated;
  const perNodeKeyring = !!node.enc && isolated;
  // Default write=true (backward compat) so existing callers keep write access.
  const canWrite = opts.write !== false;
  const subject = { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId };

  if (node.enc && !perNodeKeyring) {
    // LEGACY space-wide keyring path (non-isolated enc): add the invitee as a recipient of
    // the space keyring (grants decryption of ALL enc nodes in the space). Ensure-first.
    const encClient = getSpaceClient(spaceId, session);
    await ownerEnsureKeyring(
      encClient,
      session.keys,
      keyringPull(spaceId),
      keyringPush(spaceId),
      ownerTrustedAdders(session),
    );
    await addSpaceKeyringRecipient(session, spaceId, { subKem: req.kemPub, userId: req.userId, label: req.userId.slice(0, 8) });
  }

  const bundle: NodeInviteBundle = {
    spaceId,
    nodeId,
    nodeName: nodeName ?? nodeId,
  };

  if (perNodeKeyring) {
    // PER-NODE keyring: ensure it exists then add the requester's KEM as a recipient
    // (ensure-before-add invariant), and mint a READ-only keyring cap so the isolated
    // requester can fetch+decrypt without ever touching the space key.
    await ensureNodeKeyringRecipient(session, spaceId, nodeId, {
      subKem: req.kemPub,
      userId: req.userId,
      label: req.userId.slice(0, 8),
    });
    bundle.keyringCap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      subject,
      'chat',
      nodeKeyringScope(spaceId, nodeId),
    );
  }

  if (!isolated) {
    // Ensure space membership (for index access) + mint the space-level cap.
    await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);
    bundle.cap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      subject,
      'chat',
      spaceMemberScope(spaceId, canWrite),
    );
  }

  if (!node.enc || perNodeKeyring) {
    // Mint narrow per-node caps — content (objinv) AND the message stream (objinvlog).
    // A member cap covers exactly one collection, so each needs its own. For
    // per-node-keyring enc nodes the bytes are sealed client-side (collections stay
    // `encryption:'none'`), so the same content/stream caps apply.
    bundle.nodeCap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      subject,
      'chat',
      nodeMemberScope(spaceId, nodeId, canWrite),
    );
    bundle.streamCap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      subject,
      'chat',
      nodeStreamScope(spaceId, nodeId, canWrite),
    );
  }

  return JSON.stringify(bundle);
}

/**
 * Invitee: accept a direct node invite — store the cap(s) and register access.
 * Returns the nodeId.
 */
export async function acceptNodeInvite(session: Session, bundleJson: string): Promise<string> {
  const bundle = JSON.parse(bundleJson) as Partial<NodeInviteBundle>;
  if (!bundle.spaceId || !bundle.nodeId) throw new Error('Invalid node invite.');

  // Validate every cap that IS present was issued for this identity. `isolated`
  // invites omit the space cap, so it's optional; but the bundle must carry at
  // least one usable cap (space OR per-node content).
  const assertForUs = (c: { kind?: string; sub?: string } | undefined, label: string): boolean => {
    if (!c) return false;
    if (c.kind !== 'member') throw new Error(`Invalid node invite (${label}): unexpected cap kind.`);
    if (!c.sub || c.sub !== session.keys.edPub) {
      throw new Error(`This invite was issued for a different identity (${label}).`);
    }
    return true;
  };

  const hasSpaceCap = assertForUs(bundle.cap as { kind?: string; sub?: string } | undefined, 'cap');
  const hasNodeCap = assertForUs(bundle.nodeCap as { kind?: string; sub?: string } | undefined, 'nodeCap');
  assertForUs(bundle.streamCap as { kind?: string; sub?: string } | undefined, 'streamCap');
  assertForUs(bundle.keyringCap as { kind?: string; sub?: string } | undefined, 'keyringCap');
  if (!hasSpaceCap && !hasNodeCap) throw new Error('Invalid node invite.');

  if (hasSpaceCap) {
    // Store space-level cap so the invitee can read the index.
    saveSpaceAccessEntry(bundle.spaceId, { kind: 'member', cap: JSON.stringify(bundle.cap) });
  }
  if (hasNodeCap) {
    // invite+plaintext (or per-node-keyring enc): store the narrow per-node content cap.
    saveNodeAccessEntry(bundle.spaceId, bundle.nodeId, { kind: 'member', cap: JSON.stringify(bundle.nodeCap) });
  }
  if (bundle.streamCap) {
    // ...and the per-node STREAM cap (objinvlog), under its own entry.
    saveNodeStreamAccessEntry(bundle.spaceId, bundle.nodeId, { kind: 'member', cap: JSON.stringify(bundle.streamCap) });
  }
  if (bundle.keyringCap) {
    // ...and the per-node KEYRING cap (nodekeyring) for E2EE tickets — lets the requester
    // open the node keyring and decrypt content without the space-wide key.
    saveNodeKeyringAccessEntry(bundle.spaceId, bundle.nodeId, { kind: 'member', cap: JSON.stringify(bundle.keyringCap) });
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
  /** Cap scope depends on the mode: spaceMemberScope for legacy space-keyring enc nodes,
   *  nodeMemberScope (objinv content) for plaintext / per-node-keyring nodes. */
  cap: unknown;
  /** Per-node STREAM cap (`objinvlog`) — present for nodes with a message log. The same
   *  ephemeral `key` authenticates every cap in the token. */
  streamCap?: unknown;
  /** Per-node KEYRING cap (`nodekeyring`, READ-only) — present for per-node-keyring E2EE
   *  nodes (`enc + isolated`, e.g. OctoDesk tickets). */
  keyringCap?: unknown;
  /** The ephemeral subject's Ed25519 private key (hex). */
  key: string;
  write: boolean;
}

export function encodeNodeInviteLink(origin: string, token: NodeInviteLinkToken): string {
  return encodeLinkFragment(origin, 'join/node', token);
}

export function decodeNodeInviteLink(fragment: string): NodeInviteLinkToken {
  const raw = decodeLinkFragment<{ spaceId: string; nodeId: string; cap: unknown; key: string } & Partial<NodeInviteLinkToken>>(
    fragment,
    (tok): tok is { spaceId: string; nodeId: string; cap: unknown; key: string } & Partial<NodeInviteLinkToken> =>
      !!tok && typeof tok.spaceId === 'string' && typeof tok.nodeId === 'string' && !!tok.cap && typeof tok.key === 'string',
    'That node invite link is malformed or incomplete.',
  );
  return {
    v: 1,
    spaceId: raw.spaceId,
    nodeId: raw.nodeId,
    nodeName: raw.nodeName ?? raw.nodeId,
    cap: raw.cap,
    ...(raw.streamCap !== undefined ? { streamCap: raw.streamCap } : {}),
    ...(raw.keyringCap !== undefined ? { keyringCap: raw.keyringCap } : {}),
    key: raw.key,
    write: !!raw.write,
  };
}

/**
 * Owner: create a shareable invite link for a specific node.
 *
 * - For `enc` nodes: adds ephemeral KEM to the space-wide keyring; the link cap uses
 *   `spaceMemberScope` so the bearer can read the keyring and decrypt enc content.
 * - For `invite+plaintext` nodes: narrow per-node cap (`nodeMemberScope`), no keyring.
 *
 * Anyone with the link can access the node; revoke by calling
 * `removeSpaceMember(ephemeralUserId)` (and rotating the space keyring for enc nodes).
 */
export async function createNodeInviteLink(
  session: Session,
  spaceId: string,
  nodeId: string,
  nodeName: string,
  node: { enc?: boolean },
  write: boolean,
  origin: string,
  opts: { isolated?: boolean } = {},
): Promise<{ token: NodeInviteLinkToken; link: string }> {
  const ek = generateDeviceKeys();
  const ephemeralUserId = await userIdFromEdPub(ek.edPub);
  const subject = { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex: ephemeralUserId };

  // `isolated` withholds space membership so the link bearer reaches ONLY this node. For an
  // `enc` node, `isolated` ALSO selects the PER-NODE keyring (E2EE-ticket model) instead of
  // the space keyring; a non-isolated enc link keeps the legacy space-keyring behaviour.
  const isolated = !!opts.isolated;
  const perNodeKeyring = !!node.enc && isolated;

  if (!isolated) {
    await addSpaceMember(session.accountClient, spaceId, session.userId, ephemeralUserId);
  }

  if (node.enc && !perNodeKeyring) {
    // LEGACY space-wide keyring path (non-isolated enc): add the ephemeral KEM to the space
    // keyring. Ensure-first (invariant: ownerEnsureKeyring precedes addCollectionRecipient).
    const encClient = getSpaceClient(spaceId, session);
    await ownerEnsureKeyring(
      encClient,
      session.keys,
      keyringPull(spaceId),
      keyringPush(spaceId),
      ownerTrustedAdders(session),
    );
    await addSpaceKeyringRecipient(session, spaceId, { subKem: ek.kemPub, userId: ephemeralUserId, label: ephemeralUserId.slice(0, 8) });
  }

  let keyringCap: unknown;
  if (perNodeKeyring) {
    // PER-NODE keyring: ensure + add the ephemeral KEM as a recipient (ensure-before-add),
    // then mint a READ-only keyring cap for the link bearer.
    await ensureNodeKeyringRecipient(session, spaceId, nodeId, {
      subKem: ek.kemPub,
      userId: ephemeralUserId,
      label: ephemeralUserId.slice(0, 8),
    });
    keyringCap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      subject,
      'chat',
      nodeKeyringScope(spaceId, nodeId),
    );
  }

  // Legacy space-keyring enc nodes need a space-scoped cap (to reach the space keyring);
  // plaintext / per-node-keyring nodes use the narrow per-node content cap (objinv).
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    subject,
    'chat',
    node.enc && !perNodeKeyring
      ? spaceMemberScope(spaceId, write)
      : nodeMemberScope(spaceId, nodeId, write),
  );

  // Plaintext / per-node-keyring nodes also get a per-node STREAM cap (objinvlog) — a
  // separate single-collection member cap, authenticated by the same ephemeral key.
  let streamCap: unknown;
  if (!node.enc || perNodeKeyring) {
    streamCap = await mintMemberCap(
      session.keys.edPriv,
      session.keys.edPub,
      subject,
      'chat',
      nodeStreamScope(spaceId, nodeId, write),
    );
  }

  const token: NodeInviteLinkToken = {
    v: 1,
    spaceId,
    nodeId,
    nodeName,
    cap,
    ...(streamCap !== undefined ? { streamCap } : {}),
    ...(keyringCap !== undefined ? { keyringCap } : {}),
    key: ek.edPriv,
    write,
  };
  return { token, link: encodeNodeInviteLink(origin, token) };
}

/**
 * Any user: access a node by redeeming an invite link token.
 * Stores the per-node link entry locally and seals it into the synced `_spaces` doc.
 */
export async function joinNodeByLink(session: Session, token: NodeInviteLinkToken): Promise<string> {
  const accessPayload = { cap: token.cap, key: token.key, write: token.write };
  const sealed = await sealToSelf(session, JSON.stringify(accessPayload));
  // The per-node STREAM cap (objinvlog), when present, is sealed + persisted under its
  // own `${spaceId}:${nodeId}:stream` key — same machinery, distinct entry.
  const sealedStream =
    token.streamCap !== undefined
      ? await sealToSelf(session, JSON.stringify({ cap: token.streamCap, key: token.key, write: token.write }))
      : null;
  // The per-node KEYRING cap (nodekeyring) for E2EE tickets — sealed + persisted under
  // its own `${spaceId}:${nodeId}:keyring` key.
  const sealedKeyring =
    token.keyringCap !== undefined
      ? await sealToSelf(session, JSON.stringify({ cap: token.keyringCap, key: token.key, write: false }))
      : null;

  // Persist sealed entry into _spaces.pubAccess keyed by spaceId:nodeId.
  // Also register the node as a listable Space (dup-guarded) so it appears in
  // the host app's space rail after joining.
  const spaceEntry = buildSpace(token.nodeId, token.nodeName);
  const { updateSpacesDoc } = await import('./registry.js');
  await updateSpacesDoc(session.accountClient, session.userId, (cur) => ({
    spaces: cur.spaces.some((s) => s.id === token.nodeId) ? cur.spaces : [...cur.spaces, spaceEntry],
    caps: cur.caps,
    pubAccess: {
      ...cur.pubAccess,
      [`${token.spaceId}:${token.nodeId}`]: sealed,
      ...(sealedStream ? { [`${token.spaceId}:${token.nodeId}:stream`]: sealedStream } : {}),
      ...(sealedKeyring ? { [`${token.spaceId}:${token.nodeId}:keyring`]: sealedKeyring } : {}),
    },
  }));

  saveNodeAccessEntry(token.spaceId, token.nodeId, {
    kind: 'link',
    cap: token.cap,
    key: token.key,
    write: token.write,
  });
  if (token.streamCap !== undefined) {
    saveNodeStreamAccessEntry(token.spaceId, token.nodeId, {
      kind: 'link',
      cap: token.streamCap,
      key: token.key,
      write: token.write,
    });
  }
  if (token.keyringCap !== undefined) {
    saveNodeKeyringAccessEntry(token.spaceId, token.nodeId, {
      kind: 'link',
      cap: token.keyringCap,
      key: token.key,
      write: false,
    });
  }

  return token.nodeId;
}
