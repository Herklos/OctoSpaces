/**
 * Sealed resource-request inbox — the generic "request-to-create" pattern.
 *
 * A REQUESTER holds only the owner's **public identity link** (no authority, safe to
 * share openly). They seal a typed resource-creation request to the owner's KEM key
 * and append it anonymously to the owner's existing `inbox/{ownerId}/{shard}` collection
 * (public-write / owner-read; no new server collection needed). The OWNER's
 * reconciler trial-unseals pending requests, creates the requested node in its space
 * with its own owner cap, and seals a narrow per-node cap back to the requester's inbox.
 *
 * The round-trip:
 *
 *   REQUESTER                                           OWNER / bot
 *   ─────────                                           ────────────
 *   submitResourceRequest(ownerLink, {nodeType,…})
 *     │ seal request → anonymous append ──────────────▶ inbox/{ownerId}/{shard}
 *     │                                                  scanResourceRequests()
 *     │                                                  acceptResourceRequest()
 *     │                                                    createNode(access:'invite')
 *     │                                                    inviteToNode() → nodeMemberScope cap
 *     │                                                    seal grant → anonymous append ─┐
 *   inbox/{requesterId}/{shard} ◀──────────────────────────────────────────────────────┘
 *   scanResourceGrants()
 *   acceptResourceGrant() → acceptNodeInvite() → store nodeMemberScope cap
 *     └ open the room/page (node-only access)
 *
 * The grant-back cap is a `nodeMemberScope` — the narrowest possible: `objinv` content
 * on `spaces/{spaceId}/objects/n/{nodeId}/**` only. The requester never gets space-wide
 * access. For `enc` nodes the cap is broader (`spaceMemberScope`) because the keyring is
 * space-wide by design; for `access:'invite'+enc:false` nodes (the default for this flow)
 * the narrow per-node cap applies.
 *
 * App-specific create handlers: `acceptResourceRequest` accepts an optional `create`
 * callback that receives the raw request and must return `{ nodeId: string }`.  Without
 * it the generic `createNode` is used. OctoChat passes its ticket/room handler here;
 * OctoVault passes its page handler — same wire protocol, different node types.
 *
 * Security:
 *   - Offline binding: `verifyIdentityLinkBinding(ownerLink)` before sealing.
 *   - Sender authenticity: `sealed.entry.addedBy === req.requester.edPub`.
 *   - Accept/reject gate: owner decides; nothing lands in the space automatically.
 *   - Idempotency: nodes carry `meta.reqId`; `scanResourceRequests` skips fulfilled reqIds.
 *   - Spam: 500-item ring buffer + per-IP rate limit in the server collection; junk that
 *     doesn't unseal is skipped for free (trial-unseal never throws).
 */
import type { SealedBlob } from '../sync/account-seal.js';
import { sealToRecipient, unsealFromRecipient } from '../sync/account-seal.js';
import { inboxShard, inboxShards, pullInbox } from '../sync/inbox.js';
import { appendToInbox } from '../sync/signed-append.js';
import { verifyIdentityLinkBinding, verifyIdentityLinkKeys } from './identity-link.js';
import type { IdentityLink } from './identity-link.js';
import { createNode } from './nodes.js';
import { inviteToNode, acceptNodeInvite } from './nodes.js';
import { readObjectTree } from './object-index.js';
import { randomId } from '../core/ids.js';
import type { Session } from '../sync/identity.js';
import type { ObjectNode } from '../core/types.js';

// ── Payload types ─────────────────────────────────────────────────────────────

/** Sealed inside a requester's inbox push — "please create a node in your space". */
export interface ResourceRequest {
  v: 1;
  kind: 'create-resource';
  /** Stable id for dedup / idempotency. */
  reqId: string;
  /** Target space owned by the link owner. */
  spaceId: string;
  /** Node type string (e.g. `'room'`, `'ticket'`, `'page'`). */
  nodeType: string;
  /** Human-readable node title. */
  title: string;
  /** Optional app-specific metadata merged into the created node. */
  meta?: Record<string, unknown>;
  /** Optional human-readable message from the requester. */
  message?: string;
  /** Requester's public identity — used to mint and seal the grant-back cap. */
  requester: {
    userId: string;
    edPub: string;
    kemPub: string;
  };
}

