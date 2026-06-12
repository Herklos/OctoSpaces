import type { SyncConfig } from "@drakkar.software/starfish-server";

/**
 * Starfish collection layout for OctoSpaces — the shared cross-app space registry.
 *
 * OctoSpaces is the canonical hub for per-identity space lists, per-space access
 * records, and per-node keyrings. Both OctoChat and OctoVault clients point their
 * `spacesNamespace` here so they share one space registry.
 *
 *   spaces        — per-identity space list.
 *   spaceregistry — per-space access record `{ owner, members, name, image }`.
 *   nodekeyring   — per-node keyring for E2EE nodes (one keyring per node).
 *   objindex      — member-readable unified object index (`spaces/{id}/objects/_index`).
 *   objpub        — world-readable public-node content (`spaces/{id}/objects/pub/{nodeId}`).
 *   objinv        — invite-only plaintext node content (cap-gated via scope coverage).
 *   objectindex   — pull-only public-node directory (`_index/objects/{shard}`).
 *
 * Note: `objinv` is intentionally excluded from the broad `spaceMemberScope` so only
 * per-node caps (nodeMemberScope) can reach invite+plaintext content.
 *
 * Keep in sync with Infra/sync/server/drakkar_sync/apps/octospaces/collections.py.
 */
const JSON_ONLY = ["application/json"];

export const config: SyncConfig = {
  version: 1,
  collections: [
    // PER-IDENTITY space list: which spaces this identity is a member of.
    {
      name: "spaces",
      storagePath: "user/{identity}/_spaces",
      readRoles: ["cap:read:spaces"],
      writeRoles: ["cap:write:spaces"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // PER-SPACE access record `{ v, owner, members, name, image }`.
    // The space-role enricher reads THIS doc to synthesize space:owner / space:member
    // for every other space-gated collection.
    {
      name: "spaceregistry",
      storagePath: "spaces/{spaceId}/_access",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // PER-NODE keyring: multi-recipient CEK for E2EE nodes. READ gated on `space:member`
    // (any member can fetch the blob), WRITE on `space:owner` (only owner mints/rotates).
    // Scope coverage prevents non-invited identities from reaching specific node keyrings
    // unless their cap's path scope covers `spaces/{spaceId}/objects/n/{nodeId}/**`.
    {
      name: "nodekeyring",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/_keyring",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // UNIFIED OBJECT INDEX: one doc per space listing every node with structural fields.
    // Invite nodes have their title/emoji stripped before storage (see serializeForIndex).
    // READ/WRITE gated on `space:member`.
    {
      name: "objindex",
      storagePath: "spaces/{spaceId}/objects/_index",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // PER-SPACE general object log (WAL / CRDT append-only).
    {
      name: "objlog",
      storagePath: "spaces/{spaceId}/objects/logs/{objectId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 4_194_304,
      allowedMimeTypes: JSON_ONLY,
    },
    // Snapshot companion to objlog for fast cold-start.
    {
      name: "objsnap",
      storagePath: "spaces/{spaceId}/objects/logs/{objectId}__snapshot",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 1_048_576,
      allowedMimeTypes: JSON_ONLY,
    },
    // PER-SPACE LWW merge-doc (contentKind "merge").
    {
      name: "objdoc",
      storagePath: "spaces/{spaceId}/objects/docs/{objectId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 1_048_576,
      allowedMimeTypes: JSON_ONLY,
    },
    // Sealed raw binary blob.
    {
      name: "objblob",
      storagePath: "spaces/{spaceId}/objects/blobs/{blobId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 10_485_760,
      allowedMimeTypes: ["*/*"],
    },
    // Per-space custom type registry.
    {
      name: "typeindex",
      storagePath: "spaces/{spaceId}/types/_index",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC NODE CONTENT: world-readable content for `access:'public'` nodes.
    // Members also reach it via the broad spaceMemberScope (OBJECT_COLLECTIONS includes
    // 'objpub' and the path covers spaces/{spaceId}/**).
    {
      name: "objpub",
      storagePath: "spaces/{spaceId}/objects/pub/{nodeId}",
      readRoles: ["public"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 1_048_576,
      allowedMimeTypes: JSON_ONLY,
    },
    // INVITE-ONLY PLAINTEXT NODE CONTENT: cap-gated via scope coverage.
    // `objinv` is intentionally excluded from spaceMemberScope (OBJECT_COLLECTIONS) —
    // only a per-node cap (nodeMemberScope) whose path is
    // `spaces/{spaceId}/objects/n/{nodeId}/**` can reach it.
    {
      name: "objinv",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/content",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 1_048_576,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC-NODE DIRECTORY: read-only aggregate list upserted by the projection
    // plugin (see projections.ts). Clients pull `_index/objects/public` to browse
    // world-readable nodes. `pullOnly` — no client push route registered.
    {
      name: "objectindex",
      storagePath: "_index/objects/{shard}",
      readRoles: ["public"],
      writeRoles: [],
      pullOnly: true,
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // Public-readable profile; only the self-signed root device may write.
    {
      name: "profile",
      storagePath: "user/{identity}/profile",
      readRoles: ["public"],
      writeRoles: ["device:root"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // Per-identity device directory.
    {
      name: "devices",
      storagePath: "users/{identity}/_devices",
      readRoles: ["cap:read:devices"],
      writeRoles: ["cap:write:devices"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // Anonymous rendezvous slot for QR device pairing.
    {
      name: "pairing",
      storagePath: "_pairing/{rendezvousId}",
      readRoles: ["public"],
      writeRoles: ["public"],
      encryption: "none",
      maxBodyBytes: 16_384,
      allowedMimeTypes: JSON_ONLY,
    },
  ],
};
