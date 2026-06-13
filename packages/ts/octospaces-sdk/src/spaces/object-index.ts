/**
 * Headless reads + create-time seeding of a space's unified OBJECT INDEX.
 *
 * The index at `spaces/{spaceId}/objects/_index` is always PLAINTEXT (member-gated).
 * For `invite` nodes the title/emoji are stripped before storage so non-invited
 * members see only the structural fields (id, type, parentId, order, access, enc).
 * Invited members read the real title from the node's content doc.
 *
 * Encryption lives at the node content level, not here.
 */
import { ConflictError } from '@drakkar.software/starfish-client';

import type { ObjectNode } from '../core/types.js';
import type { Session } from '../sync/identity.js';
import { objIndexPull, objIndexPush } from '../sync/paths.js';
import { getSpaceClient } from '../sync/space-access.js';

/** Strip title/emoji from invite nodes before writing to the index. */
function serializeForIndex(node: ObjectNode): ObjectNode {
  if (node.access === 'invite') {
    const { emoji: _e, ...rest } = node;
    return { ...rest, title: '' };
  }
  return node;
}

/**
 * Write the create-time seed into a space's index doc.
 * Idempotent: a no-op if the index doc already exists.
 * Pass `nodes` to seed with initial objects; defaults to an empty index.
 */
export async function pushIndexSeed(
  client: import('@drakkar.software/starfish-client').StarfishClient,
  spaceId: string,
  nodes: ObjectNode[] = [],
): Promise<void> {
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  const existing = res?.data as Record<string, unknown> | undefined;
  if (Array.isArray(existing?.objects)) return;
  await client.push(
    objIndexPush(spaceId),
    { v: 2, objects: nodes.map(serializeForIndex), updatedAt: Date.now() },
    res?.hash ?? null,
  );
}

/**
 * Seed a brand-new space's index as the OWNER. Always plaintext.
 * Pass `nodes` to seed with initial objects; defaults to an empty index.
 */
export async function seedSpaceObjectIndex(
  session: Session,
  spaceId: string,
  nodes: ObjectNode[] = [],
): Promise<void> {
  const client = getSpaceClient(spaceId, session);
  await pushIndexSeed(client, spaceId, nodes);
}

/**
 * Headless read-modify-write of a space's unified OBJECT INDEX.
 * Always plaintext. Retries up to 3 times on ConflictError.
 *
 * The mutator receives the current nodes with real (or empty, for invite) titles.
 * Before writing back, invite nodes have their title/emoji stripped again.
 */
export async function updateObjectIndex(
  session: Session,
  spaceId: string,
  mutator: (nodes: ObjectNode[], now: number) => ObjectNode[] | null,
  reg?: { owner: string | null; members: string[] } | null,
): Promise<void> {
  void reg; // no longer needed for encryption; kept for API compat during migration
  const client = getSpaceClient(spaceId, session);
  const pullPath = objIndexPull(spaceId);
  const pushPath = objIndexPush(spaceId);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await client.pull(pullPath).catch(() => null);
    const raw = res?.data as Record<string, unknown> | undefined;
    const cur: ObjectNode[] = Array.isArray((raw as { objects?: unknown })?.objects)
      ? (raw as { objects: ObjectNode[] }).objects
      : [];
    const next = mutator(cur, Date.now());
    if (!next) return;
    try {
      await client.push(
        pushPath,
        { v: 2, objects: next.map(serializeForIndex), updatedAt: Date.now() },
        res?.hash ?? null,
      );
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Read the current object tree (read-only, no mutation). Returns the stored
 * nodes (titles are empty for invite nodes the caller is not invited to).
 */
export async function readObjectTree(
  session: Session,
  spaceId: string,
): Promise<ObjectNode[]> {
  const client = getSpaceClient(spaceId, session);
  const res = await client.pull(objIndexPull(spaceId)).catch(() => null);
  const raw = res?.data as Record<string, unknown> | undefined;
  return Array.isArray((raw as { objects?: unknown })?.objects)
    ? (raw as { objects: ObjectNode[] }).objects
    : [];
}