/** Sealed inside the requester's inbox — "your request was accepted, here's your cap". */
export interface ResourceGrant {
  v: 1;
  kind: 'grant';
  /** Matches the original `ResourceRequest.reqId`. */
  reqId: string;
  /** The space containing the new node. */
  spaceId: string;
  /** The newly created node. */
  nodeId: string;
  /** Serialised `NodeInviteBundle` JSON — pass directly to `acceptNodeInvite`. */
  bundle: string;
}

/** Sealed inside the requester's inbox — "your request was rejected". */
export interface ResourceReject {
  v: 1;
  kind: 'reject';
  /** Matches the original `ResourceRequest.reqId`. */
  reqId: string;
  reason?: string;
}

/** A pending request returned by {@link scanResourceRequests}, not yet fulfilled. */
export interface PendingRequest {
  req: ResourceRequest;
  /** The sender's edPub from `sealed.entry.addedBy` — TOFU identity anchor. */
  senderEdPub: string;
}

// ── One inbox element (sealed + timestamp) ────────────────────────────────────

interface InboxPayload {
  sealed: SealedBlob;
  ts: number;
}

// ── REQUESTER: submit a request ───────────────────────────────────────────────

/** Options for {@link submitResourceRequest}. */
export interface SubmitResourceRequestOptions {
  /** Target space id (the owner's space where the node should be created). */
  spaceId: string;
  /** Node type string (e.g. `'room'`, `'ticket'`, `'page'`). */
  nodeType: string;
  /** Desired node title. */
  title: string;
  /** App-specific metadata to forward to the owner (e.g. `{ requester, priority }`). Keep small — payload must fit within 16 KB sealed. */
  meta?: Record<string, unknown>;
  /** Optional plain-text message to the owner. */
  message?: string;
}

/**
 * REQUESTER: send a sealed resource-creation request to an owner's inbox.
 *
 * 1. Verifies `ownerLink` binding offline (`ownerId === sha256(edPub)[0:32]`).
 * 2. Cross-checks the link's embedded keys against the live profile (when reachable)
 *    to detect a tampered link before sealing.
 * 3. Seals the request to `ownerLink.kemPub` (only the owner can read it).
 * 4. Appends anonymously to `inbox/{ownerId}/{shard}` (public-write, no cap needed).
 *
 * Returns the `reqId` generated for this request — save it to track fulfilment.
 * The request remains in the owner's inbox ring buffer for up to 500 items / 2 shards.
 */
export async function submitResourceRequest(
  session: Session,
  ownerLink: IdentityLink,
  opts: SubmitResourceRequestOptions,
): Promise<{ reqId: string }> {
  if (ownerLink.ownerId === session.userId) throw new Error('Cannot send a request to yourself.');

  if (!(await verifyIdentityLinkBinding(ownerLink))) {
    throw new Error('That identity link is malformed — ownerId does not match edPub.');
  }
  // Belt-and-suspenders: cross-check embedded keys against the live profile (when reachable).
  await verifyIdentityLinkKeys(ownerLink);

  const reqId = randomId();
  const request: ResourceRequest = {
    v: 1,
    kind: 'create-resource',
    reqId,
    spaceId: opts.spaceId,
    nodeType: opts.nodeType,
    title: opts.title,
    ...(opts.meta ? { meta: opts.meta } : {}),
    ...(opts.message ? { message: opts.message } : {}),
    requester: {
      userId: session.userId,
      edPub: session.keys.edPub,
      kemPub: session.keys.kemPub,
    },
  };

  // Seal the request to the owner's KEM key — only they can read it.
  const sealed = await sealToRecipient(session, ownerLink.kemPub, JSON.stringify(request));
  const element: InboxPayload = { sealed, ts: Date.now() };

  await appendToInbox(ownerLink.ownerId, inboxShard(), element as unknown as Record<string, unknown>, {
    edPubHex: session.keys.edPub,
    edPrivHex: session.keys.edPriv,
  });

  return { reqId };
}

// ── OWNER: scan pending requests ──────────────────────────────────────────────

