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
 * Any bearer of the link stores a `{kind:'link'}` entry. Revocation = `removeSpaceMember`.
 *
 * DEVICE PAIRING: after pairing, call `addDeviceToSpaceKeyring(session, spaceId, device)`
 * for each space the paired device should decrypt. ONE keyring per space encrypts all
 * `enc` nodes; adding the device once unlocks the whole space's E2EE content.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';

import type { Space } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import {
  getSpaceAccessEntry,
  hydrateSpaceAccessStore,
  localSpaceAccessEntries,
  saveSpaceAccessEntry,
} from '../sync/space-access-store.js';
import { keyringName, keyringPull, keyringPush, spaceMemberScope, userIdFromEdPub } from '../sync/paths.js';
import { ownerEnsureKeyring } from '../sync/client.js';
import { addJoinedSpaceWithCap, addJoinedSpaceWithLinkAccess, addSpaceMember, readSpaces, updateSpacesDoc } from './registry.js';
import { sealToSelf, unsealFromSelf } from '../sync/account-seal.js';
import { toBase64Url, fromBase64Url } from '../sync/base64url.js';

export interface JoinRequest {
  edPub: string;
  kemPub: string;
  userId: string;
}

export function makeJoinRequest(session: Session): string {
  const req: JoinRequest = { edPub: session.keys.edPub, kemPub: session.keys.kemPub, userId: session.userId };
  return JSON.stringify(req);
}

function isAlreadyPresentRecipient(err: unknown): boolean {
  return err instanceof Error && /already present in epoch/.test(err.message);
}

function isKeyringMissing(err: unknown): boolean {
  return err instanceof Error && /not found|404|does not exist|no keyring exists/i.test(err.message);
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
  await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);

  // Ensure the space-wide keyring exists (creates it with only the owner if absent),
  // then add the invitee as a recipient so they can decrypt enc nodes from the start.
  // ownerEnsureKeyring is a no-op if the keyring already exists.
  await ownerEnsureKeyring(session.chatClient, session.keys, keyringPull(spaceId), keyringPush(spaceId));
  try {
    await addCollectionRecipient(
      session.chatClient,
      keyringName(spaceId),
      { subKem: req.kemPub, userId: req.userId, label: req.userId.slice(0, 8) },
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: [session.keys.edPub] },
    );
  } catch (err) {
    if (!isAlreadyPresentRecipient(err)) throw err;
  }

  // NOTE: 'chat' is the cap collection the deployed server's space-member enricher recognises.
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
    'chat',
    spaceMemberScope(spaceId, canWrite),
  );
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
  const name = inv.spaceName?.trim() || `space-${spaceId.slice(-6)}`;
  const space: Space = { id: spaceId, name, short: name.slice(0, 2).toUpperCase(), members: 1 };
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
  const base = origin.replace(/\/+$/, '');
  return `${base}/join#${toBase64Url(JSON.stringify(token))}`;
}

export function decodeSpaceInviteLink(fragment: string): SpaceInviteLinkToken {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const tok = JSON.parse(fromBase64Url(frag)) as Partial<SpaceInviteLinkToken>;
  if (!tok || !tok.spaceId || !tok.cap || !tok.key) {
    throw new Error('That space invite link is malformed or incomplete.');
  }
  return {
    v: 1,
    spaceId: tok.spaceId,
    spaceName: tok.spaceName ?? 'Space',
    cap: tok.cap,
    key: tok.key,
    kemPriv: tok.kemPriv,
    kemPub: tok.kemPub,
    write: !!tok.write,
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
  // Add the ephemeral userId to the roster so the server grants `space:member`
  await addSpaceMember(session.accountClient, spaceId, session.userId, ephemeralUserId);

  // Ensure the keyring exists, then add the ephemeral KEM so link-bearers can decrypt enc content.
  await ownerEnsureKeyring(session.chatClient, session.keys, keyringPull(spaceId), keyringPush(spaceId));
  try {
    await addCollectionRecipient(
      session.chatClient,
      keyringName(spaceId),
      { subKem: ek.kemPub, userId: ephemeralUserId, label: ephemeralUserId.slice(0, 8) },
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: [session.keys.edPub] },
    );
  } catch (err) {
    if (!isAlreadyPresentRecipient(err)) throw err;
  }

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
  const name = token.spaceName.trim() || `space-${token.spaceId.slice(-6)}`;
  const space: Space = {
    id: token.spaceId,
    name,
    short: name.slice(0, 2).toUpperCase(),
    members: 1,
  };
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
  try {
    await addCollectionRecipient(
      session.chatClient,
      keyringName(spaceId),
      { subKem: device.kemPub, userId: device.userId, label: device.userId.slice(0, 8) },
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: [session.keys.edPub] },
    );
  } catch (err) {
    if (!isAlreadyPresentRecipient(err) && !isKeyringMissing(err)) throw err;
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
      console.error('[octospaces] recoverSpaceAccess: failed to unseal', spaceId, e);
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
    console.error('[octospaces] recoverSpaceAccess: backfill failed', e);
  }
}
