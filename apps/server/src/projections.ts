import type { WriteEvent } from "@drakkar.software/starfish-protocol";
import type { Projection, ProjectionOp } from "@drakkar.software/starfish-projection";

/**
 * Public-node directory projection.
 *
 * Watches every write to the `objindex` collection
 * (`spaces/{spaceId}/objects/_index`) and maintains a per-space row in the
 * world-readable `_index/objects/public` aggregate (`objectindex` collection).
 *
 * Each row is keyed by `spaceId` and carries all of that space's public nodes:
 *   `{ spaceId, nodes: [{ nodeId, parentId, title, emoji, type }], ts }`
 *
 * When a space's index has no public nodes the row is removed (tombstone).
 * Clients read `_index/objects/public` to discover public content without
 * being a space member.
 *
 * Security: fields come from the member-gated `_index` doc. The `spaceId` is
 * taken from the verified `params.spaceId` path parameter, not from the body.
 */

interface RawNode {
  id?: unknown;
  parentId?: unknown;
  title?: unknown;
  emoji?: unknown;
  type?: unknown;
  access?: unknown;
}

function projectObjectIndex(e: WriteEvent): ProjectionOp {
  const spaceId = e.params.spaceId;
  if (!spaceId) return null;

  const body = e.body ?? {};
  const rawObjects = (body as { objects?: unknown }).objects;
  if (!Array.isArray(rawObjects)) return null;

  const publicNodes = rawObjects
    .filter((n: unknown) => {
      const node = n as RawNode;
      return typeof node.id === "string" && node.access === "public";
    })
    .map((n: unknown) => {
      const node = n as RawNode;
      return {
        nodeId: node.id as string,
        parentId: typeof node.parentId === "string" ? node.parentId : null,
        title: typeof node.title === "string" ? node.title : null,
        emoji: typeof node.emoji === "string" ? node.emoji : null,
        type: typeof node.type === "string" ? node.type : null,
      };
    });

  // No public nodes left in this space — remove any existing directory row.
  if (publicNodes.length === 0) {
    return { id: spaceId, remove: true };
  }

  return {
    id: spaceId,
    value: { spaceId, nodes: publicNodes, ts: e.timestamp },
  };
}

export const projections: Projection[] = [
  {
    source: "objindex",
    target: "_index/objects/public",
    project: projectObjectIndex,
  },
];
