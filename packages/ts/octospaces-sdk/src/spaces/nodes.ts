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
import type { RevocationEntry, RevocationList } from '@drakkar.software/starfish-protocol';

import type { NodeAccess, ObjectNode, ObjectType } from '../core/types.js';
import { ensureSpaceKeyringRecipient, ownerEnsureSpaceKeyring } from '../sync/client.js';
import type { Session } from '../sync/identity.js';
import { assertCapForMe, capNonce, ephemeralSubject, evictKeyringMember, mintCap, parseJoinRequest } from './invite-helpers.js';
import {
  nodeKeyringName,
  nodeKeyringScope,
  nodeMemberScope,
  nodeStreamScope,
  recipientFor,
  spaceMemberScope,
} from '../sync/paths.js';
import { ensureNodeKeyringRecipient } from '../sync/node-keyring.js';
import {
  saveNodeAccessEntry,
  saveNodeStreamAccessEntry,
  saveNodeKeyringAccessEntry,
  saveSpaceAccessEntry,
} from '../sync/space-access-store.js';
import { sealToSelf } from '../sync/account-seal.js';
import { encodeLinkFragment, decodeLinkFragment } from '../sync/link-token.js';
import { createComposedStore } from '../sync/keyed-store.js';
import { addObject } from '../objects/objects.js';
import { updateObjectIndex } from './object-index.js';
import { addSpaceMember, buildSpace } from './registry.js';
import { randomId } from '../core/ids.js';

// ── owner-side node invite store (nonces for revocation) ─────────────────────
//
// When the owner issues an isolated per-node-keyring invite (e.g. an OctoDesk ticket),
// they retain the cap nonces here so `revokeNodeAccess` can revoke ALL three caps
// (keyring + content + stream) in a single RevocationList submission.
//
// This store is in-memory (module-level Map). It survives the current JS execution
// context (e.g. a browser tab or server process), but is cleared on reload. Callers
// that need persistence across reloads should hydrate from their own durable store and
// call `saveNodeInviteEntry` on startup.

export interface StoredNodeInvite {
  /** Invitee's Ed25519 signing pubkey (hex) — the cap's `sub`. */
  edPub: string;
  /** Invitee's X25519 KEM pubkey (hex) — the keyring recipient entry to drop on rotation. */
  kemPub: string;
  /** Nonces of the caps the owner minted (each is a separate revocation target). */
  caps: {
    keyring?: { nonce: string; exp: number };
    node?: { nonce: string; exp: number };
    stream?: { nonce: string; exp: number };
  };
}

// Keyed `${spaceId}:${nodeId}:${userId}` → invite. Wrappers keep their exact
// names/signatures; the store API is provided by `createComposedStore`.
const nodeInviteStore = createComposedStore<StoredNodeInvite, [string, string, string]>(
  (spaceId, nodeId, userId) => `${spaceId}:${nodeId}:${userId}`,
);

/** Record the caps minted for an isolated node invite (owner side). */
export const saveNodeInviteEntry = (
  spaceId: string, nodeId: string, userId: string, entry: StoredNodeInvite,
): void => nodeInviteStore.save([spaceId, nodeId, userId], entry);
/** Retrieve the stored invite entry for a user on a node, or null if absent. */
export const getNodeInviteEntry = (
  spaceId: string, nodeId: string, userId: string,
): StoredNodeInvite | null => nodeInviteStore.get([spaceId, nodeId, userId]);
/** Clear all stored invite entries (for test isolation or sign-out). */
export const clearNodeInviteStore = nodeInviteStore.clear;
/** Serialize the in-memory invite store so callers can persist it across reloads
 *  (IndexedDB, AsyncStorage, etc.) and later restore it via `hydrateNodeInviteStore`. */
export const serializeNodeInviteStore = nodeInviteStore.serialize;
/** Restore previously-serialized invite entries into the in-memory store. Call on app
 *  startup before any `revokeNodeAccess` call so revocation survives a reload/restart. */
