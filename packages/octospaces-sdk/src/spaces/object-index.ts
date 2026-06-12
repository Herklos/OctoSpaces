/**
 * Headless reads + create-time seeding of a space's unified OBJECT INDEX.
 *
 * Both PRIVATE (encrypted) and PUBLIC (plaintext) spaces store their room/category
 * tree in `spaces/{spaceId}/objects/_index`. The `encryptor` parameter is null for
 * public spaces — the helpers pass data through unchanged.
 */
import { ConflictError } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { ObjectNode, Room, SpaceVisibility } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import { DEFAULT_CATEGORY, objectsToRoomCategories, seedIndexNodes } from '../objects/objects.js';
import type { SeedRoom } from '../objects/objects.js';
import { objIndexPull, objIndexPush } from '../sync/paths.js';
import { buildSpaceAccess, getSpaceAccess } from '../sync/space-access.js';

export type { SeedRoom };

function indexNodes(plain: Record<string, unknown>): ObjectNode[] {
  return Array.isArray((plain as { objects?: unknown }).objects)
    ? (plain as { objects: ObjectNode[] }).objects
    : [];
}

/**
 * Pull + (private: decrypt) + project a space's object index into the legacy
 * `{ rooms, categories }` shape. `encryptor` is null for a PUBLIC space.
 * Returns null on failure or an empty index.
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

/**
 * Read a space's index rooms + categories, resolving access automatically.
 * Pass `reg` (from `readRooms`) so the accessor picks the right auth mode.
 */
export async function readSpaceIndexRooms(
  session: Session,
  spaceId: string,
  reg: { owner: string | null; members: string[]; visibility?: SpaceVisibility },
): Promise<{ rooms: Room[]; categories: string[] } | null> {
  if (reg.owner === null && reg.visibility !== 'public') return null;
  try {
    const { encryptor, client } = await getSpaceAccess(spaceId, session, reg);
    return await readIndexRooms(client, encryptor, objIndexPull(spaceId), spaceId);
  } catch {
    return null;
  }
}

/** SOFT read — never throws, never mints. Returns an empty array on any failure. */
export async function readSpaceRooms(
  session: Session,
  spaceId: string,
  hint?: { visibility?: SpaceVisibility },
): Promise<Room[]> {
  const access = await buildSpaceAccess(session, spaceId, hint).catch(() => null);
  if (!access) return [];
  const idx = await readIndexRooms(access.client, access.encryptor, objIndexPull(spaceId), spaceId);
  return idx?.rooms ?? [];
}

/**
 * Write the create-time seed into a space's index doc with an already-open access handle.
 * Accepts a nullable encryptor — plaintext push when null (public spaces).
 * Idempotent: a no-op if the index doc already exists (either encrypted or plaintext).
 */
export async function pushIndexSeed(
  client: StarfishClient,
  encryptor: Encryptor | null,
  spaceId: string,
  rooms: SeedRoom[],
): Promise<void> {
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  const existing = res?.data as Record<string, unknown> | undefined;
  if (existing?._encrypted || Array.isArray(existing?.objects)) return;
  const nodes = seedIndexNodes(rooms, Date.now());
  const payload = encryptor
    ? await encryptor.encrypt({ objects: nodes }) as Record<string, unknown>
    : { objects: nodes };
  await client.push(objIndexPush(spaceId), payload, res?.hash ?? null);
}

/**
 * Seed a brand-new space's index as the OWNER.
 * For private spaces: opens (minting if needed) the space keyring.
 * For public spaces: pushes plaintext nodes.
 */
export async function seedSpaceObjectIndex(
  session: Session,
  spaceId: string,
  rooms: SeedRoom[],
  opts?: { visibility?: SpaceVisibility },
): Promise<void> {
  const { encryptor, client } = await getSpaceAccess(spaceId, session, {
    owner: session.userId,
    members: [],
    visibility: opts?.visibility,
  });
  await pushIndexSeed(client, encryptor, spaceId, rooms);
}

/**
 * Headless read-modify-write of a space's unified OBJECT INDEX. Works for both
 * private (encrypt round-trip) and public (plaintext) spaces. Retries up to 3 times
 * on ConflictError.
 */
export async function updateObjectIndex(
  session: Session,
  spaceId: string,
  mutator: (nodes: ObjectNode[], now: number) => ObjectNode[] | null,
  reg?: { owner: string | null; members: string[]; visibility?: SpaceVisibility } | null,
): Promise<void> {
  const { client, encryptor } = await getSpaceAccess(spaceId, session, reg ?? null);
  const pullPath = objIndexPull(spaceId);
  const pushPath = objIndexPush(spaceId);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await client.pull(pullPath).catch(() => null);
    const raw = res?.data as Record<string, unknown> | undefined;
    const plain = raw
      ? encryptor
        ? await encryptor.decrypt(raw)
        : raw
      : {};
    const cur = Array.isArray((plain as { objects?: unknown }).objects)
      ? (plain as { objects: ObjectNode[] }).objects
      : [];
    const next = mutator(cur, Date.now());
    if (!next) return;
    const payload = encryptor
      ? await encryptor.encrypt({ objects: next }) as Record<string, unknown>
      : { objects: next };
    try {
      await client.push(pushPath, payload, res?.hash ?? null);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}
