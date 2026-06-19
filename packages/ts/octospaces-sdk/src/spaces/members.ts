/**
 * Space membership — invite-based (member cap) and link-based (open access).
 *
 * MEMBER join: the owner records the invitee in the roster, mints a space-scoped
 * member cap, and adds the invitee to the space-wide keyring (if it exists) so they
 * can decrypt `enc` content. The invitee stores a `{kind:'member'}` entry.
 *
 * LINK join: the owner mints an ephemeral Ed/KEM keypair whose *private* key ships
 * inside a URL-fragment token, adds the ephemeral userId to the roster so the server
 * grants `space:member`, and mints a member cap scoped to that ephemeral subject.
 * Any bearer of the link stores a `{kind:'link'}` entry.
 *
 * REVOCATION (roster-only): `removeSpaceMember` removes the userId from the server
 * roster so the server stops granting `space:member` to new requests. This alone is
 * sufficient for non-encrypted spaces. For `enc` spaces call `revokeSpaceAccess`
 * instead — it rotates the space keyring (forward secrecy) AND submits a signed
 * RevocationList so the server immediately rejects the evicted member's cap.
 *
 * DEVICE PAIRING: after pairing, call `addDeviceToSpaceKeyring(session, spaceId, device)`
 * for each space the paired device should decrypt. ONE keyring per space encrypts all
 * `enc` nodes; adding the device once unlocks the whole space's E2EE content.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { hexToBytes, bytesToHex } from '@drakkar.software/starfish-keyring';
import { mintMemberCap, evictMember } from '@drakkar.software/starfish-sharing';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { CapCert, RevocationEntry, RevocationList } from '@drakkar.software/starfish-protocol';

import type { Space } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import { ownerTrustedAdders } from '../sync/identity.js';
import {
  hydrateSpaceAccessStore,
  localSpaceAccessEntries,
  saveSpaceAccessEntry,
} from '../sync/space-access-store.js';
import { keyringName, RECIPIENT_LABEL_LEN, spaceMemberScope, userIdFromEdPub } from '../sync/paths.js';
import { addSpaceKeyringRecipient, ensureSpaceKeyringRecipient, isKeyringMissing } from '../sync/client.js';
import { addJoinedSpaceWithCap, addJoinedSpaceWithLinkAccess, addSpaceMember, buildSpace, readSpaces, updateSpacesDoc, removeSpaceMember } from './registry.js';
import { sealToSelf, unsealFromSelf } from '../sync/account-seal.js';
import { encodeLinkFragment, decodeLinkFragment } from '../sync/link-token.js';
import { createKeyedStore } from '../sync/keyed-store.js';

export interface JoinRequest {
  edPub: string;
  kemPub: string;
  userId: string;
  /** Ed25519 signature of kemPub bytes by edPriv — proves kemPub ownership. */
  kemSig: string;
}

export function makeJoinRequest(session: Session): string {
  const kemSig = bytesToHex(ed25519.sign(hexToBytes(session.keys.kemPub), hexToBytes(session.keys.edPriv)));
  const req: JoinRequest = { edPub: session.keys.edPub, kemPub: session.keys.kemPub, userId: session.userId, kemSig };
  return JSON.stringify(req);
}

// ── Space invite store (nonces for full eviction) ─────────────────────────────
//
// When the owner issues a space invite (`inviteToSpace` or `createSpaceInviteLink`)
// they retain `{edPub, kemPub, cap nonce, exp}` here so `revokeSpaceAccess` can
// later revoke the cap AND rotate the space keyring in a single operation.
//
// This store is in-memory (module-level Map). It survives the current JS execution
// context but is cleared on reload. Callers that need persistence across reloads
// should call `serializeSpaceInviteStore()` and `hydrateSpaceInviteStore()`.

export interface StoredSpaceInvite {
  edPub: string;
  kemPub: string;
  /** Retained cap nonce + expiry for the space member cap (`spaceMemberScope`). */
  cap: { nonce: string; exp: number };
}

const spaceInviteStore = createKeyedStore<StoredSpaceInvite>(); // `${spaceId}:${userId}` → invite

