/**
 * Space registries (plaintext metadata docs). A user's spaces live at
 * `user/<userId>/_spaces`; each space's ACCESS RECORD (owner/members + shared
 * name/image) at `spaces/<spaceId>/_access`. The object tree lives in the plaintext
 * unified object index (`objects/_index`, see `object-index.ts`); `_access` is the
 * owner-only access record. Spaces are neutral containers — visibility and encryption
 * are per-node properties (see `ObjectNode.access` / `ObjectNode.enc`).
 */
import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { ArchivedDms, CapMap, DmMap, MutePrefs, PubAccessMap, ReadPrefs, Space } from '../core/types.js';
import type { SealedBlob } from '../sync/account-seal.js';
import { randomId } from '../core/ids.js';
import type { Session } from '../sync/identity.js';
import { seedSpaceObjectIndex } from './object-index.js';
import { spaceAccessPull, spaceAccessPush, spacesPull, spacesPush } from '../sync/paths.js';

/** Owner-set, SHARED space identity, persisted in the `_access` registry doc
 *  (plaintext — NOT E2EE). `image` is a data URI. All fields optional for back-compat. */
export interface SpaceMeta {
  name?: string | null;
  image?: string | null;
}

/** A resolved name/image update fanned out so the SpacesProvider adopts a
 *  freshly-reconciled value without waiting for its next navigation refresh. */
export interface SpaceMetaUpdate {
  name: string;
  short: string;
  image?: string;
}

const spaceMetaListeners = new Set<(spaceId: string, meta: SpaceMetaUpdate) => void>();

export function onSpaceMeta(fn: (spaceId: string, meta: SpaceMetaUpdate) => void): () => void {
  spaceMetaListeners.add(fn);
  return () => { spaceMetaListeners.delete(fn); };
}

export function broadcastSpaceMeta(spaceId: string, meta: SpaceMetaUpdate): void {
  for (const fn of spaceMetaListeners) fn(spaceId, meta);
}

interface SpacesDoc {
  spaces: Space[];
  caps: CapMap;
  mutes: MutePrefs;
  reads: ReadPrefs;
  pubAccess: PubAccessMap;
  dms: DmMap;
  quickReactions: string[];
  archivedDms: ArchivedDms;
  hash: string | null;
}

function coerceDms(raw: unknown): DmMap {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: DmMap = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'string') out[k] = v;
  return out;
}

function coerceMutes(raw: unknown): MutePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown; spaces?: unknown };
  const pick = (v: unknown): Record<string, true | number> =>
    v && typeof v === 'object' ? (v as Record<string, true | number>) : {};
  return { rooms: pick(r.rooms), spaces: pick(r.spaces) };
}

function coerceReads(raw: unknown): ReadPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown };
  const src = r.rooms && typeof r.rooms === 'object' ? (r.rooms as Record<string, unknown>) : {};
  const rooms: Record<string, number> = {};
  for (const [id, v] of Object.entries(src)) if (typeof v === 'number' && Number.isFinite(v)) rooms[id] = v;
  return { rooms };
}

function coerceQuickReactions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

function coerceArchivedDms(raw: unknown): ArchivedDms {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: ArchivedDms = {};
  for (const [k, v] of Object.entries(src)) if (v === true) out[k] = true;
  return out;
}

async function pullSpacesDoc(client: StarfishClient, userId: string): Promise<SpacesDoc> {
  const res = await client.pull(spacesPull(userId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as
    | {
        spaces?: Space[];
        caps?: CapMap;
        mutes?: unknown;
        reads?: unknown;
        pubAccess?: PubAccessMap;
        dms?: unknown;
        quickReactions?: unknown;
        archivedDms?: unknown;
      }
    | undefined;
  return {
    spaces: Array.isArray(data?.spaces) ? data!.spaces! : [],
    caps: data?.caps && typeof data.caps === 'object' ? data.caps : {},
    mutes: coerceMutes(data?.mutes),
    reads: coerceReads(data?.reads),
    pubAccess: data?.pubAccess && typeof data.pubAccess === 'object' ? data.pubAccess : {},
    dms: coerceDms(data?.dms),
    quickReactions: coerceQuickReactions(data?.quickReactions),
    archivedDms: coerceArchivedDms(data?.archivedDms),
    hash: res?.hash ?? null,
  };
}

export async function readSpaces(client: StarfishClient, userId: string): Promise<SpacesDoc> {
  try {
    return await pullSpacesDoc(client, userId);
  } catch (err) {
    console.error('[readSpaces] failed to pull spaces registry', err);
    return {
      spaces: [],
      caps: {},
      mutes: coerceMutes(undefined),
      reads: coerceReads(undefined),
      pubAccess: {},
      dms: {},
      quickReactions: [],
      archivedDms: {},
      hash: null,
    };
  }
}

export async function updateSpacesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: { spaces: Space[]; caps: CapMap; pubAccess: PubAccessMap }) => { spaces: Space[]; caps: CapMap; pubAccess: PubAccessMap },
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms, hash } = await pullSpacesDoc(client, userId);
    const cur = { spaces, caps, pubAccess };
    const next = mutator(cur);
    if (next === cur) return;
    try {
      await client.push(
        spacesPush(userId),
        { v: 1, spaces: next.spaces, caps: next.caps, mutes, reads, pubAccess: next.pubAccess, dms, quickReactions, archivedDms },
        hash,
      );
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

export async function updateMutesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: MutePrefs) => MutePrefs | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(mutes);
    if (!next) return;
    try {
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes: next, reads, pubAccess, dms, quickReactions, archivedDms }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