/**
 * OWNER: scan this session's inbox for pending `create-resource` requests.
 *
 * For each unsealed request the function:
 * - Verifies the sender's identity (`sealed.entry.addedBy === req.requester.edPub`).
 * - Skips already-fulfilled requests by checking `meta.reqId` in the target space's
 *   object index (stateless dedup — no extra persistence needed).
 * - Skips requests whose `spaceId` isn't accessible to this session (best-effort,
 *   logs nothing — just filters).
 *
 * Returns requests ready to act on. Best-effort: a single corrupt element, bad
 * signature, or unreadable space never fails the whole scan.
 *
 * @param session  The owner's session (uses `session.accountClient` for inbox reads).
 * @param spaceIds Optional allow-list of space ids to accept requests for — all spaces
 *                 if omitted. Use this to restrict a reconciler to one desk space.
 */
export async function scanResourceRequests(
  session: Session,
  spaceIds?: ReadonlySet<string>,
): Promise<PendingRequest[]> {
  // Cache of already-read object trees keyed by spaceId to avoid redundant pulls.
  const treeCache = new Map<string, ObjectNode[]>();

  const out: PendingRequest[] = [];
  for (const shard of inboxShards()) {
    const items = await pullInbox(session.accountClient, session.userId, shard);
    for (const item of items) {
      const payload = item?.data as Partial<InboxPayload> | undefined;
      if (!payload?.sealed) continue;

      let plaintext: string;
      try {
        plaintext = await unsealFromRecipient(session, payload.sealed);
      } catch {
        continue; // not sealed to us or tampered — trial-unseal skip
      }

      let req: Partial<ResourceRequest>;
      try {
        req = JSON.parse(plaintext) as Partial<ResourceRequest>;
      } catch {
        continue;
      }

      if (
        req.v !== 1 ||
        req.kind !== 'create-resource' ||
        typeof req.reqId !== 'string' ||
        typeof req.spaceId !== 'string' ||
        typeof req.nodeType !== 'string' ||
        typeof req.title !== 'string' ||
        !req.requester ||
        typeof req.requester.edPub !== 'string' ||
        typeof req.requester.kemPub !== 'string' ||
        typeof req.requester.userId !== 'string'
      ) {
        continue; // not a valid resource request
      }

      // Sender-authenticity check: the sealer's edPub must match the declared identity.
      if (payload.sealed.entry.addedBy !== req.requester.edPub) {
        continue; // spoofed requester identity — skip
      }

      // Space-id allow-list (optional)
      if (spaceIds && !spaceIds.has(req.spaceId)) {
        continue;
      }

      // Dedup: skip if a node with this reqId already exists in the target space.
      if (!treeCache.has(req.spaceId)) {
        const tree = await readObjectTree(session, req.spaceId).catch(() => []);
        treeCache.set(req.spaceId, tree);
      }
      const tree = treeCache.get(req.spaceId) ?? [];
      const alreadyFulfilled = tree.some(
        (n) => (n.meta as Record<string, unknown> | undefined)?.reqId === req.reqId,
      );
      if (alreadyFulfilled) continue;

      out.push({ req: req as ResourceRequest, senderEdPub: payload.sealed.entry.addedBy });
    }
  }
  return out;
}

// ── OWNER: accept a request ───────────────────────────────────────────────────

/** Return value of an accepted {@link acceptResourceRequest}. */
export interface AcceptResult {
  spaceId: string;
  nodeId: string;
}

/**
 * OWNER: accept a pending resource request — create the node and grant the requester
 * a narrow per-node cap sealed back to their inbox.
 *
 * Default behaviour: creates a generic `access:'invite', enc:false` node via `createNode`.
 * Provide `opts.create` for app-specific node creation (e.g. a ticket with `TicketMeta`
 * or a vault page with extra structure) — your callback MUST stamp `meta.reqId` on the
 * created node so the dedup in `scanResourceRequests` works.
 *
 * The grant-back cap (`NodeInviteBundle.nodeCap`) is a `nodeMemberScope` cap covering
 * only `spaces/{spaceId}/objects/n/{nodeId}/**` — the narrowest possible grant.
 */