/** Save an invite entry for future revocation. Called internally by `inviteToSpace` / `createSpaceInviteLink`. */
export function saveSpaceInviteEntry(spaceId: string, userId: string, entry: StoredSpaceInvite): void {
  spaceInviteStore.set(`${spaceId}:${userId}`, entry);
}

/** Retrieve a stored invite entry. Returns null when absent. */
export function getSpaceInviteEntry(spaceId: string, userId: string): StoredSpaceInvite | null {
  return spaceInviteStore.get(`${spaceId}:${userId}`);
}

/** Clear all entries (e.g. on sign-out). */
export function clearSpaceInviteStore(): void {
  spaceInviteStore.clear();
}

/** Snapshot the store for persistence across reloads. */
export function serializeSpaceInviteStore(): Array<[string, StoredSpaceInvite]> {
  return spaceInviteStore.serialize();
}

/** Restore the store after a reload (additive — does not clear existing entries). */
export function hydrateSpaceInviteStore(entries: Array<[string, StoredSpaceInvite]>): void {
  spaceInviteStore.hydrate(entries);
}

interface SpaceInvite {
  spaceId: string;
  spaceName: string;
  cap: unknown;
}

/**
 * Owner: invite an identity into a space. Records them in the roster, mints a
 * space-scoped member cap, and adds them to the space-wide keyring if it exists
 * (so they can decrypt `enc` nodes from the start).
 * Returns the invite bundle JSON.
 */
export async function inviteToSpace(
  session: Session,
  spaceId: string,
  requestJson: string,
  canWrite = true,
  spaceName?: string,
): Promise<string> {
  const req = JSON.parse(requestJson) as JoinRequest;
  if (!req.edPub || !req.kemPub || !req.userId) throw new Error('That is not a valid join request.');
  // Reject requests whose claimed userId doesn't derive from their edPub.
  if ((await userIdFromEdPub(req.edPub)) !== req.userId) {
    throw new Error('That is not a valid join request: userId does not match edPub.');
  }
  // Verify kemSig — Ed25519 sig of kemPub by edPriv — proves the requester
  // actually owns the private key for edPub and created kemPub (prevents KEM-key substitution).
  let kemSigValid = false;
  try {
    kemSigValid = !!req.kemSig && ed25519.verify(hexToBytes(req.kemSig), hexToBytes(req.kemPub), hexToBytes(req.edPub));
  } catch { /* malformed hex — treat as invalid */ }
  if (!kemSigValid) {
    throw new Error('That is not a valid join request: kemSig is missing or invalid.');
  }
  await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);

  // Ensure the space-wide keyring exists (creates it with only the owner if absent),
  // then add the invitee as a recipient so they can decrypt enc nodes from the start.
  await ensureSpaceKeyringRecipient(session, spaceId, { subKem: req.kemPub, userId: req.userId, label: req.userId.slice(0, RECIPIENT_LABEL_LEN) });

  // NOTE: 'chat' is the cap collection the deployed server's space-member enricher recognises.
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
    'chat',
    spaceMemberScope(spaceId, canWrite),
  );
  // Retain the cap nonce so `revokeSpaceAccess` can revoke it later.
  const capCert = cap as CapCert | undefined;
  if (capCert?.nonce) {
    saveSpaceInviteEntry(spaceId, req.userId, { edPub: req.edPub, kemPub: req.kemPub, cap: { nonce: capCert.nonce, exp: capCert.exp } });
  }
  let name = spaceName?.trim();
  if (!name) {
    const { spaces } = await readSpaces(session.accountClient, session.userId);
    name = spaces.find((s) => s.id === spaceId)?.name ?? 'Space';
  }
  const invite: SpaceInvite = { spaceId, spaceName: name, cap };
  return JSON.stringify(invite);
}

/**
 * Invitee: accept a space invite — store the cap and register the space.
 * Returns the joined space.
 */