export async function updateReadsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: ReadPrefs) => ReadPrefs | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(reads);
    if (!next) return;
    try {
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads: next, pubAccess, dms, quickReactions, archivedDms }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

export async function updateDmsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: DmMap) => DmMap | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(dms);
    if (!next) return;
    try {
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads, pubAccess, dms: next, quickReactions, archivedDms }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

export async function updateQuickReactionsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: string[]) => string[] | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(quickReactions);
    if (!next) return;
    try {
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads, pubAccess, dms, quickReactions: next, archivedDms }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

export async function updateArchivedDmsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: ArchivedDms) => ArchivedDms | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(archivedDms);
    if (!next) return;
    try {
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads, pubAccess, dms, quickReactions, archivedDms: next }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

export async function setDmMapping(
  client: StarfishClient,
  userId: string,
  peerUserId: string,
  spaceId: string,
): Promise<void> {
  await updateDmsDoc(client, userId, (cur) => (cur[peerUserId] === spaceId ? null : { ...cur, [peerUserId]: spaceId }));
}

export async function writeSpaces(
  client: StarfishClient,
  userId: string,
  spaces: Space[],
  _hash: string | null,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({ spaces, caps: cur.caps, pubAccess: cur.pubAccess }));
}

export async function reorderSpaces(client: StarfishClient, userId: string, order: string[]): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => {
    const byId = new Map(cur.spaces.map((s) => [s.id, s]));
    const next: Space[] = [];
    for (const id of order) {
      const s = byId.get(id);
      if (s) { next.push(s); byId.delete(id); }
    }
    for (const s of cur.spaces) if (byId.has(s.id)) next.push(s);
    const unchanged = next.length === cur.spaces.length && next.every((s, i) => s === cur.spaces[i]);
    if (unchanged) return cur;
    return { spaces: next, caps: cur.caps, pubAccess: cur.pubAccess };
  });
}

function newSpaceId(): string {
  return `sp-${randomId()}`;
}

export async function readSpaceAccess(
  client: StarfishClient,
  spaceId: string,
): Promise<{ owner: string | null; members: string[]; name: string | null; image: string | null; hash: string | null }> {
  const res = await client.pull(spaceAccessPull(spaceId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as { owner?: string; members?: unknown[]; name?: string; image?: string } | undefined;
  return {
    owner: typeof data?.owner === 'string' ? data.owner : null,
    members: Array.isArray(data?.members) ? data!.members!.filter((m): m is string => typeof m === 'string') : [],
    name: typeof data?.name === 'string' ? data.name : null,
    image: typeof data?.image === 'string' ? data.image : null,
    hash: res?.hash ?? null,
  };
}

export async function writeSpaceAccess(
  client: StarfishClient,
  spaceId: string,
  owner: string,
  members: string[],
  hash: string | null,
  meta?: SpaceMeta,
): Promise<void> {
  const name = meta?.name?.trim() || undefined;
  const image = meta?.image || undefined;
  await client.push(
    spaceAccessPush(spaceId),
    {
      v: 1, owner, members,
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
    },
    hash,
  );
}

export async function addSpaceMember(
  client: StarfishClient,
  spaceId: string,
  ownerUserId: string,
  memberUserId: string,
): Promise<void> {
  const { owner, members, name, image, hash } = await readSpaceAccess(client, spaceId);
  if (memberUserId === (owner ?? ownerUserId) || members.includes(memberUserId)) return;
  await writeSpaceAccess(client, spaceId, owner ?? ownerUserId, [...members, memberUserId], hash, { name, image });
}

/** Remove a member from the space roster (used for link revocation). */
export async function removeSpaceMember(
  client: StarfishClient,
  spaceId: string,
  memberUserId: string,
): Promise<void> {
  const { owner, members, name, image, hash } = await readSpaceAccess(client, spaceId);
  if (!members.includes(memberUserId)) return;
  await writeSpaceAccess(client, spaceId, owner ?? memberUserId, members.filter((m) => m !== memberUserId), hash, { name, image });
}

/** Invitee/owner-side: drop a space from the identity's own list + forget its cap
 *  and link-access credential. Idempotent (no-op when absent). */
export async function removeJoinedSpace(client: StarfishClient, userId: string, spaceId: string): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => {
    if (!cur.spaces.some((s) => s.id === spaceId)) return cur;
    const caps = { ...cur.caps }; delete caps[spaceId];
    const pubAccess = { ...cur.pubAccess }; delete pubAccess[spaceId];
    return { spaces: cur.spaces.filter((s) => s.id !== spaceId), caps, pubAccess };
  });
}

