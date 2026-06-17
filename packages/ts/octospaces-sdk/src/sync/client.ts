/**
 * Starfish client construction + space keyring/encryptor helpers.
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import type { BatchPullEntry, Encryptor, StarfishCapProvider } from '@drakkar.software/starfish-client';
import { addCollectionRecipient, createKeyring, createKeyringEncryptor, hexToBytes, bytesToHex } from '@drakkar.software/starfish-keyring';
import type { Keyring } from '@drakkar.software/starfish-keyring';
import { ed25519 } from '@noble/curves/ed25519.js';
import { signRequest, stableStringify } from '@drakkar.software/starfish-protocol';
import type { SignableMethod } from '@drakkar.software/starfish-protocol';

import { getSyncBase, getSyncNamespace, getSyncPrefix, getOnServerReachable } from '../core/config.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from './pull-cache.js';
import { cacheProfile, loadCachedProfile } from './profile-cache.js';
import { keyringName, keyringPull, keyringPush, profilePull, profilePush } from './paths.js';
import { SpaceAccessError } from '../core/space-access-error.js';

export interface DeviceKeys {
  edPriv: string;
  edPub: string;
  kemPriv: string;
  kemPub: string;
}

export function capProviderFor(cap: unknown, devEdPrivHex: string): StarfishCapProvider {
  return {
    async getCap() {
      return { cap: cap as never, devEdPrivHex };
    },
  };
}

/**
 * Build a Starfish client. `namespaceOverride` overrides the configured namespace,
 * enabling the shared-spaces feature (a separate namespace for cross-app registry ops).
 */
export function makeClient(cap: unknown, devEdPrivHex: string, namespaceOverride?: string): StarfishClient {
  return new StarfishClient({
    baseUrl: getSyncBase(),
    namespace: namespaceOverride ?? getSyncNamespace(),
    capProvider: capProviderFor(cap, devEdPrivHex),
    fetch: fetchWithTimeout(),
    cache: pullCache(),
    cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
    cacheFallbackStatuses: [429, 500, 502, 503, 504],
    onRevalidated: () => getOnServerReachable()?.(),
  });
}

/**
 * Open a node's decryptor, throwing a descriptive error per failure mode
 * (unreachable server / no keyring yet / not a recipient).
 *
 * `keyringPullPath` is the full `/pull/.../_keyring` path (e.g. from
 * `keyringPull(spaceId)`). A `SpaceAccessError` is a hard access
 * denial; any other thrown error is a transient offline state.
 */
export async function openEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  keyringPullPath: string,
  trustedAdders: string[],
): Promise<Encryptor> {
  const res = await client.pull(keyringPullPath).catch(() => {
    throw new Error('Could not reach the server to fetch node keys.');
  });
  const keyring = res?.data as unknown as Keyring | undefined;
  if (!keyring || !keyring.epochs) {
    throw new SpaceAccessError('This node has no keyring yet — ask the owner to create it first.');
  }
  try {
    const enc = await createKeyringEncryptor(
      keyring,
      { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv },
      { trustedAdders },
    );
    return enc as unknown as Encryptor;
  } catch {
    throw new SpaceAccessError("You're not a recipient of this node's keyring yet — ask the owner to invite you.");
  }
}

/** Soft variant of {@link openEncryptor}: returns null instead of throwing. */
export async function buildEncryptor(
  client: StarfishClient,
  keys: DeviceKeys,
  keyringPullPath: string,
  trustedAdders: string[],
): Promise<Encryptor | null> {
  try {
    return await openEncryptor(client, keys, keyringPullPath, trustedAdders);
  } catch {
    return null;
  }
}

const ENSURE_KEYRING_MAX_ATTEMPTS = 3;

/**
 * Owner-side: create a per-node keyring if missing, return an encryptor.
 *
 * `keyringPullPath` / `keyringPushPath` are the full `/pull|push/.../_keyring`
 * paths (e.g. from `keyringPull`/`keyringPush`).
 *
 * The create-push uses a CAS retry loop. If two devices race to create the same
 * keyring simultaneously, the second push fails with a hash-conflict (409/412).
 * We re-pull on conflict; if the keyring now exists we open it directly (the
 * concurrent device's create wins). A non-conflict error propagates.
 */
