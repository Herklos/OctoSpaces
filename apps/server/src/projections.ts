import type { WriteEvent } from "@drakkar.software/starfish-protocol";
import type { Projection, ProjectionOp } from "@drakkar.software/starfish-projection";

/**
 * Public directory projections for the unified `octospaces` namespace.
 *
 * Three projections are maintained:
 *
 * `_index/objects/public`  (source: objindex)
 *   Indexes spaces with at least one public ObjectNode (access:'public', not archived).
 *   Upserts { nodes, ts } per space or removes when no public nodes remain.
 *
 * `_index/spaces/public`  (source: objindex)
 *   Indexes spaces with at least one public room node (type:'room', access:'public').
 *   Upserts { publicRooms, ts } or removes when the space has no public rooms.
 *
 * `_index/spaces/meta`  (source: spaceregistry)
 *   Carries { name, image } for every space. World-readable; names/images of all
 *   spaces are visible to anonymous readers — accepted for the current threat model.
 *
 * Keep in sync with Infra/sync/server/drakkar_sync/apps/octospaces/projections.py.
 */

/** A minimal public node stub stored in the object directory entry. */
export interface PubNode {
  id: string;
  title: string;
  type: string;
  emoji?: string;
  updatedAt: number;
}

/**
 * Extract live public node stubs from an `objindex` write body's `objects` array.
 * Returns ONLY nodes with `access === 'public'` that are NOT archived.
 */
export function extractPublicNodes(body: unknown): PubNode[] {
  if (!body || typeof body !== "object") return [];
  const objects = (body as Record<string, unknown>).objects;
  if (!Array.isArray(objects)) return [];
  const result: PubNode[] = [];
  for (const n of objects) {
    if (!n || typeof n !== "object") continue;
    const node = n as Record<string, unknown>;
    if (node.access !== "public") continue;
    if (node.archived) continue;
    const rawId = String(node.id ?? "");
    if (!rawId) continue;
    const stub: PubNode = {
      id: rawId,
      title: typeof node.title === "string" ? node.title : "",
      type: typeof node.type === "string" ? node.type : "page",
      updatedAt: typeof node.updatedAt === "number" ? node.updatedAt : 0,
    };
    if (typeof node.emoji === "string") stub.emoji = node.emoji;
    result.push(stub);
  }
  return result;
}

/**
 * Map an `objindex` write to a public-object directory upsert or remove.
 * Returns null (no-op) when the event carries no spaceId.
 */
export function projectObjIndexPublic(e: WriteEvent): ProjectionOp {
  const spaceId = e.params.spaceId;
  if (!spaceId) return null;
  const nodes = extractPublicNodes(e.body);
  if (nodes.length === 0) return { id: spaceId, remove: true };
  return { id: spaceId, value: { nodes, ts: e.timestamp } };
}

/** Count live public room nodes in an `objindex` write body. */
function countPublicRooms(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const objects = (body as Record<string, unknown>).objects;
  if (!Array.isArray(objects)) return 0;
  return objects.filter((n) => {
    if (!n || typeof n !== "object") return false;
    const node = n as Record<string, unknown>;
    return node.type === "room" && node.access === "public" && !node.archived;
  }).length;
}

/**
 * Map an `objindex` write to the public-space directory upsert or remove.
 * Counts public room nodes; removes the entry when count == 0.
 */
export function projectObjIndexSpaces(e: WriteEvent): ProjectionOp {
  const spaceId = e.params.spaceId;
  if (!spaceId) return null;
  const publicRooms = countPublicRooms(e.body);
  if (publicRooms === 0) return { id: spaceId, remove: true };
  return { id: spaceId, value: { publicRooms, ts: e.timestamp } };
}

/**
 * Map a `spaceregistry` (_access) write to a name/image meta upsert.
 * Always upserts (never removes) — the space exists as long as the registry doc exists.
 */
export function projectSpaceRegistry(e: WriteEvent): ProjectionOp {
  const spaceId = e.params.spaceId;
  if (!spaceId) return null;
  const body = (e.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : null;
  const image = typeof body.image === "string" ? body.image : null;
  return { id: spaceId, value: { name, image } };
}

export const projections: Projection[] = [
  { source: "objindex",      target: "_index/objects/public", project: projectObjIndexPublic },
  { source: "objindex",      target: "_index/spaces/public",  project: projectObjIndexSpaces },
  { source: "spaceregistry", target: "_index/spaces/meta",    project: projectSpaceRegistry },
];