export const hydrateNodeInviteStore = nodeInviteStore.hydrate;

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
    await ownerEnsureSpaceKeyring(session, spaceId);
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

  // Mint the owner's per-node stream cap (objinvlog) so the owner can read this node's
  // invite-log. ownerScope (paths: ['spaces/**']) is not honoured by the sharing plugin
  // for the objinvlog collection — a per-node cap is required.
  const ownerStreamCap = await mintCap(
    session,
    { edPubHex: session.keys.edPub, kemPubHex: session.keys.kemPub, userIdHex: session.userId },
    'objinvlog',
    nodeStreamScope(spaceId, nodeId, true),
  );
  saveNodeStreamAccessEntry(spaceId, nodeId, { kind: 'member', cap: JSON.stringify(ownerStreamCap) });

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
    await ownerEnsureSpaceKeyring(session, spaceId);
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

/**
 * Discriminates the E2EE model for a node invite so the invitee can handle the bundle
 * correctly without reverse-engineering which caps are present.
 *
 * - `'plaintext'`  — no encryption; content is readable without any keyring.
 * - `'space-enc'`  — space-wide keyring (legacy enc invite); invitee receives a
 *                    space-level cap and uses the space keyring to decrypt.
 * - `'node-enc'`   — per-node keyring (OctoDesk/isolated E2EE ticket); invitee receives
 *                    a `keyringCap` (READ-only) scoped to this node's keyring only.
 */
export type NodeInviteKind = 'plaintext' | 'space-enc' | 'node-enc';

export interface NodeInviteBundle {
  spaceId: string;
  nodeId: string;
  nodeName: string;
  /**
   * Discriminates the invite's E2EE model. Absent in bundles produced before 0.12.9;
   * treat absent as `'plaintext'` or derive from which caps are present.
   */
  kind?: NodeInviteKind;
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
  // Parse + verify (shape, userId←edPub, kemSig) before trusting any field.
  const req = await parseJoinRequest(requestJson, 'Invalid join request');

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
    await ensureSpaceKeyringRecipient(session, spaceId, recipientFor(req.kemPub, req.userId));
  }

  const bundle: NodeInviteBundle = {
    spaceId,
    nodeId,
    nodeName: nodeName ?? nodeId,
    // Discriminate the invite's E2EE model so the invitee can handle it correctly.
    kind: perNodeKeyring ? 'node-enc' : (node.enc ? 'space-enc' : 'plaintext'),
  };

  if (perNodeKeyring) {
    // PER-NODE keyring: ensure it exists then add the requester's KEM as a recipient
    // (ensure-before-add invariant), and mint a READ-only keyring cap so the isolated
    // requester can fetch+decrypt without ever touching the space key.
    await ensureNodeKeyringRecipient(session, spaceId, nodeId, recipientFor(req.kemPub, req.userId));
    bundle.keyringCap = await mintCap(session, subject, 'nodekeyring', nodeKeyringScope(spaceId, nodeId));
  }

  if (!isolated) {
    // Ensure space membership (for index access) + mint the space-level cap.
    await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);
    bundle.cap = await mintCap(session, subject, 'content', spaceMemberScope(spaceId, canWrite));
  }

  if (!node.enc || perNodeKeyring) {
    // Mint narrow per-node caps — content (objinv) AND the message stream (objinvlog).
    // A member cap covers exactly one collection, so each needs its own. For
    // per-node-keyring enc nodes the bytes are sealed client-side (collections stay
    // `encryption:'none'`), so the same content/stream caps apply.
    bundle.nodeCap = await mintCap(session, subject, 'objinv', nodeMemberScope(spaceId, nodeId, canWrite));
    bundle.streamCap = await mintCap(session, subject, 'objinvlog', nodeStreamScope(spaceId, nodeId, canWrite));
  }

  // Retain cap nonces for future revocation (per-node-keyring invites only). The owner
  // needs all three nonces to submit a complete RevocationList covering every cap the
  // invitee holds (keyring + content + stream).
  if (perNodeKeyring) {
    const keyring = capNonce(bundle.keyringCap);
    const nodeCap = capNonce(bundle.nodeCap);
    const stream = capNonce(bundle.streamCap);
    saveNodeInviteEntry(spaceId, nodeId, req.userId, {
      edPub: req.edPub,
      kemPub: req.kemPub,
      caps: { ...(keyring && { keyring }), ...(nodeCap && { node: nodeCap }), ...(stream && { stream }) },
    });
  }

  return JSON.stringify(bundle);
}