export async function acceptResourceRequest(
  session: Session,
  pending: PendingRequest,
  opts?: {
    /**
     * App-specific node creator. Receives the full request and must return the
     * created node's id. Must stamp `meta.reqId` for dedup to work correctly.
     */
    create?: (session: Session, req: ResourceRequest) => Promise<{ nodeId: string }>;
  },
): Promise<AcceptResult> {
  const { req } = pending;

  let nodeId: string;
  if (opts?.create) {
    ({ nodeId } = await opts.create(session, req));
  } else {
    const node = await createNode(session, req.spaceId, {
      type: req.nodeType,
      title: req.title,
      meta: { ...(req.meta ?? {}), reqId: req.reqId },
      access: 'invite',
      enc: false,
    });
    nodeId = node.id;
  }

  // Mint the invitee's cap: spaceMemberScope (index) + nodeMemberScope (objinv content).
  const bundleJson = await inviteToNode(
    session,
    req.spaceId,
    nodeId,
    JSON.stringify(req.requester),
    { enc: false },
    req.title,
  );

  // Seal the grant and deliver it to the requester's inbox.
  const grant: ResourceGrant = {
    v: 1,
    kind: 'grant',
    reqId: req.reqId,
    spaceId: req.spaceId,
    nodeId,
    bundle: bundleJson,
  };
  const sealed = await sealToRecipient(session, req.requester.kemPub, JSON.stringify(grant));
  await appendToInbox(
    req.requester.userId,
    inboxShard(),
    { sealed, ts: Date.now() } as unknown as Record<string, unknown>,
    { edPubHex: session.keys.edPub, edPrivHex: session.keys.edPriv },
  );

  return { spaceId: req.spaceId, nodeId };
}

// ── OWNER: reject a request ───────────────────────────────────────────────────

/**
 * OWNER: reject a pending request — seal a rejection and deliver it to the requester.
 * Optional: an owner may simply ignore requests they don't want to fulfil.
 */
export async function rejectResourceRequest(
  session: Session,
  pending: PendingRequest,
  reason?: string,
): Promise<void> {
  const { req } = pending;
  const rejection: ResourceReject = {
    v: 1,
    kind: 'reject',
    reqId: req.reqId,
    ...(reason ? { reason } : {}),
  };
  const sealed = await sealToRecipient(session, req.requester.kemPub, JSON.stringify(rejection));
  await appendToInbox(
    req.requester.userId,
    inboxShard(),
    { sealed, ts: Date.now() } as unknown as Record<string, unknown>,
    { edPubHex: session.keys.edPub, edPrivHex: session.keys.edPriv },
  );
}

// ── REQUESTER: scan grants ────────────────────────────────────────────────────

/**
 * REQUESTER: scan this session's own inbox for resource grants (accepted requests).
 *
 * Returns all grants this session can unseal, regardless of prior acceptance state.
 * The caller is responsible for dedup (e.g. track accepted `reqId`s in KV).
 * Grants that can't be unsealed (not for us, tampered) are silently skipped.
 */
export async function scanResourceGrants(session: Session): Promise<ResourceGrant[]> {
  const out: ResourceGrant[] = [];
  for (const shard of inboxShards()) {
    const items = await pullInbox(session.accountClient, session.userId, shard);
    for (const item of items) {
      const payload = item?.data as Partial<InboxPayload> | undefined;
      if (!payload?.sealed) continue;

      let plaintext: string;
      try {
        plaintext = await unsealFromRecipient(session, payload.sealed);
      } catch {
        continue;
      }

      let msg: Partial<ResourceGrant | ResourceReject>;
      try {
        msg = JSON.parse(plaintext) as Partial<ResourceGrant | ResourceReject>;
      } catch {
        continue;
      }

      if (msg.v !== 1 || msg.kind !== 'grant') continue;
      const g = msg as Partial<ResourceGrant>;
      if (
        typeof g.reqId !== 'string' ||
        typeof g.spaceId !== 'string' ||
        typeof g.nodeId !== 'string' ||
        typeof g.bundle !== 'string'
      ) {
        continue;
      }
      out.push(g as ResourceGrant);
    }
  }
  return out;
}

// ── REQUESTER: accept a grant ─────────────────────────────────────────────────

/**
 * REQUESTER: accept a resource grant — store the per-node cap and return the
 * node reference. After this call the requester's `getNodeAccess` / `buildNodeAccess`
 * will resolve the node for read/write.
 *
 * Delegates to {@link acceptNodeInvite} which validates `cap.sub === session.keys.edPub`
 * and stores both the space-level index cap and the narrow per-node cap.
 */
export async function acceptResourceGrant(
  session: Session,
  grant: ResourceGrant,
): Promise<{ spaceId: string; nodeId: string }> {
  const nodeId = await acceptNodeInvite(session, grant.bundle);
  return { spaceId: grant.spaceId, nodeId };
}
