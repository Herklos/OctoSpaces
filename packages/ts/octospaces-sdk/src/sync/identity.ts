/**
 * Identity persistence bridge — rebuilds a starfish Session from a persisted vault
 * entry using connection config from `configureOctoSpaces`.
 *
 * Vault types and the core session-rebuild logic have moved to
 * `@drakkar.software/starfish-spaces` (`vault.ts`). This module re-exports those
 * and wraps `sessionFromPersisted` to inject the `configureOctoSpaces` globals
 * so callers keep the same zero-arg signature they had before.
 *
 * Session builders, seed helpers, and fingerprint utilities — import directly:
 *   import { buildSession, deriveSession, buildLinkedSession,
 *            generateSeedWords, isValidSeed, fingerprintFromUserId,
 *            ownerTrustedAdders } from '@drakkar.software/starfish-spaces';
 */
export type { Session, LinkedIdentity } from '@drakkar.software/starfish-spaces';
export {
  rootIdentityOf,
  activeAccountOf,
} from '@drakkar.software/starfish-spaces';

import {
  sessionFromPersisted as _sessionFromPersisted,
} from '@drakkar.software/starfish-spaces';
import type { PersistedSession } from '@drakkar.software/starfish-spaces';
import type { Session } from '@drakkar.software/starfish-spaces';
import { getSyncBase, getSyncNamespace, getSharedSpacesNamespace } from '../core/config.js';

function makeClientOpts() {
  return {
    baseUrl: getSyncBase(),
    namespace: getSyncNamespace() ?? '',
  };
}

/**
 * Rebuild a live starfish Session from a persisted vault entry.
 *
 * Synthesises `clientOpts` from the `configureOctoSpaces` global config so apps
 * still call `configureOctoSpaces` once at boot. Prefers the cached `derived`
 * identity (skips Argon2id); falls back to the seed.
 */
export async function sessionFromPersisted(p: PersistedSession): Promise<Session> {
  const sharedNamespace = getSharedSpacesNamespace() ?? undefined;
  return _sessionFromPersisted(p, makeClientOpts(), { sharedNamespace });
}