export async function ownerEnsureKeyring(
  client: StarfishClient,
  keys: DeviceKeys,
  keyringPullPath: string,
  keyringPushPath: string,
  trustedAdders: string[] = [keys.edPub],
): Promise<Encryptor> {
  let attempt = 0;
  while (attempt < ENSURE_KEYRING_MAX_ATTEMPTS) {
    attempt++;
    const krRes = await client.pull(keyringPullPath).catch(() => null);
    let keyring = krRes?.data as unknown as Keyring | undefined;
    if (!keyring || !keyring.epochs) {
      const created = await createKeyring({ edPrivHex: keys.edPriv, edPubHex: keys.edPub }, [
        { subKemHex: keys.kemPub },
      ]);
      keyring = created.keyring;
      try {
        await client.push(keyringPushPath, keyring as unknown as Record<string, unknown>, krRes?.hash ?? null);
      } catch (pushErr) {
        // Hash-conflict (409/412): a concurrent device created the keyring first.
        // Re-pull on the next iteration to open the winner's keyring.
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        if (/409|412|conflict|hash mismatch|stale/i.test(msg) && attempt < ENSURE_KEYRING_MAX_ATTEMPTS) continue;
        throw pushErr; // network error or out of retries — propagate
      }
    }
    const enc = await createKeyringEncryptor(
      keyring,
      { kemPubHex: keys.kemPub, kemPrivHex: keys.kemPriv },
      { trustedAdders },
    );
    return enc as unknown as Encryptor;
  }
  throw new Error('ownerEnsureKeyring: max retries exceeded (hash conflict loop)');
}

/** "Already present in keyring epoch" is benign on re-invite — same family as node-keyring.ts. */
export function isAlreadyPresentRecipient(err: unknown): boolean {
  return /already (present|a recipient|exists)|duplicate/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * Add a recipient to a space's keyring — mirroring the per-node
 * `addNodeKeyringRecipient` in node-keyring.ts. Swallows "already present".
 */
export async function addSpaceKeyringRecipient(
  session: { chatClient: StarfishClient; keys: DeviceKeys; ownerEdPub?: string },
  spaceId: string,
  recipient: { subKem: string; userId: string; label: string },
): Promise<void> {
  const ownerEdPub = session.ownerEdPub ?? session.keys.edPub;
  const trustedAdders = ownerEdPub !== session.keys.edPub
    ? [ownerEdPub, session.keys.edPub]
    : [session.keys.edPub];
  try {
    await addCollectionRecipient(
      session.chatClient,
      keyringName(spaceId),
      recipient,
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders },
    );
  } catch (err) {
    if (!isAlreadyPresentRecipient(err)) throw err;
  }
}

// ── Space-keyring convenience wrappers ────────────────────────────────────────
//
// Mirror the per-node wrappers in node-keyring.ts (`ownerEnsureNodeKeyring` /
// `ensureNodeKeyringRecipient`) so that every space-keyring call site can use a
// single helper instead of spelling out the pull/push/trustedAdders triple.

type SpaceKeyringSession = { chatClient: StarfishClient; keys: DeviceKeys; ownerEdPub?: string };

/**
 * Create the space keyring if it doesn't exist, then return the owner's encryptor.
 * Delegates to `ownerEnsureKeyring` with the canonical space keyring paths.
 */
export function ownerEnsureSpaceKeyring(
  session: SpaceKeyringSession,
  spaceId: string,
): Promise<Encryptor> {
  const ownerEdPub = session.ownerEdPub ?? session.keys.edPub;
  const trustedAdders = ownerEdPub !== session.keys.edPub
    ? [ownerEdPub, session.keys.edPub]
    : [session.keys.edPub];
  return ownerEnsureKeyring(session.chatClient, session.keys, keyringPull(spaceId), keyringPush(spaceId), trustedAdders);
}