export async function acceptSpaceInvite(session: Session, inviteJson: string): Promise<Space> {
  const inv = JSON.parse(inviteJson) as Partial<SpaceInvite>;
  const cap = inv.cap as { kind?: string; sub?: string } | undefined;
  if (!cap || !inv.spaceId) throw new Error('That is not a valid space invite.');
  if (cap.kind !== 'member') throw new Error('That is not a valid space invite.');
  if (!cap.sub || cap.sub !== session.keys.edPub) {
    throw new Error('This invite was issued for a different identity.');
  }
  const spaceId = inv.spaceId;
  const capJson = JSON.stringify(cap);
  const space = buildSpace(spaceId, inv.spaceName ?? '');
  await addJoinedSpaceWithCap(session.accountClient, session.userId, space, capJson);
  saveSpaceAccessEntry(spaceId, { kind: 'member', cap: capJson });
  return space;
}

// ── Link-based joins (public spaces) ─────────────────────────────────────────

/** A space invite link token (v:1, no ownerId — derive from cap.iss instead). */
export interface SpaceInviteLinkToken {
  v: 1;
  spaceId: string;
  spaceName: string;
  cap: unknown;
  /** The throwaway ephemeral subject's Ed25519 private key (hex). */
  key: string;
  /**
   * The throwaway ephemeral subject's X25519 KEM private key (hex) — needed to
   * decrypt the space keyring. Absent in legacy tokens (pre-0.8.6); fall back to
   * session keys in that case (produces the same SpaceAccessError as before).
   */
  kemPriv?: string;
  /**
   * The throwaway ephemeral subject's X25519 KEM public key (hex) — identifies
   * this token's recipient entry in the space keyring.
   */
  kemPub?: string;
  write: boolean;
}

export function encodeSpaceInviteLink(origin: string, token: SpaceInviteLinkToken): string {
  return encodeLinkFragment(origin, 'join', token);
}

export function decodeSpaceInviteLink(fragment: string): SpaceInviteLinkToken {
  const raw = decodeLinkFragment<{ spaceId: string; cap: unknown; key: string } & Partial<SpaceInviteLinkToken>>(
    fragment,
    (tok): tok is { spaceId: string; cap: unknown; key: string } & Partial<SpaceInviteLinkToken> =>
      !!tok && typeof tok.spaceId === 'string' && !!tok.cap && typeof tok.key === 'string',
    'That space invite link is malformed or incomplete.',
  );
  return {
    v: 1,
    spaceId: raw.spaceId,
    spaceName: raw.spaceName ?? 'Space',
    cap: raw.cap,
    key: raw.key,
    kemPriv: raw.kemPriv,
    kemPub: raw.kemPub,
    write: !!raw.write,
  };
}

/**
 * Owner: create a shareable invite link for a PUBLIC space.
 *
 * Mints an ephemeral Ed/KEM keypair, adds its userId to the roster (so the server
 * grants `space:member` to any bearer), and encodes the private key + cap in the URL.
 * Anyone with the link can join; revoke by calling `removeSpaceMember(ephemeralUserId)`.
 */
export async function createSpaceInviteLink(
  session: Session,
  spaceId: string,
  spaceName: string,
  write: boolean,
  origin: string,
): Promise<{ token: SpaceInviteLinkToken; link: string }> {
  const ek = generateDeviceKeys();
  const ephemeralUserId = await userIdFromEdPub(ek.edPub);
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex: ephemeralUserId },
    'chat',
    spaceMemberScope(spaceId, write),
  );
  // Retain the cap nonce so `revokeSpaceAccess` can revoke the link's ephemeral cap later.
  const capCert = cap as CapCert | undefined;
  if (capCert?.nonce) {
    saveSpaceInviteEntry(spaceId, ephemeralUserId, { edPub: ek.edPub, kemPub: ek.kemPub, cap: { nonce: capCert.nonce, exp: capCert.exp } });
  }
  // Add the ephemeral userId to the roster so the server grants `space:member`
  await addSpaceMember(session.accountClient, spaceId, session.userId, ephemeralUserId);

  // Ensure the keyring exists, then add the ephemeral KEM so link-bearers can decrypt enc content.
  await ensureSpaceKeyringRecipient(session, spaceId, { subKem: ek.kemPub, userId: ephemeralUserId, label: ephemeralUserId.slice(0, RECIPIENT_LABEL_LEN) });

  const token: SpaceInviteLinkToken = {
    v: 1, spaceId, spaceName, cap, key: ek.edPriv, kemPriv: ek.kemPriv, kemPub: ek.kemPub, write,
  };
  return { token, link: encodeSpaceInviteLink(origin, token) };
}

