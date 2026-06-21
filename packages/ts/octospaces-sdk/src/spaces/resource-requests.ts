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
import { createKeyedStore } from '../sync/keyed-store.js';
import { verifyIdentityLinkBinding, verifyIdentityLinkKeys } from './identity-link.js';
import type { IdentityLink } from './identity-link.js';
import { createNode, inviteToNode, acceptNodeInvite } from './nodes.js';
import { verifyKemSig, signKemSig } from './request-verify.js';
import { readObjectTree } from './object-index.js';
import { randomId } from '../core/ids.js';
import type { Session } from '../sync/identity.js';
import type { ObjectNode } from '../core/types.js';
import { userIdFromEdPub } from '../sync/paths.js';

/**
 * AES-GCM additional-data context binding for inbox seals.
 * Binds to the recipient, the shard, AND the message kind, preventing:
 *   - Cross-shard relocation (`2024-06` seal not replayable in `2024-07`).
 *   - Cross-kind confusion (a `reject` seal cannot open with the `grant` AAD).
 *
 * Kind-bound since 0.13. The legacy shard-only fallback (pre-0.13 seals) was dropped
 * in 0.14 — the inbox is a 500-item monthly-sharded ring buffer, so any pre-0.13 item
 * has long since been evicted. Every accepted item must now be kind-bound.
 */
const inboxAad = (recipientId: string, shard: string, kind: string) =>
  `octospaces:inbox:v1:${recipientId}:${shard}:${kind}`;

/**
 * Trial-unseal an inbox element for `session.userId` with the kind-bound AAD. Returns
 * the plaintext, or `null` when the element isn't sealed to us / is tampered / is a
 * pre-0.13 legacy seal (no longer accepted).
 */
async function tryUnsealInbox(
  session: Session,
  sealed: SealedBlob,
  shard: string,
  mkind: string | undefined,
  defaultKind: string,
): Promise<string | null> {
  try {
    return await unsealFromRecipient(session, sealed, inboxAad(session.userId, shard, mkind ?? defaultKind));
  } catch {
    return null; // not sealed to us, tampered, or legacy pre-kind-bound seal — trial-unseal skip
  }
}

/**
 * Seal `obj` to a recipient and append it to their current-shard inbox, binding
 * the kind into the AAD (`inboxAad`). Shared by submit/accept/reject — the seal
 * AAD and the append target use the SAME freshly-computed shard.
 */
async function sealAppend(
  session: Session,
  recipientUserId: string,
  recipientKemPub: string,
  kind: string,
  obj: unknown,
): Promise<void> {
  const shard = inboxShard();
  const sealed = await sealToRecipient(session, recipientKemPub, JSON.stringify(obj), inboxAad(recipientUserId, shard, kind));
  await appendToInbox(
    recipientUserId,
    shard,
    { sealed, ts: Date.now(), mkind: kind } as unknown as Record<string, unknown>,
    { edPubHex: session.keys.edPub, edPrivHex: session.keys.edPriv },
  );
}

/**
 * Generic inbox scan: walk both shards, pull each element, trial-unseal it with the
 * kind-bound AAD (falling back to legacy), JSON-parse it, and hand the parsed payload +
 * its sealed envelope to `handle`. The shared scaffold behind `scanResourceRequests` and
 * `scanResourceGrants` — only the per-item validation differs (it lives in `handle`, which
 * returns early to skip an element). Best-effort: a corrupt / unsealed / unparseable
 * element is skipped, never aborting the scan.
 */
async function scanInbox(
  session: Session,
  defaultKind: string,
  handle: (parsed: unknown, sealed: SealedBlob) => void | Promise<void>,
): Promise<void> {
  for (const shard of inboxShards()) {
    const items = await pullInbox(session.accountClient, session.userId, shard);
    for (const item of items) {
      const payload = item?.data as Partial<InboxPayload> | undefined;
      if (!payload?.sealed) continue;

      const plaintext = await tryUnsealInbox(session, payload.sealed, shard, payload.mkind, defaultKind);
      if (plaintext === null) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(plaintext);
      } catch {
        continue;
      }
      await handle(parsed, payload.sealed);
    }
  }
}

// ── Owner-store: reqId → owner edPub (sender-authenticity for scanResourceGrants) ────────────
//
// When a requester submits a request they record which owner edPub they sent it to.
// `scanResourceGrants` checks that the grant's `sealed.entry.addedBy` matches the
// recorded owner, preventing a third party from burning a reqId by forging a grant.
//
// In-memory only (module-level Map). Callers that need persistence across reloads
// should call `serializeReqIdOwnerStore()` and `hydrateReqIdOwnerStore()`.

// reqId → ownerEdPub. Kept on the raw keyed store because `scanResourceGrants` reads it
// directly by reqId (`reqIdOwnerStore.get(reqId)`); the persistence trio is plain delegation.
const reqIdOwnerStore = createKeyedStore<string>();

