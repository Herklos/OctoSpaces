import type { SyncConfig } from "@drakkar.software/starfish-server";

/**
 * Starfish collection layout for OctoSpaces — the unified generic backend.
 *
 * OctoSpaces is now the SOLE canonical namespace for all clients (OctoChat,
 * OctoVault, …). Both ``spacesNamespace`` and ``syncNamespace`` point here so
 * per-identity space registries, per-space access records, per-space E2EE
 * keyrings, AND all generic content collections live in one place. The previous
 * stance of "content belongs in each app's own namespace" is reversed: there is
 * no per-app content namespace — everything flows through octospaces.
 *
 * Registry collections:
 *   spaces        — per-identity space registry    (user/{identity}/_spaces)
 *   spaceregistry — per-space access record        (spaces/{spaceId}/_access)
 *   spacekeyring  — per-space E2EE keyring         (spaces/{spaceId}/_keyring)
 *   profile       — public-readable identity profile
 *   devices       — per-identity device directory
 *   pairing       — anonymous QR device pairing rendezvous
 *
 * Generic object family (space:member gated, plaintext or delegated E2EE):
 *   objindex   — per-space node tree (always plaintext; invite titles stripped)
 *   objpub     — public node content (world-readable plaintext merge-doc)
 *   objinv     — invite-only plaintext content (cap-gated via sharing plugin)
 *   objlog     — WAL/CRDT append-only op-log (delegated E2EE)
 *   objsnap    — sibling LWW snapshot for fast cold-start
 *   objdoc     — LWW merge-doc (delegated E2EE)
 *   objblob    — sealed raw binary blobs (client-sealed before upload)
 *   typeindex  — per-space custom type registry (delegated E2EE)
 *
 * New generic primitives:
 *   objpublog  — public-read + member-write append-log (public streams)
 *   objinvlog  — cap-gated plaintext append-log (invite streams)
 *   nodekeyring — per-node E2EE keyring (invite+enc nodes; participants only)
 *   objowner   — owner-only node content (access:'owner')
 *   inbox      — identity-scoped public drop-box (DM link)
 *
 * Public directories (pullOnly, server-maintained projections):
 *   objectindex — global public object directory (_index/objects/{shard})
 *   spaceindex  — global public space directory  (_index/spaces/{shard})
 *
 * E2EE invariant: encryption is 'none' (server stores opaque/plaintext bytes)
 * or 'delegated' (client seals, server stores opaque ct). Server never seals
 * or unseals content.
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
    // SPACE-WIDE keyring: multi-recipient CEK. ONE keyring per space; every `enc` node
    // in the space is encrypted under this single key. READ gated on `space:member`
    // (any member can fetch the blob to decrypt enc content), WRITE on `space:owner`
    // (only owner mints/adds recipients/rotates). Individual recipient slots are sealed
    // client-side.
    {
      name: "spacekeyring",
      storagePath: "spaces/{spaceId}/_keyring",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 65_536,
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

    // ── Generic object family ──────────────────────────────────────────────────

    // OBJECT TREE (plaintext, member-gated): union-merged list of every ObjectNode.
    {
      name: "objindex",
      storagePath: "spaces/{spaceId}/objects/_index",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC NODE CONTENT (access:'public'): world-readable plaintext merge-doc.
    {
      name: "objpub",
      storagePath: "spaces/{spaceId}/objects/pub/{nodeId}",
      readRoles: ["public"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // INVITE-ONLY PLAINTEXT CONTENT (access:'invite'+enc:false): cap-gated via sharing plugin.
    {
      name: "objinv",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/content",
      readRoles: [],
      writeRoles: [],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // GENERIC WAL op-log (private/E2EE): append-only by_timestamp, delegated encryption.
    {
      name: "objlog",
      storagePath: "spaces/{spaceId}/objects/logs/{objectId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      appendOnly: { type: "by_timestamp", requireAuthorSignature: true },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // GENERIC WAL snapshot (private/E2EE): sibling LWW snapshot alongside each objlog.
    {
      name: "objsnap",
      storagePath: "spaces/{spaceId}/objects/logs/{objectId}__snapshot",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 1_048_576,
      allowedMimeTypes: JSON_ONLY,
    },
    // GENERIC merge-doc (private/E2EE): LWW doc, delegated encryption.
    {
      name: "objdoc",
      storagePath: "spaces/{spaceId}/objects/docs/{objectId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // GENERIC raw blob (sealed client-side): binary file/image bytes, none at collection level.
    {
      name: "objblob",
      storagePath: "spaces/{spaceId}/objects/blobs/{blobId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 11_534_336,
      allowedMimeTypes: ["application/octet-stream"],
    },
    // PER-SPACE CUSTOM TYPE REGISTRY (private/E2EE): union-merged TypeDefs, delegated encryption.
    {
      name: "typeindex",
      storagePath: "spaces/{spaceId}/types/_index",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },

    // ── New generic primitives ─────────────────────────────────────────────────

    // PUBLIC APPEND-LOG (access:'public' streams): world-readable + member-write append-only log.
    {
      name: "objpublog",
      storagePath: "spaces/{spaceId}/objects/pub/{nodeId}/log",
      readRoles: ["public"],
      writeRoles: ["space:member"],
      encryption: "none",
      appendOnly: { type: "by_timestamp", requireAuthorSignature: true },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // INVITE-ONLY APPEND-LOG (access:'invite' streams, e.g. OctoDesk tickets).
    // Dual-gated: `space:member` lets the space's members/owner/bot read+write every
    // ticket stream (shared support-queue model), while `cap:read|write:objinvlog`
    // admits an isolated external invitee (a ticket requester) holding only a per-node
    // stream cap. Empty roles denied EVERYONE — the cap-gating intent was never wired
    // (the sharing plugin only validates cap SHAPE; it grants nothing).
    {
      name: "objinvlog",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/log",
      readRoles: ["space:member", "cap:read:objinvlog"],
      writeRoles: ["space:member", "cap:write:objinvlog"],
      encryption: "none",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // PER-NODE E2EE KEYRING (access:'invite'+enc:true, e.g. OctoDesk tickets).
    // One keyring per invite node, wrapping the node CEK to ONLY that node's
    // participants (requester + owner/bot + assigned agents) — NOT the space-wide
    // keyring, so an isolated external requester never holds the space key. Dual-gated
    // like objinvlog: `space:member` lets owner/bot/agents read+write (add recipients,
    // rotate); `cap:read:nodekeyring` admits an isolated requester to READ the blob and
    // decrypt. WRITE is `space:member` only — the requester never writes; integrity is
    // enforced cryptographically (signed entries + trustedAdders), not by the role.
    {
      name: "nodekeyring",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/_keyring",
      readRoles: ["space:member", "cap:read:nodekeyring"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // OWNER-ONLY NODE CONTENT (access:'owner'): space:owner read/write.
    {
      name: "objowner",
      storagePath: "spaces/{spaceId}/objects/owner/{nodeId}",
      readRoles: ["space:owner"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // IDENTITY INBOX (public-write, cap-read): per-identity DM drop-box, IP rate-limited.
    {
      name: "inbox",
      storagePath: "inbox/{identity}/{shard}",
      readRoles: ["cap:read:inbox"],
      writeRoles: ["public"],
      encryption: "none",
      appendOnly: { type: "by_timestamp", maxItems: 500, requireAuthorSignature: false },
      maxBodyBytes: 16_384,
      allowedMimeTypes: JSON_ONLY,
      rateLimit: { push: { windowMs: 60_000, maxRequests: 30, bucket: "ip" } },
    },

    // ── Public directories (pullOnly, server-maintained projections) ───────────

    // GLOBAL PUBLIC OBJECT DIRECTORY: server-maintained index of every public ObjectNode.
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
    // GLOBAL PUBLIC SPACE DIRECTORY: server-maintained list of discoverable spaces.
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
  ],
};