/**
 * Any user: join a space by redeeming an invite link token.
 * Stores the link credential locally and seals it into the synced `_spaces` doc.
 */
export async function joinSpaceByLink(session: Session, token: SpaceInviteLinkToken): Promise<Space> {
  const space = buildSpace(token.spaceId, token.spaceName);
  const accessPayload = { cap: token.cap, key: token.key, kemPriv: token.kemPriv, kemPub: token.kemPub, write: token.write };
  const sealed = await sealToSelf(session, JSON.stringify(accessPayload));
  await addJoinedSpaceWithLinkAccess(session.accountClient, session.userId, space, sealed);
  saveSpaceAccessEntry(token.spaceId, {
    kind: 'link', cap: token.cap, key: token.key, kemPriv: token.kemPriv, kemPub: token.kemPub, write: token.write,
  });
  return space;
}

/**
 * Add a device's KEM key as a recipient of a space's keyring.
 *
 * Call this after device pairing (for each space the new device should be able to
 * decrypt). ONE space keyring encrypts ALL the space's `enc` nodes — adding the device
 * once unlocks the whole space's E2EE content. Silently a no-op if the keyring doesn't
 * exist yet.
 */
export async function addDeviceToSpaceKeyring(
  session: Session,
  spaceId: string,
  device: { kemPub: string; edPub: string; userId: string },
): Promise<void> {
  // Delegate to addSpaceKeyringRecipient (handles isAlreadyPresentRecipient internally).
  // Swallow isKeyringMissing separately — owner may not have created E2EE yet for this space.
  // INVARIANT: must NOT call ownerEnsureKeyring here (device pairing ≠ owner flow).
  try {
    await addSpaceKeyringRecipient(session, spaceId, {
      subKem: device.kemPub,
      userId: device.userId,
      label: device.userId.slice(0, RECIPIENT_LABEL_LEN),
    });
  } catch (err) {
    if (!isKeyringMissing(err)) throw err;
  }
}

/**
 * Single sign-in hydration: merges server-side caps (plaintext member caps from
 * `_spaces.caps`) and sealed link access (from `_spaces.pubAccess`) into the
 * unified space-access store. Call once on sign-in / account switch.
 * Backfills any local-only entries to the server.
 */
export async function recoverSpaceAccess(
  session: Session,
  server: { caps: Record<string, string>; pubAccess: Record<string, import('../sync/account-seal.js').SealedBlob> },
): Promise<void> {
  // Unseal link access blobs
  const linkAccess: Record<string, { cap: unknown; key: string; kemPriv?: string; kemPub?: string; write: boolean }> = {};
  for (const [spaceId, sealed] of Object.entries(server.pubAccess)) {
    try {
      const raw = await unsealFromSelf(session, sealed);
      const parsed = JSON.parse(raw) as { cap: unknown; key: string; kemPriv?: string; kemPub?: string; write: boolean };
      if (parsed.cap && parsed.key) linkAccess[spaceId] = parsed;
    } catch (e) {
      console.error('[octospaces] recoverSpaceAccess: failed to unseal', spaceId, (e instanceof Error ? e.message : String(e)));
    }
  }

  await hydrateSpaceAccessStore(session.userId, server.caps, linkAccess);

  // Backfill local-only entries to the server
  const local = localSpaceAccessEntries();
  const missingMemberCaps = Object.entries(local)
    .filter(([id, e]) => e.kind === 'member' && !(id in server.caps));
  const missingLinks = Object.entries(local)
    .filter(([id, e]) => e.kind === 'link' && !(id in server.pubAccess));

  if (missingMemberCaps.length === 0 && missingLinks.length === 0) return;

  try {
    const newCaps: Record<string, string> = {};
    for (const [id, e] of missingMemberCaps) if (e.kind === 'member') newCaps[id] = e.cap;

    const newPubAccess: Record<string, import('../sync/account-seal.js').SealedBlob> = {};
    for (const [id, e] of missingLinks) {
      if (e.kind === 'link') {
        newPubAccess[id] = await sealToSelf(session, JSON.stringify({ cap: e.cap, key: e.key, kemPriv: e.kemPriv, kemPub: e.kemPub, write: e.write }));
      }
    }

    await updateSpacesDoc(session.accountClient, session.userId, (cur) => ({
      spaces: cur.spaces,
      caps: { ...cur.caps, ...newCaps },
      pubAccess: { ...cur.pubAccess, ...newPubAccess },
    }));
  } catch (e) {
    console.error('[octospaces] recoverSpaceAccess: backfill failed', (e instanceof Error ? e.message : String(e)));
  }
}