/**
 * Invitee: accept a direct node invite — store the cap(s) and register access.
 * Returns the nodeId.
 */
/** Set of valid NodeInviteBundle kind discriminators. */
const VALID_INVITE_KINDS: ReadonlySet<string> = new Set(['plaintext', 'space-enc', 'node-enc']);

/** The three per-node cap tiers carried in a NodeInviteBundle, paired with their
 *  access-store writers — drives `acceptNodeInvite`'s storage fan-out so each tier is
 *  handled once. (The read-only-keyring vs read/write distinction lives in the MINTING
 *  paths, not here; storage is uniform.) */
const NODE_BUNDLE_TIERS = [
  { field: 'nodeCap', save: saveNodeAccessEntry },
  { field: 'streamCap', save: saveNodeStreamAccessEntry },
  { field: 'keyringCap', save: saveNodeKeyringAccessEntry },
] as const;

export async function acceptNodeInvite(session: Session, bundleJson: string): Promise<string> {
  const bundle = JSON.parse(bundleJson) as Partial<NodeInviteBundle>;
  if (!bundle.spaceId || !bundle.nodeId) throw new Error('Invalid node invite.');

  // Reject bundles with an unrecognised kind. Absent kind is allowed for
  // backward-compat with bundles produced before 0.12.9 (treat as 'plaintext').
  if (bundle.kind !== undefined && !VALID_INVITE_KINDS.has(bundle.kind)) {
    throw new Error(`Invalid node invite: unknown kind '${bundle.kind}'.`);
  }

  // Validate every cap that IS present was issued for this identity, BEFORE storing any
  // (so a bundle with one bad cap stores nothing). `isolated` invites omit the space cap,
  // so it's optional; but the bundle must carry at least one usable cap (space OR per-node
  // content). The space cap stores under the space tier; the three per-node caps under
  // their own tiers (content `objinv`, stream `objinvlog`, keyring `nodekeyring`).
  const assertForUs = (c: unknown, label: string): boolean =>
    assertCapForMe(c as { kind?: string; sub?: string } | undefined, session.keys.edPub, `Invalid node invite (${label}): unexpected cap kind.`, `This invite was issued for a different identity (${label}).`);

  const spaceId = bundle.spaceId; // narrowed to string by the guard above
  const nodeId = bundle.nodeId;
  const hasSpaceCap = assertForUs(bundle.cap, 'cap');
  const tierHas = NODE_BUNDLE_TIERS.map((t) => assertForUs(bundle[t.field], t.field));
  const hasNodeCap = tierHas[0]!; // nodeCap is the first per-node tier
  if (!hasSpaceCap && !hasNodeCap) throw new Error('Invalid node invite.');

  if (hasSpaceCap) saveSpaceAccessEntry(spaceId, { kind: 'member', cap: JSON.stringify(bundle.cap) });
  NODE_BUNDLE_TIERS.forEach((t, i) => {
    if (tierHas[i]) t.save(spaceId, nodeId, { kind: 'member', cap: JSON.stringify(bundle[t.field]) });
  });

  return nodeId;
}

// ── revokeNodeAccess ──────────────────────────────────────────────────────────