/** Record the owner edPub for a submitted request (called by `submitResourceRequest`). */
export const saveReqIdOwner = (reqId: string, ownerEdPub: string): void => reqIdOwnerStore.set(reqId, ownerEdPub);
/** Snapshot the store for persistence across reloads. */
export const serializeReqIdOwnerStore = reqIdOwnerStore.serialize;
/** Restore the store after a reload (additive — does not clear existing entries). */
export const hydrateReqIdOwnerStore = reqIdOwnerStore.hydrate;
/** Clear the store (e.g. on sign-out). */
export const clearReqIdOwnerStore = reqIdOwnerStore.clear;

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
    /** Ed25519 sig of kemPub by edPriv — proves kemPub ownership. */
    kemSig: string;
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
  /**
   * Cleartext message kind — used to select the matching kind-bound AAD on
   * trial-unseal. Present on seals produced by SDK ≥0.13; absent on legacy seals
   * (fall back to the shard-only AAD for backward compatibility).
   */
  mkind?: string;
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
      kemSig: signKemSig(session.keys),
    },
  };

  // Track which owner this request was sent to, enabling sender-auth on the grant.
  saveReqIdOwner(reqId, ownerLink.edPub);

  // Seal the request to the owner's KEM key — only they can read it.
  await sealAppend(session, ownerLink.ownerId, ownerLink.kemPub, 'request', request);

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
  await scanInbox(session, 'request', async (parsed, sealed) => {
    const req = parsed as Partial<ResourceRequest>;

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
      typeof req.requester.userId !== 'string' ||
      typeof req.requester.kemSig !== 'string'
    ) {
      return; // not a valid resource request
    }

    // Sender-authenticity check: the sealer's edPub must match the declared identity.
    if (sealed.entry.addedBy !== req.requester.edPub) {
      return; // spoofed requester identity — skip
    }

    // Verify the requester's userId is cryptographically derived from their edPub.
    // Without this check a requester could supply a forged userId to pollute the roster
    // (cap minting in acceptResourceRequest uses req.requester.userId as the cap subject).
    if ((await userIdFromEdPub(req.requester.edPub)) !== req.requester.userId) return;

    // Verify kemSig — Ed25519 sig of kemPub by edPriv — prevents an MITM from
    // substituting their own kemPub so they can read E2EE content sealed for the requester.
    if (!verifyKemSig(req.requester.edPub, req.requester.kemPub, req.requester.kemSig)) {
      return; // missing/invalid kemSig or malformed hex — skip
    }

    // Space-id allow-list (optional)
    if (spaceIds && !spaceIds.has(req.spaceId)) {
      return;
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
    if (alreadyFulfilled) return;

    out.push({ req: req as ResourceRequest, senderEdPub: sealed.entry.addedBy });
  });
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
 * The requester is isolated and never receives space-wide access.
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
    /** Whether to grant write access to the node. Defaults to true. */
    write?: boolean;
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

  // Mint the invitee's cap: nodeMemberScope only (isolated — never space-wide access).
  const bundleJson = await inviteToNode(
    session,
    req.spaceId,
    nodeId,
    JSON.stringify(req.requester),
    { enc: false },
    req.title,
    { isolated: true, write: opts?.write ?? true },
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
  await sealAppend(session, req.requester.userId, req.requester.kemPub, 'grant', grant);

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
  await sealAppend(session, req.requester.userId, req.requester.kemPub, 'reject', rejection);
}

// ── REQUESTER: scan grants ────────────────────────────────────────────────────

/**
 * REQUESTER: scan this session's own inbox for resource grants (accepted requests).
 *
 * Returns all grants this session can unseal that have not already been seen.
 * Grants that can't be unsealed (not for us, tampered) are silently skipped.
 *
 * @param opts.seenReqIds  Caller-provided Set for cross-scan dedup (persistent reqId
 *   tracking). Mutated in place — add to this Set before each call to skip already-
 *   accepted grants in future scans. When omitted a fresh in-memory Set is used
 *   (dedup applies only within the current call).
 */
export async function scanResourceGrants(
  session: Session,
  opts?: { seenReqIds?: Set<string> },
): Promise<ResourceGrant[]> {
  const out: ResourceGrant[] = [];
  // Use caller-provided Set (persistent cross-scan dedup) or a fresh one (in-scan only).
  const seenReqIds = opts?.seenReqIds ?? new Set<string>();
  await scanInbox(session, 'grant', (parsed, sealed) => {
    const msg = parsed as Partial<ResourceGrant | ResourceReject>;

    if (msg.v !== 1 || msg.kind !== 'grant') return;
    const g = msg as Partial<ResourceGrant>;
    if (
      typeof g.reqId !== 'string' ||
      typeof g.spaceId !== 'string' ||
      typeof g.nodeId !== 'string' ||
      typeof g.bundle !== 'string'
    ) {
      return;
    }

    // Sender-authenticity check: when we have a record of which owner edPub we sent
    // this reqId to, the grant MUST come from that owner. This prevents a third party
    // from forging a grant and burning the reqId in seenReqIds (which would cause the
    // legitimate grant to be silently skipped).
    const expectedOwnerEdPub = reqIdOwnerStore.get(g.reqId!);
    if (expectedOwnerEdPub && sealed.entry.addedBy !== expectedOwnerEdPub) {
      return; // forged sender — skip without burning the reqId
    }

    if (seenReqIds.has(g.reqId!)) return; // skip replayed/duplicate grant
    seenReqIds.add(g.reqId!);
    out.push(g as ResourceGrant);
  });
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
