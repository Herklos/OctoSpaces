import type { WriteEvent } from "@drakkar.software/starfish-protocol";
import type { Projection, ProjectionOp } from "@drakkar.software/starfish-projection";

/**
 * Public-space directory projection.
 *
 * Watches every write to the `spaceregistry` collection (`spaces/{spaceId}/_access`)
 * and, when `body.visibility === 'public'`, upserts that space's entry into the
 * aggregate list at `_index/spaces/public` (the `spaceindex` pull-only collection).
 * Clients pull that one document to browse the public-space directory.
 */

function spaceTarget(_event: WriteEvent): string | null {
  return "_index/spaces/public";
}

function projectSpaceRegistry(e: WriteEvent): ProjectionOp {
  const body = e.body ?? {};
  // Only public spaces belong in the directory. Private spaces are intentionally
  // excluded — their `_access` docs are member-gated, and an aggregate list would
  // leak names/owners to anyone who can read the index.
  if (body.visibility !== "public") return null;
  return {
    id: e.params.spaceId,
    value: {
      name: typeof body.name === "string" ? body.name : null,
      ownerId: typeof body.owner === "string" ? body.owner : null,
      image: typeof body.image === "string" ? body.image : null,
      ts: e.timestamp,
    },
  };
}

export const projections: Projection[] = [
  {
    source: "spaceregistry",
    target: spaceTarget,
    project: projectSpaceRegistry,
  },
];
