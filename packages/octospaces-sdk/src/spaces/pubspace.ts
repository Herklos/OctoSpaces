/**
 * PUBLIC spaces — plaintext, cap-only spaces joined via a self-sufficient,
 * space-wide invitation link.
 *
 * Unlike a private space (E2EE keyring + encrypted `inviteToSpace` join), a public
 * space lives entirely in the plaintext `pubspaces/{ownerId}/{spaceId}/…` subtree:
 * a `_rooms` registry doc + one plaintext object-index doc per space. Access is
 * authorized purely by a member cap the owner SIGNS — no keyring.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { ObjectNode, PubAccessMap, Room, RoomKind, Space } from '../core/types.js';
import { randomId, roomSlug } from '../core/ids.js';
import { sealToSelf, unsealFromSelf } from '../sync/account-seal.js';
import type { SealedBlob } from '../sync/account-seal.js';
import { fromBase64Url, toBase64Url } from '../sync/base64url.js';
import { makeClient } from '../sync/client.js';
import type { Session } from '../sync/identity.js';
import { pubObjIndexPull, pubObjIndexPush, pubspaceRoomsPull, pubspaceRoomsPush, pubspaceScope, userIdFromEdPub } from '../sync/paths.js';
import { getPubspaceAccess, localPubspaceEntries, mergePubspaceAccess, savePubspaceAccess } from '../sync/pubspace-caps.js';
import type { AccessMap, PubspaceAccess } from '../sync/pubspace-caps.js';
import { addJoinedPublicSpaceWithAccess, addJoinedSpace, DEFAULT_CATEGORY, normalizeCategories, updateSpacesDoc } from './registry.js';

export interface PublicInviteToken {
  ownerId: string;
  spaceId: string;
  spaceName: string;
  cap: unknown;
  key: string;
  write: boolean;
}

export function encodePublicInviteLink(origin: string, token: PublicInviteToken): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/join#${toBase64Url(JSON.stringify(token))}`;
}

export function decodePublicInvite(fragment: string): PublicInviteToken {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const tok = JSON.parse(fromBase64Url(frag)) as Partial<PublicInviteToken>;
  if (!tok || !tok.ownerId || !tok.spaceId || !tok.cap || !tok.key) {
    throw new Error('That public invite link is malformed or incomplete.');
  }
  return {
    ownerId: tok.ownerId,
    spaceId: tok.spaceId,
    spaceName: tok.spaceName ?? 'Public space',
    cap: tok.cap,
    key: tok.key,
    write: !!tok.write,
  };
}

function newPublicSpaceId(): string {
  return `psp-${randomId()}`;
}

const monogram = (name: string) => name.trim().slice(0, 2).toUpperCase() || 'PS';

interface PublicRoomsDoc {
  v: 1;
  rooms: Room[];
  name?: string;
  image?: string;
  categories?: string[];
}

export const isPublicSpaceId = (spaceId: string): boolean => spaceId.startsWith('psp-');

export function publicSpaceAuth(
  session: Session,
  spaceId: string,
): { cap: unknown; signingKey: string; ownerId: string; write: boolean } {
  const access = getPubspaceAccess(spaceId);
  if (access) return { cap: access.cap, signingKey: access.key, ownerId: access.ownerId, write: access.write };
  return { cap: session.accountCap, signingKey: session.keys.edPriv, ownerId: session.userId, write: true };
}

export async function readPublicRoomsDoc(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<{ rooms: Room[]; name: string | null; image: string | null; categories: string[]; hash: string | null }> {
  const res = await client.pull(pubspaceRoomsPull(ownerId, spaceId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as Partial<PublicRoomsDoc> | undefined;
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  return {
    rooms,
    name: typeof data?.name === 'string' ? data.name : null,
    image: typeof data?.image === 'string' ? data.image : null,
    categories: normalizeCategories(rooms, data?.categories),
    hash: res?.hash ?? null,
  };
}

export async function readPublicRooms(client: StarfishClient, ownerId: string, spaceId: string): Promise<Room[]> {
  return (await readPublicRoomsDoc(client, ownerId, spaceId)).rooms;
}

export async function createPublicSpace(session: Session, name: string): Promise<Space> {
  const trimmed = name.trim() || 'Public space';
  const spaceId = newPublicSpaceId();
  const general: Room = { id: `${spaceId}-general`, spaceId, category: 'CHANNELS', name: 'general', kind: 'channel' };
  const doc: PublicRoomsDoc = { v: 1, rooms: [general], name: trimmed };
  await session.accountClient.push(
    pubspaceRoomsPush(session.userId, spaceId),
    doc as unknown as Record<string, unknown>,
    null,
  );
  const space: Space = {
    id: spaceId,
    name: trimmed,
    short: monogram(trimmed),
    members: 1,
    type: 'public',
    ownerId: session.userId,
    write: true,
  };
  await addJoinedSpace(session.accountClient, session.userId, space);
  return space;
}

export async function createPublicInvite(
  session: Session,
  spaceId: string,
  spaceName: string,
  write: boolean,
  origin: string,
): Promise<{ token: PublicInviteToken; link: string }> {
  const ek = generateDeviceKeys();
  const userIdHex = await userIdFromEdPub(ek.edPub);
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex },
    'pubspace',
    pubspaceScope(session.userId, spaceId, write),
  );
  const token: PublicInviteToken = { ownerId: session.userId, spaceId, spaceName, cap, key: ek.edPriv, write };
  return { token, link: encodePublicInviteLink(origin, token) };
}

export async function joinPublicSpace(session: Session, token: PublicInviteToken): Promise<Space> {
  const access: PubspaceAccess = { ownerId: token.ownerId, cap: token.cap, key: token.key, write: token.write };
  savePubspaceAccess(token.spaceId, access);
  const name = token.spaceName.trim() || `public-${token.spaceId.slice(-6)}`;
  const space: Space = {
    id: token.spaceId,
    name,
    short: monogram(name),
    members: 1,
    type: 'public',
    ownerId: token.ownerId,
    write: token.write,
  };
  const sealed = await sealToSelf(session, JSON.stringify(access));
  await addJoinedPublicSpaceWithAccess(session.accountClient, session.userId, space, sealed);
  return space;
}

export async function recoverPubspaceAccess(session: Session, serverPubAccess: PubAccessMap): Promise<void> {
  const recovered: AccessMap = {};
  for (const [spaceId, sealed] of Object.entries(serverPubAccess)) {
    try {
      recovered[spaceId] = JSON.parse(await unsealFromSelf(session, sealed)) as PubspaceAccess;
    } catch (e) {
      console.error('[octospaces] pubspace recover: failed to unseal', spaceId, e);
    }
  }
  mergePubspaceAccess(recovered);

  const local = localPubspaceEntries();
  const missing = Object.keys(local).filter((id) => !(id in serverPubAccess));
  if (missing.length === 0) return;
  try {
    const sealedEntries: Record<string, SealedBlob> = {};
    for (const id of missing) sealedEntries[id] = await sealToSelf(session, JSON.stringify(local[id]));
    await updateSpacesDoc(session.accountClient, session.userId, (cur) => ({
      spaces: cur.spaces,
      caps: cur.caps,
      pubAccess: { ...cur.pubAccess, ...sealedEntries },
    }));
  } catch (e) {
    console.error('[octospaces] pubspace backfill failed', e);
  }
}

export function publicSpaceClient(session: Session, spaceId: string): StarfishClient {
  const auth = publicSpaceAuth(session, spaceId);
  return makeClient(auth.cap, auth.signingKey);
}

export async function createPublicRoom(
  session: Session,
  spaceId: string,
  name: string,
  category = DEFAULT_CATEGORY,
  kind: RoomKind = 'channel',
): Promise<Room> {
  const client = session.accountClient;
  const { rooms, name: spaceName, image, categories, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
  const room: Room = {
    id: `${spaceId}-${roomSlug(name)}-${Date.now().toString(36)}`,
    spaceId,
    category,
    name,
    kind,
  };
  const nextCategories = categories.includes(category) ? categories : [...categories, category];
  const doc: PublicRoomsDoc = {
    v: 1,
    rooms: [...rooms, room],
    ...(spaceName ? { name: spaceName } : {}),
    ...(image ? { image } : {}),
    ...(nextCategories.length ? { categories: nextCategories } : {}),
  };
  await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
  return room;
}

export async function updatePublicSpaceMeta(
  session: Session,
  spaceId: string,
  meta: { name?: string | null; image?: string | null },
): Promise<void> {
  const client = session.accountClient;
  const { rooms, name: curName, image: curImage, categories, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
  const name = (meta.name === undefined ? curName : meta.name)?.trim() || undefined;
  const image = (meta.image === undefined ? curImage : meta.image) || undefined;
  const doc: PublicRoomsDoc = {
    v: 1,
    rooms,
    ...(name ? { name } : {}),
    ...(image ? { image } : {}),
    ...(categories.length ? { categories } : {}),
  };
  await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
}

export async function updatePublicRoomsRegistry(
  session: Session,
  spaceId: string,
  mutator: (cur: { rooms: Room[]; categories: string[] }) => { rooms: Room[]; categories: string[] } | null,
): Promise<void> {
  const client = session.accountClient;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { rooms, name, image, categories, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
    const next = mutator({ rooms, categories });
    if (!next) return;
    const doc: PublicRoomsDoc = {
      v: 1,
      rooms: next.rooms,
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
      ...(next.categories.length ? { categories: next.categories } : {}),
    };
    try {
      await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Headless read-modify-write of a PUBLIC space's unified OBJECT INDEX (the plaintext
 * `objects/_index` doc). The mutator returns the next `objects` array, or `null` to no-op.
 */
export async function updatePublicObjectIndex(
  session: Session,
  spaceId: string,
  mutator: (nodes: ObjectNode[], now: number) => ObjectNode[] | null,
): Promise<void> {
  const { ownerId } = publicSpaceAuth(session, spaceId);
  const client = publicSpaceClient(session, spaceId);
  const pullPath = pubObjIndexPull(ownerId, spaceId);
  const pushPath = pubObjIndexPush(ownerId, spaceId);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await client.pull(pullPath).catch(() => null);
    const cur = Array.isArray((res?.data as { objects?: unknown } | undefined)?.objects)
      ? (res!.data as { objects: ObjectNode[] }).objects
      : [];
    const next = mutator(cur, Date.now());
    if (!next) return;
    try {
      await client.push(pushPath, { objects: next }, res?.hash ?? null);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}