/**
 * Ensure the space keyring exists, then add a recipient — in that order (the keyring
 * invariant). Returns the owner's encryptor so the creator can immediately seal.
 */
export async function ensureSpaceKeyringRecipient(
  session: SpaceKeyringSession,
  spaceId: string,
  recipient: { subKem: string; userId: string; label: string },
): Promise<Encryptor> {
  const enc = await ownerEnsureSpaceKeyring(session, spaceId);
  await addSpaceKeyringRecipient(session, spaceId, recipient);
  return enc;
}

/** A user's public profile: display pseudo + optional inline avatar + public identity keys. */
export interface PublicProfile {
  pseudo: string | null;
  avatar: string | null;
  edPub: string | null;
  kemPub: string | null;
  kemSig: string | null;
}

/** Read any user's public profile. */
export async function readProfile(userId: string): Promise<PublicProfile> {
  try {
    const r = await fetchWithTimeout()(`${getSyncBase()}${getSyncPrefix()}${profilePull(userId)}`);
    if (!r.ok) return { pseudo: null, avatar: null, edPub: null, kemPub: null, kemSig: null };
    const body = await r.json();
    const data = body?.data as { pseudo?: unknown; avatar?: unknown; edPub?: unknown; kemPub?: unknown; kemSig?: unknown } | undefined;
    const profile: PublicProfile = {
      pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null,
      avatar: typeof data?.avatar === 'string' ? data.avatar : null,
      edPub: typeof data?.edPub === 'string' ? data.edPub : null,
      kemPub: typeof data?.kemPub === 'string' ? data.kemPub : null,
      kemSig: typeof data?.kemSig === 'string' ? data.kemSig : null,
    };
    cacheProfile(userId, profile);
    return profile;
  } catch {
    return (await loadCachedProfile(userId)) ?? { pseudo: null, avatar: null, edPub: null, kemPub: null, kemSig: null };
  }
}

/** Read any user's public profile pseudo. */
export async function readPseudo(userId: string): Promise<string | null> {
  return (await readProfile(userId)).pseudo;
}

let profileBatchClient: StarfishClient | undefined;
function getProfileBatchClient(): StarfishClient {
  if (!profileBatchClient) {
    profileBatchClient = new StarfishClient({ baseUrl: getSyncBase(), namespace: getSyncNamespace(), fetch: fetchWithTimeout() });
  }
  return profileBatchClient;
}

const PROFILE_BATCH_CHUNK = 24;

/**
 * Read MANY users' public profiles in one /batch/pull round-trip per chunk.
 */
export async function readProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  const client = getProfileBatchClient();
  for (let i = 0; i < ids.length; i += PROFILE_BATCH_CHUNK) {
    const chunk = ids.slice(i, i + PROFILE_BATCH_CHUNK);
    let entries: BatchPullEntry[];
    try {
      entries = await client.batchPullMany('profile', chunk.map((id) => ({ identity: id })));
    } catch {
      for (const id of chunk) {
        const cached = await loadCachedProfile(id);
        if (cached) out.set(id, cached);
      }
      continue;
    }
    chunk.forEach((id, j) => {
      const entry = entries[j];
      if (!entry || entry.error) return;
      const data = (entry.data ?? null) as { pseudo?: unknown; avatar?: unknown; edPub?: unknown; kemPub?: unknown; kemSig?: unknown } | null;
      const profile: PublicProfile = {
        pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null,
        avatar: typeof data?.avatar === 'string' ? data.avatar : null,
        edPub: typeof data?.edPub === 'string' ? data.edPub : null,
        kemPub: typeof data?.kemPub === 'string' ? data.kemPub : null,
        kemSig: typeof data?.kemSig === 'string' ? data.kemSig : null,
      };
      cacheProfile(id, profile);
      out.set(id, profile);
    });
  }
  return out;
}

/**
 * Merge a patch into the caller's own profile doc.
 */
