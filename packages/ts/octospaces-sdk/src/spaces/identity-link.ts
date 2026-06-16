/**
 * Pure-identity link tokens — a shareable public link that carries ONLY an owner's
 * identity (userId + pseudo + Ed25519 pubkey + KEM pubkey), with no credential or
 * capability embedded.
 *
 * Unlike `SpaceInviteLinkToken` / `NodeInviteLinkToken` — which both embed an
 * ephemeral private key + cap-cert and are therefore BEARER CREDENTIALS — an
 * `IdentityLink` is safe to publish openly or embed in a client app.  Its only
 * trust anchor is the `ownerId ↔ edPub` derivation binding (verified offline via
 * `userIdFromEdPub`, hardened by a live profile key cross-check when reachable).
 *
 * Primary use: the `createResourceRequest` / `scanResourceRequests` flow in
 * `spaces/resource-requests.ts` — a requester holds only the owner's identity link
 * and delivers a sealed resource-creation request to the owner's inbox.  The owner
 * decides whether to accept or reject; no authority is delegated until then.
 *
 * The pattern mirrors OctoChat's `DmLinkToken` / `createDmViaLink` from
 * `starfish/dm-link.ts`, generalized to arbitrary `origin/path` routes (not DM-specific).
 */
import { readProfile } from '../sync/client.js';
import { toBase64Url, fromBase64Url } from '../sync/base64url.js';
import { userIdFromEdPub } from '../sync/paths.js';
import type { Session } from '../sync/identity.js';

// ── Token shape ───────────────────────────────────────────────────────────────

/**
 * Portable public identity — the only content of an identity link.
 * `pseudo` is a display hint only; KEYS are the trust anchor; `ownerId` is
 * deterministically bound to `edPub` by `userIdFromEdPub` (verified offline).
 */
export interface IdentityLink {
  v: 1;
  ownerId: string;
  pseudo: string;
  edPub: string;
  kemPub: string;
}

const OWNER_ID_RE = /^[0-9a-f]{32}$/;
const ED_PUB_RE = /^[0-9a-f]{64}$/;
/** KEM key length is suite-dependent (ML-KEM-512 → 32 bytes public); require hex. */
const KEM_PUB_RE = /^[0-9a-f]{32,}$/;

const MALFORMED = 'That identity link is malformed or incomplete.';

// ── Offline trust anchor ──────────────────────────────────────────────────────

/**
 * Verify the hard, OFFLINE binding: `token.ownerId === sha256(token.edPub)[0:32]`.
 * Call this before rendering anything about the owner and before sending any request.
 * A tampered token (wrong ownerId or edPub) fails here without a network round-trip.
 */
export async function verifyIdentityLinkBinding(token: IdentityLink): Promise<boolean> {
  return (await userIdFromEdPub(token.edPub)) === token.ownerId;
}

// ── Encode / decode ───────────────────────────────────────────────────────────

/**
 * Pack an identity link into a URL: `<origin>/<path>#<base64url(token)>`.
 * The token rides in the URL fragment — not sent to the server, not in `Referer`, not
 * in access logs. `path` should NOT include a leading slash.
 */
export function encodeIdentityLink(origin: string, path: string, token: IdentityLink): string {
  const base = origin.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${base}/${p}#${toBase64Url(JSON.stringify(token))}`;
}

/**
 * Decode + shape-check a `#…` fragment (with or without the leading `#`).
 * Synchronous shape validation only — the `ownerId ↔ edPub` binding is verified
 * asynchronously via {@link verifyIdentityLinkBinding}.
 */
export function decodeIdentityLink(fragment: string): IdentityLink {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  let tok: Partial<IdentityLink>;
  try {
    tok = JSON.parse(fromBase64Url(frag)) as Partial<IdentityLink>;
  } catch {
    throw new Error(MALFORMED);
  }
  if (
    !tok ||
    tok.v !== 1 ||
    typeof tok.ownerId !== 'string' ||
    !OWNER_ID_RE.test(tok.ownerId) ||
    typeof tok.edPub !== 'string' ||
    !ED_PUB_RE.test(tok.edPub) ||
    typeof tok.kemPub !== 'string' ||
    !KEM_PUB_RE.test(tok.kemPub)
  ) {
    throw new Error(MALFORMED);
  }
  return {
    v: 1,
    ownerId: tok.ownerId,
    pseudo: typeof tok.pseudo === 'string' ? tok.pseudo : '',
    edPub: tok.edPub,
    kemPub: tok.kemPub,
  };
}

// ── Own link ──────────────────────────────────────────────────────────────────

/**
 * Build this account's own identity link — derivable on ANY device, always the same.
 * The root device reads published keys straight from the session; a paired device
 * reads them from the (cached) public profile, like any peer would.
 *
 * Returns `null` only if the profile keys have not been published yet (brand-new
 * identity that has never synced). Call {@link ensureProfileKeys} first if needed.
 *
 * @param origin  Web app base URL (e.g. `https://app.example.com`).
 * @param path    Route fragment (e.g. `request` → `…/request#token`). No leading `/`.
 */
export async function myIdentityLink(
  session: Session,
  origin: string,
  path: string,
): Promise<string | null> {
  // Root device: keys are already on the session.
  if (session.ownerEdPub === session.keys.edPub) {
    return encodeIdentityLink(origin, path, {
      v: 1,
      ownerId: session.userId,
      pseudo: session.name,
      edPub: session.keys.edPub,
      kemPub: session.keys.kemPub,
    });
  }
  // Paired device: read published keys from the profile (same path a peer would use).
  const profile = await readProfile(session.userId);
  if (!profile.edPub || !profile.kemPub) return null;
  return encodeIdentityLink(origin, path, {
    v: 1,
    ownerId: session.userId,
    pseudo: session.name,
    edPub: profile.edPub,
    kemPub: profile.kemPub,
  });
}

// ── Verify a received token against the live profile ─────────────────────────

/**
 * Cross-check a decoded token against the owner's published profile when the server
 * is reachable. Throws if the live profile has DIFFERENT keys than the token (server
 * lying OR tampered token). Succeeds silently when the profile is unreachable —
 * server-independence is by design; the offline binding check is the primary anchor.
 */
export async function verifyIdentityLinkKeys(token: IdentityLink): Promise<void> {
  const profile = await readProfile(token.ownerId).catch(() => null);
  if (!profile) return; // unreachable — proceed on embedded keys
  if (
    (profile.edPub && profile.edPub !== token.edPub) ||
    (profile.kemPub && profile.kemPub !== token.kemPub)
  ) {
    throw new Error("This identity link doesn't match the owner's published identity keys.");
  }
}
