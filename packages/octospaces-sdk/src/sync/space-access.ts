/**
 * Space access resolver — returns the right (client, encryptor) pair for any
 * space regardless of whether it is private (E2EE) or public (plaintext).
 *
 * Replaces `space-encryptor.ts`. The key invariant: public spaces have
 * `encryptor: null`; private spaces always have a live `Encryptor`.
 *
 * Resolution order (same semantics as the old `getSpaceEncryptor`):
 *   1. Link entry in the access store → sign requests as the ephemeral identity;
 *      no keyring, encryptor null.
 *   2. Member entry → open the keyring as a recipient with the stored cap.
 *   3. No entry + visibility === 'public' (from `reg`) → owner mode, no keyring.
 *   4. No entry, private → either owner (open/mint keyring) or SpaceAccessError
 *      if the space's roster shows we're a member but we're not holding a cap yet.
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { buildEncryptor, makeClient, openEncryptor, ownerEnsureKeyring } from './client.js';
import type { Session } from './identity.js';
import { ownerTrustedAdders } from './identity.js';
import { getSpaceAccessEntry } from './space-access-store.js';
import { SpaceAccessError } from '../core/space-access-error.js';
import type { SpaceVisibility } from '../core/types.js';

// Re-export so existing importers keep reaching SpaceAccessError through this module.
export { SpaceAccessError };

export interface SpaceAccessHandle {
  encryptor: Encryptor | null;
  client: StarfishClient;
  /** True when opened as the space OWNER (so the caller must seed the room doc). */
  isOwnerOpen: boolean;
}

const cache = new Map<string, Promise<SpaceAccessHandle>>();

/** Drop every cached handle (on account switch — keys are per-identity). */
export function clearSpaceAccessCache(): void {
  cache.clear();
}

/**
 * Resolve the right (client, encryptor) for a space, opening and caching on first use.
 *
 * `reg` is the space's `_access` access record if already known. Pass null when the
 * caller has not yet read the registry; the resolver will probe if needed.
 */
export function getSpaceAccess(
  spaceId: string,
  session: Session,
  reg: { owner: string | null; members: string[]; visibility?: SpaceVisibility } | null,
): Promise<SpaceAccessHandle> {
  const hit = cache.get(spaceId);
  if (hit) return hit;
  const p = (async (): Promise<SpaceAccessHandle> => {
    const entry = getSpaceAccessEntry(spaceId);

    // 1. Link entry — ephemeral identity; no keyring
    if (entry?.kind === 'link') {
      const cap = entry.cap;
      const client = makeClient(cap, entry.key);
      return { encryptor: null, client, isOwnerOpen: false };
    }

    // 2. Member entry — open as a keyring recipient
    if (entry?.kind === 'member') {
      const cap = JSON.parse(entry.cap) as { iss?: string };
      const client = makeClient(cap, session.keys.edPriv);
      const encryptor = await openEncryptor(client, session.keys, spaceId, cap.iss ? [cap.iss] : []);
      return { encryptor, client, isOwnerOpen: false };
    }

    // 3. No entry — branch on visibility
    const visibility = reg?.visibility;
    if (visibility === 'public') {
      return { encryptor: null, client: session.chatClient, isOwnerOpen: reg!.owner === session.userId };
    }

    // 4. No entry, private — owner or error
    const owner = reg?.owner ?? null;
    const members = reg?.members ?? [];
    if (owner !== null && owner !== session.userId) {
      throw new SpaceAccessError(
        members.includes(session.userId)
          ? "You're a member of this space, but its key isn't on this device yet — reconnect, or ask the owner to re-invite."
          : "You don't have access to this space.",
      );
    }
    const encryptor = await ownerEnsureKeyring(
      session.chatClient,
      session.keys,
      spaceId,
      ownerTrustedAdders(session),
    );
    return { encryptor, client: session.chatClient, isOwnerOpen: true };
  })();
  cache.set(spaceId, p);
  p.catch(() => cache.delete(spaceId));
  return p;
}

/**
 * SOFT resolve — never mints a keyring, never throws on missing access.
 * Returns null when the identity has no usable access for the space yet.
 */
export async function buildSpaceAccess(
  session: Session,
  spaceId: string,
  hint?: { visibility?: SpaceVisibility },
): Promise<{ client: StarfishClient; encryptor: Encryptor | null } | null> {
  const entry = getSpaceAccessEntry(spaceId);

  if (entry?.kind === 'link') {
    const client = makeClient(entry.cap, entry.key);
    return { client, encryptor: null };
  }

  let client = session.chatClient;
  let trustedAdders = ownerTrustedAdders(session);

  if (entry?.kind === 'member') {
    const cap = JSON.parse(entry.cap) as { iss?: string };
    client = makeClient(cap, session.keys.edPriv);
    if (cap.iss) trustedAdders = [cap.iss];
    const encryptor = await buildEncryptor(client, session.keys, spaceId, trustedAdders);
    return encryptor ? { client, encryptor } : null;
  }

  if (hint?.visibility === 'public') {
    return { client, encryptor: null };
  }

  // No entry, no hint — try the keyring probe (owner path)
  const encryptor = await buildEncryptor(client, session.keys, spaceId, trustedAdders);
  return encryptor ? { client, encryptor } : null;
}
