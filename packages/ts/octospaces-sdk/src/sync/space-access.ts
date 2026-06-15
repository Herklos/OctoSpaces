/**
 * Space and node access resolver.
 *
 * Encryption is per-node (each node has an `enc` flag) but keyed under ONE
 * space-wide keyring at `spaces/{spaceId}/_keyring`. All `enc` nodes in a space
 * share the same CEK; `access` gates *fetching*, the keyring gates *decryption*.
 *
 * Two entry points:
 *   - `getSpaceClient`  — returns the right StarfishClient for member-gated
 *     space docs (index, _access). No encryptor.
 *   - `getNodeAccess`   — resolves the (client, encryptor) for a specific node's
 *     CONTENT. Encryptor is null for plaintext nodes; for enc nodes the encryptor
 *     opens the SPACE keyring (not a per-node keyring).
 *
 * Resolution order for `getNodeAccess`:
 *   1. Per-node link entry  → sign as ephemeral identity; encryptor from space keyring.
 *   2. Per-node member entry → open space keyring as recipient.
 *   3. Space-level link entry → same client; open space keyring if enc.
 *   4. Space-level member entry → open space keyring if enc.
 *   5. No entry, owner        → mint space keyring if enc; plain client otherwise.
 *   6. No entry, non-owner   → SpaceAccessError if enc; plain client otherwise.
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { buildEncryptor, makeClient, openEncryptor, ownerEnsureKeyring } from './client.js';
import type { Session } from './identity.js';
import { ownerTrustedAdders } from './identity.js';
import { getNodeAccessEntry, getSpaceAccessEntry } from './space-access-store.js';
import { SpaceAccessError } from '../core/space-access-error.js';
import { keyringPull, keyringPush } from './paths.js';
import type { NodeAccess } from '../core/types.js';

// Re-export so existing importers keep reaching SpaceAccessError through this module.
export { SpaceAccessError };

export interface NodeAccessHandle {
  encryptor: Encryptor | null;
  client: StarfishClient;
  /** True when opened as the space OWNER (may seed / mint the space keyring). */
  isOwnerOpen: boolean;
}

const cache = new Map<string, Promise<NodeAccessHandle>>();

/** Drop every cached handle (on account switch — keys are per-identity). */
export function clearNodeAccessCache(): void {
  cache.clear();
}

/**
 * Return the right StarfishClient for reading/writing member-gated space docs
 * (e.g. the `_index`, `_access`). Spaces are always plaintext — no encryptor.
 */
export function getSpaceClient(spaceId: string, session: Session): StarfishClient {
  const entry = getSpaceAccessEntry(spaceId);
  if (entry?.kind === 'link') return makeClient(entry.cap, entry.key);
  if (entry?.kind === 'member') {
    const cap = JSON.parse(entry.cap) as { iss?: string };
    return makeClient(cap, session.keys.edPriv);
  }
  return session.chatClient;
}

/**
 * Resolve the right (client, encryptor) for a node's CONTENT, opening and
 * caching on first use.
 *
 * `node` carries `{ access?, enc? }` — the plaintext flags from the index.
 * `reg` is the space's access record if already known; used to determine
 * ownership. Pass null if unknown.
 */
