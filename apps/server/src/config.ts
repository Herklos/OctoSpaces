import type { SyncConfig } from "@drakkar.software/starfish-server";

/**
 * Starfish collection layout for OctoSpaces — the shared cross-app space registry.
 *
 * OctoSpaces is the canonical hub for per-identity space lists, per-space access
 * records, and per-space keyrings. Both OctoChat and OctoVault clients point their
 * `spacesNamespace` here so they share one space registry rather than duplicating it.
 *
 *   spaces        — per-identity space list.
 *   spaceregistry — per-space access record `{ owner, members, visibility, name, image }`.
 *   spacekeyring  — per-space multi-recipient keyring (shared encryption key).
 *   spaceindex    — pull-only public-space directory (`_index/spaces/public`).
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
    // PER-SPACE access record `{ v, owner, members, visibility, name, image }`.
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
    // PER-SPACE keyring: multi-recipient CEK shared by all space documents that use
    // delegated encryption. READ gated on `space:member`, WRITE on `space:owner`.
    {
      name: "spacekeyring",
      storagePath: "spaces/{spaceId}/_keyring",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC-SPACE DIRECTORY: read-only aggregate list upserted by the projection
    // plugin (see projections.ts). Clients pull `_index/spaces/public` to browse
    // the directory. `pullOnly` — no client push route registered.
    {
      name: "spaceindex",
      storagePath: "_index/spaces/{shard}",
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
