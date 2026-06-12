/**
 * Headless (no-React) reads + create-time seeding of a space's unified OBJECT INDEX —
 * the encrypted `objects/_index` doc that is the SOLE source of a space's room/category
 * list (the `_rooms` doc keeps only the owner/members access record + the shared
 * name/image). The reactive equivalent is `useObjects`; this module is what the
 * non-React consumers use.
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { ObjectNode, Room } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import { DEFAULT_CATEGORY, objectsToRoomCategories, seedIndexNodes } from '../objects/objects.js';
import type { SeedRoom } from '../objects/objects.js';
import { objIndexPull, objIndexPush, pubObjIndexPull } from '../sync/paths.js';
import { buildSpaceEncryptor, getSpaceEncryptor } from '../sync/space-encryptor.js';

export type { SeedRoom };

function indexNodes(plain: Record<string, unknown>): ObjectNode[] {
  return Array.isArray((plain as { objects?: unknown }).objects)
    ? (plain as { objects: ObjectNode[] }).objects
    : [];
}

/**
 * Pull + (private: decrypt) + project a space's object index into the legacy
 * `{ rooms, categories }` shape. `encryptor` is null for a PUBLIC space and the
 * space encryptor for a PRIVATE one. Returns null on any failure or an empty index.
 */
export async function readIndexRooms(
  client: StarfishClient,
  encryptor: Encryptor | null,
  indexPath: string,
  spaceId: string,
): Promise<{ rooms: Room[]; categories: string[] } | null> {
  try {
    const res = await client.pull(indexPath).catch(() => null);
    if (!res?.data) return null;
    const plain = encryptor
      ? await encryptor.decrypt(res.data as Record<string, unknown>)
      : (res.data as Record<string, unknown>);
    const cats = objectsToRoomCategories(indexNodes(plain), spaceId, DEFAULT_CATEGORY);
    if (!cats) return null;
    return { rooms: cats.flatMap((c) => c.rooms), categories: cats.map((c) => c.name) };
  } catch {
    return null;
  }
}

/** Read a PUBLIC space's index rooms (plaintext — no encryptor) given a known owner id. */
export async function readPublicIndexRooms(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<Room[]> {
  const idx = await readIndexRooms(client, null, pubObjIndexPull(ownerId, spaceId), spaceId);
  return idx?.rooms ?? [];
}

/** Read a PRIVATE space's index rooms + categories given a KNOWN owner/members access record. */
export async function readPrivateIndexRooms(
  session: Session,
  spaceId: string,
  owner: string | null,
  members: string[],
): Promise<{ rooms: Room[]; categories: string[] } | null> {
  if (owner === null) return null;
  try {
    const { encryptor, client } = await getSpaceEncryptor(spaceId, session, { owner, members });
    return await readIndexRooms(client, encryptor, objIndexPull(spaceId), spaceId);
  } catch {
    return null;
  }
}

/** SOFT read a PRIVATE space's index rooms for a read-only consumer. */
export async function readPrivateSpaceRooms(session: Session, spaceId: string): Promise<Room[]> {
  const space = await buildSpaceEncryptor(session, spaceId).catch(() => null);
  if (!space) return [];
  const idx = await readIndexRooms(space.client, space.enc, objIndexPull(spaceId), spaceId);
  return idx?.rooms ?? [];
}

/**
 * Write the create-time seed into a space's index doc with an already-open encryptor.
 * Idempotent: a no-op if the index doc already exists.
 */
export async function pushIndexSeed(
  client: StarfishClient,
  encryptor: Encryptor,
  spaceId: string,
  rooms: SeedRoom[],
): Promise<void> {
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  if (res?.data && (res.data as Record<string, unknown>)._encrypted) return;
  const sealed = await encryptor.encrypt({ objects: seedIndexNodes(rooms, Date.now()) });
  await client.push(objIndexPush(spaceId), sealed as Record<string, unknown>, res?.hash ?? null);
}

/**
 * Seed a brand-new PRIVATE space's index as the OWNER: open (minting, if needed) the
 * space keyring and push the encrypted seed nodes.
 */
export async function seedSpaceObjectIndex(session: Session, spaceId: string, rooms: SeedRoom[]): Promise<void> {
  const { encryptor, client } = await getSpaceEncryptor(spaceId, session, { owner: session.userId, members: [] });
  await pushIndexSeed(client, encryptor, spaceId, rooms);
}
