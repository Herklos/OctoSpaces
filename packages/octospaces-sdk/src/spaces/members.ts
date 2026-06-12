/**
 * Space membership — invite-based (member cap) and link-based (open access).
 *
 * MEMBER join: the owner records the invitee in the roster and mints a space-scoped
 * member cap. The invitee stores a `{kind:'member'}` entry. Encryption lives at the
 * per-node level — there is no space-wide keyring.
 *
 * LINK join: the owner mints an ephemeral Ed/KEM keypair whose *private* key ships
 * inside a URL-fragment token, adds the ephemeral userId to the roster so the server
 * grants `space:member`, and mints a member cap scoped to that ephemeral subject.
 * Any bearer of the link stores a `{kind:'link'}` entry. Revocation = `removeSpaceMember`.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';

import type { Space } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import {
  getSpaceAccessEntry,
  hydrateSpaceAccessStore,
  localSpaceAccessEntries,
  saveSpaceAccessEntry,
} from '../sync/space-access-store.js';
import { spaceMemberScope, userIdFromEdPub } from '../sync/paths.js';
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

interface SpaceInvite {
  spaceId: string;
  spaceName: string;
  cap: unknown;
}

/**
 * Owner: invite an identity into a space. Records them in the roster and mints a
 * space-scoped member cap. Encryption is per-node — there is no space keyring.
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
  const token: SpaceInviteLinkToken = { v: 1, spaceId, spaceName, cap, key: ek.edPriv, write };
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
  const accessPayload = { cap: token.cap, key: token.key, write: token.write };
  const sealed = await sealToSelf(session, JSON.stringify(accessPayload));
  await addJoinedSpaceWithLinkAccess(session.accountClient, session.userId, space, sealed);
  saveSpaceAccessEntry(token.spaceId, { kind: 'link', cap: token.cap, key: token.key, write: token.write });
  return space;
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
  const linkAccess: Record<string, { cap: unknown; key: string; write: boolean }> = {};
  for (const [spaceId, sealed] of Object.entries(server.pubAccess)) {
    try {
      const raw = await unsealFromSelf(session, sealed);
      const parsed = JSON.parse(raw) as { cap: unknown; key: string; write: boolean };
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
        newPubAccess[id] = await sealToSelf(session, JSON.stringify({ cap: e.cap, key: e.key, write: e.write }));
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
