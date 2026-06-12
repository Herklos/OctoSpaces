import type { WriteEvent } from "@drakkar.software/starfish-protocol";
import type { Projection, ProjectionOp } from "@drakkar.software/starfish-projection";

/**
 * Public-space directory projection.
 *
 * Watches every write to the `spaceregistry` collection (`spaces/{spaceId}/_access`)
 * and, when `body.visibility === 'public'`, upserts that space's entry into a
 * type-sharded aggregate list (the `spaceindex` pull-only collection).
 *
 * Shard layout:
 *   `_index/spaces/public`  — untyped public spaces (back-compat default)
 *   `_index/spaces/{type}`  — typed public spaces, one doc per app-owned type string
 *
 * Each row carries an optional `subtype` field for finer client-side filtering.
 * A hot subtype can be promoted to its own shard later without changing the row shape.
 *
 * Security: `type` is owner-controlled, so it is sanitised before use as a path
 * segment — only `^[a-z0-9-]{1,32}$` is accepted; anything else falls back to 'public'.
 */

/** Allowlist for the `type` shard key — prevents path traversal via owner-controlled input. */
const SHARD_RE = /^[a-z0-9-]{1,32}$/;

function spaceTarget(event: WriteEvent): string {
  const raw = (event.body ?? {}).type;
  const shard =
    typeof raw === "string" && SHARD_RE.test(raw) ? raw : "public";
  return `_index/spaces/${shard}`;
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
      subtype: typeof body.subtype === "string" ? body.subtype : null,
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
