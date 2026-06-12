/**
 * Headless reads + create-time seeding of a space's unified OBJECT INDEX.
 *
 * Both PRIVATE (encrypted) and PUBLIC (plaintext) spaces store their object tree
 * in `spaces/{spaceId}/objects/_index`. The `encryptor` parameter is null for
 * public spaces — the helpers pass data through unchanged.
 */
import { ConflictError } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { ObjectNode, SpaceVisibility } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import { objIndexPull, objIndexPush } from '../sync/paths.js';
import { getSpaceAccess } from '../sync/space-access.js';

function indexNodes(plain: Record<string, unknown>): ObjectNode[] {
  return Array.isArray((plain as { objects?: unknown }).objects)
    ? (plain as { objects: ObjectNode[] }).objects
    : [];
}

/**
 * Write the create-time seed into a space's index doc with an already-open access handle.
 * Accepts a nullable encryptor — plaintext push when null (public spaces).
 * Idempotent: a no-op if the index doc already exists (either encrypted or plaintext).
 * Pass `nodes` to seed with initial objects; defaults to an empty index.
 */
export async function pushIndexSeed(
  client: StarfishClient,
  encryptor: Encryptor | null,
  spaceId: string,
  nodes: ObjectNode[] = [],
): Promise<void> {
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  const existing = res?.data as Record<string, unknown> | undefined;
  if (existing?._encrypted || Array.isArray(existing?.objects)) return;
  const payload = encryptor
    ? await encryptor.encrypt({ objects: nodes }) as Record<string, unknown>
    : { objects: nodes };
  await client.push(objIndexPush(spaceId), payload, res?.hash ?? null);
}

/**
 * Seed a brand-new space's index as the OWNER.
 * For private spaces: opens (minting if needed) the space keyring.
 * For public spaces: pushes plaintext nodes.
 * Pass `nodes` to seed with initial objects; defaults to an empty index.
 */
export async function seedSpaceObjectIndex(
  session: Session,
  spaceId: string,
  nodes: ObjectNode[] = [],
  opts?: { visibility?: SpaceVisibility },
): Promise<void> {
  const { encryptor, client } = await getSpaceAccess(spaceId, session, {
    owner: session.userId,
    members: [],
    visibility: opts?.visibility,
  });
  await pushIndexSeed(client, encryptor, spaceId, nodes);
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