/** Move one space to an absolute index in the list (clamped). No-op if absent or
 *  already there. For relative up/down, callers pass `currentIndex ± 1`. */
export async function moveSpace(client: StarfishClient, userId: string, spaceId: string, toIndex: number): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => {
    const from = cur.spaces.findIndex((s) => s.id === spaceId);
    if (from === -1) return cur;
    const next = [...cur.spaces];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
    if (next.every((s, i) => s === cur.spaces[i])) return cur;
    return { spaces: next, caps: cur.caps, pubAccess: cur.pubAccess };
  });
}

export async function addJoinedSpace(client: StarfishClient, userId: string, space: Space): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) =>
    cur.spaces.some((s) => s.id === space.id)
      ? cur
      : { spaces: [...cur.spaces, space], caps: cur.caps, pubAccess: cur.pubAccess },
  );
}

export async function addJoinedSpaceWithCap(
  client: StarfishClient,
  userId: string,
  space: Space,
  capJson: string,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({
    spaces: cur.spaces.some((s) => s.id === space.id) ? cur.spaces : [...cur.spaces, space],
    caps: { ...cur.caps, [space.id]: capJson },
    pubAccess: cur.pubAccess,
  }));
}

export async function addJoinedSpaceWithLinkAccess(
  client: StarfishClient,
  userId: string,
  space: Space,
  sealed: SealedBlob,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({
    spaces: cur.spaces.some((s) => s.id === space.id) ? cur.spaces : [...cur.spaces, space],
    caps: cur.caps,
    pubAccess: { ...cur.pubAccess, [space.id]: sealed },
  }));
}

/**
 * Create a new space owned by the identity. Seeds an empty plaintext object index.
 * Apps populate the index with their own object types after creation using `createNode`.
 */
export async function createSpace(
  session: Session,
  name: string,
): Promise<Space> {
  const { accountClient, userId } = session;
  const { spaces, hash } = await readSpaces(accountClient, userId);
  const trimmed = name.trim() || 'New Space';
  const id = newSpaceId();
  const space: Space = {
    id,
    name: trimmed,
    short: trimmed.slice(0, 2).toUpperCase(),
    members: 1,
  };
  await writeSpaceAccess(accountClient, id, userId, [], null, { name: trimmed });
  await seedSpaceObjectIndex(session, id);
  await writeSpaces(accountClient, userId, [...spaces, space], hash);
  return space;
}

export async function reconcileSpaceMeta(
  client: StarfishClient,
  userId: string,
  spaceId: string,
  shared: SpaceMeta,
  knownSpaces?: Space[],
): Promise<void> {
  const sharedName = typeof shared.name === 'string' && shared.name.trim() ? shared.name : null;
  const sharedImage = typeof shared.image === 'string' && shared.image ? shared.image : null;
  if (sharedName === null && sharedImage === null) return;
  const known = knownSpaces?.find((s) => s.id === spaceId);
  if (known) {
    const name = sharedName ?? known.name;
    const short = name.slice(0, 2).toUpperCase();
    const image = sharedImage ?? known.image;
    if (name === known.name && short === known.short && (image ?? null) === (known.image ?? null)) return;
  }
  const { spaces, hash } = await readSpaces(client, userId);
  const cur = spaces.find((s) => s.id === spaceId);
  if (!cur) return;
  const name = sharedName ?? cur.name;
  const image = sharedImage ?? cur.image;
  const short = name.slice(0, 2).toUpperCase();
  if (name === cur.name && short === cur.short && (image ?? null) === (cur.image ?? null)) return;
  const next = spaces.map((s) => (s.id === spaceId ? { ...s, name, short, image } : s));
  await writeSpaces(client, userId, next, hash);
  broadcastSpaceMeta(spaceId, { name, short, image });
}