export async function writeProfile(
  client: StarfishClient,
  userId: string,
  patch: { pseudo?: string; avatar?: string | null; edPub?: string; kemPub?: string; kemSig?: string },
): Promise<void> {
  const current = await client.pull(profilePull(userId)).catch(() => null);
  const base = (current?.data as Record<string, unknown> | undefined) ?? {};
  const next: Record<string, unknown> = { ...base, ...patch, v: 1 };
  if (next.avatar == null) delete next.avatar;
  await client.push(profilePush(userId), next, current?.hash ?? null);
}

/** Write the caller's own profile pseudo. */
export async function writePseudo(client: StarfishClient, userId: string, pseudo: string): Promise<void> {
  await writeProfile(client, userId, { pseudo });
}

/**
 * Publish this identity's PUBLIC keys in its profile so a peer can start an E2EE DM.
 * One-time + idempotent. ROOT-DEVICE ONLY — `profile` is `device:root`-write.
 * Also computes and publishes `kemSig` (Ed25519 sig of kemPub by edPriv) so paired
 * devices can include it in their identity link without needing the private key.
 */
export async function ensureProfileKeys(
  client: StarfishClient,
  userId: string,
  keys: { edPub: string; kemPub: string; edPriv: string },
): Promise<void> {
  let confirmedAbsent = false;
  try {
    const r = await fetchWithTimeout()(`${getSyncBase()}${getSyncPrefix()}${profilePull(userId)}`);
    if (r.status === 404) confirmedAbsent = true;
    else if (r.ok) {
      const body = await r.json();
      const data = body?.data as { edPub?: unknown; kemPub?: unknown } | undefined;
      confirmedAbsent = !(typeof data?.edPub === 'string' && typeof data?.kemPub === 'string');
    } else return;
  } catch {
    return;
  }
  if (!confirmedAbsent) return;
  const kemSig = bytesToHex(ed25519.sign(hexToBytes(keys.kemPub), hexToBytes(keys.edPriv)));
  await writeProfile(client, userId, { edPub: keys.edPub, kemPub: keys.kemPub, kemSig });
}

/**
 * Build cap-cert auth headers for a raw `fetch` outside the StarfishClient.
 */
export async function buildAuthHeaders(
  cap: unknown,
  devEdPrivHex: string,
  method: string,
  pathAndQuery: string,
): Promise<Record<string, string>> {
  let host = '';
  try {
    host = new URL(getSyncBase()).host;
  } catch { /* relative base */ }

  const { sig, ts, nonce } = await signRequest(
    { method: method as SignableMethod, pathAndQuery, host },
    devEdPrivHex,
  );

  const capJson = stableStringify(cap as Record<string, unknown>);
  const capB64 =
    typeof btoa === 'function'
      ? btoa(capJson)
      : Buffer.from(capJson, 'utf-8').toString('base64');

  return {
    Authorization: `Cap ${capB64}`,
    'X-Starfish-Sig': sig,
    'X-Starfish-Ts': String(ts),
    'X-Starfish-Nonce': nonce,
  };
}

async function readOwnPseudo(userId: string): Promise<{ read: boolean; pseudo: string | null }> {
  try {
    const r = await fetchWithTimeout()(`${getSyncBase()}${getSyncPrefix()}${profilePull(userId)}`);
    if (r.status === 404) return { read: true, pseudo: null };
    if (!r.ok) return { read: false, pseudo: null };
    const body = await r.json();
    const data = body?.data as { pseudo?: unknown } | undefined;
    return { read: true, pseudo: typeof data?.pseudo === 'string' ? data.pseudo : null };
  } catch {
    return { read: false, pseudo: null };
  }
}

/**
 * Seed the caller's profile pseudo only if none exists yet, returning the
 * authoritative server value.
 */
export async function ensurePseudo(client: StarfishClient, userId: string, fallback: string): Promise<string> {
  const { read, pseudo } = await readOwnPseudo(userId);
  if (pseudo && pseudo.trim()) return pseudo;
  if (!read) return fallback;
  await writeProfile(client, userId, { pseudo: fallback });
  return fallback;
}