/**
 * Revoke a previously-issued isolated per-node-keyring invite.
 *
 * Performs full two-step eviction:
 *   1. **Revoke**: submits a signed RevocationList containing the nonces of ALL caps
 *      minted for this invitee (keyring + content + stream) so the server immediately
 *      rejects their auth tokens.
 *   2. **Rotate**: removes the invitee's KEM from the node keyring and mints a fresh
 *      CEK so they cannot decrypt future messages (forward secrecy).
 *
 * The caller is responsible for:
 *   - Tracking `generation` — it MUST strictly increase per issuer across all calls.
 *     Pass `priorRevoked` from the previous call to carry forward earlier revocations.
 *   - Providing `submitRevocation` — typically a POST to the server's `/revocations`
 *     endpoint.
 *
 * Throws when no invite entry is found for the given user (call `saveNodeInviteEntry`
 * first, or use `inviteToNode` which auto-stores entries for isolated enc nodes).
 */
export async function revokeNodeAccess(
  session: Session,
  spaceId: string,
  nodeId: string,
  userId: string,
  opts: {
    generation: number;
    priorRevoked?: RevocationEntry[];
    submitRevocation: (list: RevocationList) => Promise<void>;
  },
): Promise<{ newEpoch?: number; revoked: boolean }> {
  const invite = getNodeInviteEntry(spaceId, nodeId, userId);
  if (!invite) {
    throw new Error(`revokeNodeAccess: no stored invite for ${userId} on node ${nodeId} — call saveNodeInviteEntry or use inviteToNode (which auto-stores for isolated enc nodes)`);
  }
  if (!invite.caps.keyring) {
    throw new Error(`revokeNodeAccess: no keyring cap stored for ${userId} — only per-node-keyring (isolated enc) invites support revocation via this function`);
  }

  // Collect all non-primary cap nonces to carry alongside the primary (keyring) revocation.
  // This ensures a single RevocationList covers every access credential the invitee holds.
  const priorRevoked: RevocationEntry[] = [...(opts.priorRevoked ?? [])];
  if (invite.caps.node) {
    priorRevoked.push({ sub: invite.edPub, nonce: invite.caps.node.nonce, exp: invite.caps.node.exp });
  }
  if (invite.caps.stream) {
    priorRevoked.push({ sub: invite.edPub, nonce: invite.caps.stream.nonce, exp: invite.caps.stream.exp });
  }

  return evictKeyringMember(
    session.contentClient,
    session,
    nodeKeyringName(spaceId, nodeId),
    { sub: invite.edPub, nonce: invite.caps.keyring.nonce, exp: invite.caps.keyring.exp, subKem: invite.kemPub },
    { generation: opts.generation, priorRevoked, submitRevocation: opts.submitRevocation },
  );
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
  const { ek, userId: ephemeralUserId, subject } = await ephemeralSubject();

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
    // keyring. Ensure-first (invariant: ownerEnsureSpaceKeyring precedes addCollectionRecipient).
    await ensureSpaceKeyringRecipient(session, spaceId, recipientFor(ek.kemPub, ephemeralUserId));
  }

  let keyringCap: unknown;
  if (perNodeKeyring) {
    // PER-NODE keyring: ensure + add the ephemeral KEM as a recipient (ensure-before-add),
    // then mint a READ-only keyring cap for the link bearer.
    await ensureNodeKeyringRecipient(session, spaceId, nodeId, recipientFor(ek.kemPub, ephemeralUserId));
    keyringCap = await mintCap(session, subject, 'nodekeyring', nodeKeyringScope(spaceId, nodeId));
  }

  // Legacy space-keyring enc nodes need a space-scoped cap (to reach the space keyring);
  // plaintext / per-node-keyring nodes use the narrow per-node content cap (objinv).
  const cap = node.enc && !perNodeKeyring
    ? await mintCap(session, subject, 'content', spaceMemberScope(spaceId, write))
    : await mintCap(session, subject, 'objinv', nodeMemberScope(spaceId, nodeId, write));

  // Plaintext / per-node-keyring nodes also get a per-node STREAM cap (objinvlog) — a
  // separate single-collection member cap, authenticated by the same ephemeral key.
  let streamCap: unknown;
  if (!node.enc || perNodeKeyring) {
    streamCap = await mintCap(session, subject, 'objinvlog', nodeStreamScope(spaceId, nodeId, write));
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