// ── Space-tier full eviction ──────────────────────────────────────────────────

/**
 * Fully evict a space member — the space-tier equivalent of `revokeNodeAccess`.
 *
 * Performs two cryptographic steps in order:
 *   1. **Cap revocation** — builds a signed `RevocationList` for the member's
 *      `spaceMemberScope` cap and submits it via `opts.submitRevocation`. The server
 *      rejects subsequent authenticated requests from the evicted member's cap.
 *   2. **Keyring rotation** (forward secrecy) — removes the member's KEM from the
 *      space-wide keyring and mints a fresh CEK so they cannot decrypt future `enc`
 *      content. Members who already hold the old CEK keep read access to already-
 *      stored content, but not to anything sealed after the rotation.
 *   3. **Roster removal** — removes the userId from the `_access.members` roster so
 *      the server stops granting `space:member` on new requests.
 *
 * Throws when no invite entry exists for `userId` in `spaceId` — call
 * `saveSpaceInviteEntry` on the issuing device before using this function.
 *
 * @param opts.generation  MUST be strictly greater than any prior generation submitted
 *   by this issuer (`session.keys.edPub`). The server rejects out-of-order lists.
 * @param opts.priorRevoked  Earlier `RevocationEntry` items to carry in the same list
 *   (avoids a separate submission for each eviction).
 * @param opts.submitRevocation  HTTP transport for the `RevocationList` — typically
 *   a POST to `${syncBase}${syncPrefix}/revocations`.
 */
export async function revokeSpaceAccess(
  session: Session,
  spaceId: string,
  userId: string,
  opts: {
    generation: number;
    priorRevoked?: RevocationEntry[];
    submitRevocation: (list: RevocationList) => Promise<void>;
  },
): Promise<{ revoked: boolean }> {
  const invite = spaceInviteStore.get(`${spaceId}:${userId}`);
  if (!invite) {
    throw new Error(
      `revokeSpaceAccess: no stored invite for ${userId} on space ${spaceId} — call saveSpaceInviteEntry or use inviteToSpace / createSpaceInviteLink (which auto-store the entry)`,
    );
  }

  const priorRevoked: RevocationEntry[] = [...(opts.priorRevoked ?? [])];

  // Evict from the space keyring (rotate + revoke cap in one operation).
  await evictMember(
    session.chatClient,
    {
      keyringCollection: keyringName(spaceId),
      membersCollection: keyringName(spaceId),
      member: {
        sub: invite.edPub,
        nonce: invite.cap.nonce,
        exp: invite.cap.exp,
        subKem: invite.kemPub,
      },
      adder: {
        edPriv: session.keys.edPriv,
        edPub: session.keys.edPub,
        kemPriv: session.keys.kemPriv,
      },
      trustedAdders: ownerTrustedAdders(session),
      issEdPubHex: session.keys.edPub,
      issEdPrivHex: session.keys.edPriv,
      generation: opts.generation,
      ...(priorRevoked.length > 0 ? { priorRevoked } : {}),
      submitRevocation: opts.submitRevocation,
    },
    { rotate: true, revoke: true },
  );

  // Remove from the server roster (caps + keyring eviction do the cryptographic work;
  // this prevents the server from granting new `space:member` tokens).
  await removeSpaceMember(session.accountClient, spaceId, userId);

  return { revoked: true };
}
