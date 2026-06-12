/**
 * One private-space {@link Encryptor} (+ its sync client), cached per SPACE and
 * shared across rooms. Keyed by spaceId because one keyring drives every channel in
 * a space. Cleared on account switch via {@link clearSpaceEncryptors}.
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { buildEncryptor, makeClient, openEncryptor, ownerEnsureKeyring } from './client.js';
import type { Session } from './identity.js';
import { ownerTrustedAdders } from './identity.js';
import { getMemberCap } from './member-caps.js';
import { SpaceAccessError } from '../core/space-access-error.js';

// Re-export so existing importers keep reaching for `SpaceAccessError` through
// `space-encryptor`; its canonical home is the dependency-free `space-access-error`.
export { SpaceAccessError };

export interface SpaceEncryptor {
  encryptor: Encryptor;
  client: StarfishClient;
  /** True when opened as the space OWNER (so the caller must seed the room doc). */
  isOwnerOpen: boolean;
}

const cache = new Map<string, Promise<SpaceEncryptor>>();

/** Drop every cached space encryptor (on account switch — keys are per-identity). */
export function clearSpaceEncryptors(): void {
  cache.clear();
}

/**
 * Resolve a private space's encryptor + sync client, opening (and caching) it on
 * first use. Two auth modes:
 *  - JOINED (a stored member cap): open as a keyring recipient.
 *  - OWN / unhydrated (no cap): decide from the registry `owner`. A member whose
 *    cap hasn't hydrated MUST NOT fall into the owner branch — that could re-create
 *    the keyring, locking everyone out.
 */
export function getSpaceEncryptor(
  spaceId: string,
  session: Session,
  reg: { owner: string | null; members: string[] } | null,
): Promise<SpaceEncryptor> {
  const hit = cache.get(spaceId);
  if (hit) return hit;
  const p = (async (): Promise<SpaceEncryptor> => {
    const memberCap = getMemberCap(spaceId);
    if (memberCap) {
      const cap = JSON.parse(memberCap) as { iss?: string };
      const client = makeClient(cap, session.keys.edPriv);
      const encryptor = await openEncryptor(client, session.keys, spaceId, cap.iss ? [cap.iss] : []);
      return { encryptor, client, isOwnerOpen: false };
    }
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
 * SOFT resolve a private space's encryptor + client for a read-only consumer.
 * Never mints a keyring and never throws on missing access. Returns null when the
 * identity has no keyring for the space yet.
 */
export async function buildSpaceEncryptor(
  session: Session,
  spaceId: string,
): Promise<{ client: StarfishClient; enc: Encryptor } | null> {
  const memberCap = getMemberCap(spaceId);
  let client = session.chatClient;
  let trustedAdders = ownerTrustedAdders(session);
  if (memberCap) {
    const cap = JSON.parse(memberCap) as { iss?: string };
    client = makeClient(cap, session.keys.edPriv);
    if (cap.iss) trustedAdders = [cap.iss];
  }
  const enc = await buildEncryptor(client, session.keys, spaceId, trustedAdders);
  return enc ? { client, enc } : null;
}
