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
import { encodeLinkFragment, decodeLinkFragment } from '../sync/link-token.js';
import { userIdFromEdPub } from '../sync/paths.js';
import type { Session } from '../sync/identity.js';
import { hexToBytes, bytesToHex } from '@drakkar.software/starfish-keyring';
import { ed25519 } from '@noble/curves/ed25519.js';

// ── Token shape ───────────────────────────────────────────────────────────────

/**
 * Portable public identity — the only content of an identity link.
 * `pseudo` is a display hint only; KEYS are the trust anchor; `ownerId` is
 * deterministically bound to `edPub` by `userIdFromEdPub` (verified offline).
 * `kemSig` is an Ed25519 signature of kemPub bytes by edPriv, binding kemPub
 * to edPub in a way that can be verified offline without a server round-trip.
 */
export interface IdentityLink {
  v: 2;
  ownerId: string;
  pseudo: string;
  edPub: string;
  kemPub: string;
  kemSig: string; // Ed25519 sig of hexToBytes(kemPub) by edPriv
}

const OWNER_ID_RE = /^[0-9a-f]{32}$/;
const ED_PUB_RE = /^[0-9a-f]{64}$/;
/** X25519 KEM public key: 32 bytes = 64 hex chars. */
const KEM_PUB_RE = /^[0-9a-f]{64}$/;
/** Ed25519 signature: 64 bytes = 128 hex chars. */
const KEM_SIG_RE = /^[0-9a-f]{128}$/;

const MALFORMED = 'That identity link is malformed or incomplete.';

// ── Offline trust anchor ──────────────────────────────────────────────────────

/**
 * Verify the hard, OFFLINE binding:
 *   1. `token.ownerId === sha256(token.edPub)[0:32]`
 *   2. `token.kemSig` is a valid Ed25519 signature of `kemPub` bytes by `edPub`
 * Call this before rendering anything about the owner and before sending any request.
 * A tampered token (wrong ownerId, edPub, kemPub, or kemSig) fails here without a network round-trip.
 */
export async function verifyIdentityLinkBinding(token: IdentityLink): Promise<boolean> {
  const ownerIdMatch = (await userIdFromEdPub(token.edPub)) === token.ownerId;
  if (!ownerIdMatch) return false;
  try {
    return ed25519.verify(hexToBytes(token.kemSig), hexToBytes(token.kemPub), hexToBytes(token.edPub));
  } catch {
    return false;
  }
}

// ── Encode / decode ───────────────────────────────────────────────────────────

/**
 * Pack an identity link into a URL: `<origin>/<path>#<base64url(token)>`.
 * The token rides in the URL fragment — not sent to the server, not in `Referer`, not
 * in access logs. `path` should NOT include a leading slash.
 */
export function encodeIdentityLink(origin: string, path: string, token: IdentityLink): string {
  return encodeLinkFragment(origin, path, token);
}

/**
 * Decode + shape-check a `#…` fragment (with or without the leading `#`).
 * Synchronous shape validation only — the `ownerId ↔ edPub` binding and kemSig
 * are verified asynchronously via {@link verifyIdentityLinkBinding}.
 * Rejects v:1 links (clean break — callers must re-publish with v:2).
 */
export function decodeIdentityLink(fragment: string): IdentityLink {
  const raw = decodeLinkFragment<Partial<IdentityLink>>(
    fragment,
    (tok): tok is Partial<IdentityLink> =>
      !!tok &&
      tok.v === 2 &&
      typeof tok.ownerId === 'string' &&
      OWNER_ID_RE.test(tok.ownerId) &&
      typeof tok.edPub === 'string' &&
      ED_PUB_RE.test(tok.edPub) &&
      typeof tok.kemPub === 'string' &&
      KEM_PUB_RE.test(tok.kemPub) &&
      typeof tok.kemSig === 'string' &&
      KEM_SIG_RE.test(tok.kemSig),
    MALFORMED,
  );
  return {
    v: 2,
    ownerId: raw.ownerId!,
    pseudo: typeof raw.pseudo === 'string' ? raw.pseudo : '',
    edPub: raw.edPub!,
    kemPub: raw.kemPub!,
    kemSig: raw.kemSig!,
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
  // Root device: keys are already on the session — compute kemSig locally.
  if (session.ownerEdPub === session.keys.edPub) {
    const kemSig = bytesToHex(ed25519.sign(hexToBytes(session.keys.kemPub), hexToBytes(session.keys.edPriv)));
    return encodeIdentityLink(origin, path, {
      v: 2,
      ownerId: session.userId,
      pseudo: session.name,
      edPub: session.keys.edPub,
      kemPub: session.keys.kemPub,
      kemSig,
    });
  }
  // Paired device: read published keys + kemSig from the profile (same path a peer would use).
  const profile = await readProfile(session.userId);
  if (!profile.edPub || !profile.kemPub || !profile.kemSig) return null;
  return encodeIdentityLink(origin, path, {
    v: 2,
    ownerId: session.userId,
    pseudo: session.name,
    edPub: profile.edPub,
    kemPub: profile.kemPub,
    kemSig: profile.kemSig,
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