export function getNodeAccess(
  spaceId: string,
  nodeId: string,
  node: { access?: NodeAccess; enc?: boolean },
  session: Session,
  reg?: { owner: string | null; members: string[] } | null,
): Promise<NodeAccessHandle> {
  const cacheKey = `${spaceId}:${nodeId}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const p = (async (): Promise<NodeAccessHandle> => {
    // Prefer a per-node entry, fall back to the space-level entry for the client.
    const nodeEntry = getNodeAccessEntry(spaceId, nodeId);
    const spaceEntry = getSpaceAccessEntry(spaceId);
    const activeEntry = nodeEntry ?? spaceEntry;

    // Build the client.
    let client: StarfishClient;
    let capIss: string | undefined;
    if (activeEntry?.kind === 'link') {
      client = makeClient(activeEntry.cap, activeEntry.key);
    } else if (activeEntry?.kind === 'member') {
      const cap = JSON.parse(activeEntry.cap) as { iss?: string };
      capIss = cap.iss;
      client = makeClient(cap, session.keys.edPriv);
    } else {
      client = session.chatClient;
    }

    const isOwnerOpen =
      reg != null ? reg.owner === session.userId : activeEntry == null;

    // Plaintext node — no keyring needed.
    if (!node.enc) {
      return { encryptor: null, client, isOwnerOpen };
    }

    // E2EE node — resolve the SPACE-WIDE keyring.
    const spacePullPath = keyringPull(spaceId);
    const trustedAdders = capIss
      ? [capIss]
      : reg?.owner
        ? [reg.owner]
        : ownerTrustedAdders(session);

    if (activeEntry?.kind === 'member' || activeEntry?.kind === 'link') {
      const encryptor = await openEncryptor(client, session.keys, spacePullPath, trustedAdders);
      return { encryptor, client, isOwnerOpen: false };
    }

    // No access entry — owner mints/opens the keyring; non-owner errors.
    const owner = reg?.owner ?? null;
    const members = reg?.members ?? [];
    if (owner !== null && owner !== session.userId) {
      throw new SpaceAccessError(
        members.includes(session.userId)
          ? "You're a member of this space, but the space key isn't on this device yet — ask the owner to invite you."
          : "You don't have access to this node.",
      );
    }
    const encryptor = await ownerEnsureKeyring(
      session.chatClient,
      session.keys,
      spacePullPath,
      keyringPush(spaceId),
      ownerTrustedAdders(session),
    );
    return { encryptor, client: session.chatClient, isOwnerOpen: true };
  })();

  cache.set(cacheKey, p);
  p.catch(() => cache.delete(cacheKey));
  return p;
}

/**
 * SOFT resolve — normally never mints a keyring, never throws on missing access.
 * Returns null when the identity has no usable access for the node yet.
 *
 * When `reg` is provided and the caller is the SPACE OWNER (`reg.owner ===
 * session.userId`) but no keyring exists yet, the owner self-heals by minting
 * the keyring on the spot (idempotent). This recovers spaces that were created
 * before the eager-mint (Fix A) landed without requiring a separate repair step.
 */
export async function buildNodeAccess(
  session: Session,
  spaceId: string,
  nodeId: string,
  node: { enc?: boolean },
  reg?: { owner: string | null; members?: string[] } | null,
): Promise<{ client: StarfishClient; encryptor: Encryptor | null } | null> {
  const nodeEntry = getNodeAccessEntry(spaceId, nodeId);
  const spaceEntry = getSpaceAccessEntry(spaceId);
  const activeEntry = nodeEntry ?? spaceEntry;

  let client: StarfishClient;
  let trustedAdders = ownerTrustedAdders(session);

  if (activeEntry?.kind === 'link') {
    client = makeClient(activeEntry.cap, activeEntry.key);
  } else if (activeEntry?.kind === 'member') {
    const cap = JSON.parse(activeEntry.cap) as { iss?: string };
    client = makeClient(cap, session.keys.edPriv);
    if (cap.iss) trustedAdders = [cap.iss];
  } else {
    client = session.chatClient;
  }

  if (!node.enc) return { client, encryptor: null };

  // Soft-open the SPACE-WIDE keyring.
  const spacePullPath = keyringPull(spaceId);
  const encryptor = await buildEncryptor(client, session.keys, spacePullPath, trustedAdders);
  if (encryptor) return { client, encryptor };

  // No keyring found. If the caller is the owner, self-heal by minting the keyring.
  // This recovers spaces created before the eager-mint fix landed (Fix A).
  if (reg != null && reg.owner === session.userId) {
    const mintedEncryptor = await ownerEnsureKeyring(
      session.chatClient,
      session.keys,
      spacePullPath,
      keyringPush(spaceId),
      ownerTrustedAdders(session),
    );
    return { client: session.chatClient, encryptor: mintedEncryptor };
  }

  return null;
}
