/**
 * Space registries (plaintext metadata docs). A user's spaces live at
 * `user/<userId>/_spaces`; each space's ACCESS RECORD (owner/members + shared
 * name/image) at `spaces/<spaceId>/_access`. The object tree lives in the plaintext
 * unified object index (`objects/_index`, see `object-index.ts`); `_access` is the
 * owner-only access record. Spaces are neutral containers — visibility and encryption
 * are per-node properties (see `ObjectNode.access` / `ObjectNode.enc`).
 */
import { StarfishHttpError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { CapMap, MutePrefs, PubAccessMap, ReadPrefs, Space } from '../core/types.js';
import type { SealedBlob } from '../sync/account-seal.js';
import { randomId } from '../core/ids.js';
import type { Session } from '../sync/identity.js';
import { seedSpaceObjectIndex } from './object-index.js';
import { casMutateWithRetry } from '../sync/cas-retry.js';
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

const SPACE_SHORT_LENGTH = 2;
const SPACE_FALLBACK_SUFFIX = 6;

/** Build a Space object from id + name with computed `short` monogram. */
export function buildSpace(id: string, name: string, overrides?: Partial<Space>): Space {
  const trimmed = name.trim() || `space-${id.slice(-SPACE_FALLBACK_SUFFIX)}`;
  return {
    id,
    name: trimmed,
    short: trimmed.slice(0, SPACE_SHORT_LENGTH).toUpperCase(),
    members: 1,
    ...overrides,
  };
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
  /** App-specific registry fields the SDK does not model (e.g. OctoChat's `dms`,
   *  `archivedDms`, `quickReactions`). Round-tripped untouched on every CAS write so a
   *  generic-SDK mutation never drops a consumer's own data. Access via
   *  {@link updateSpacesExtraField} and `readSpaces(...).extra`. */
  extra: Record<string, unknown>;
  hash: string | null;
}

/** The `_spaces` doc body sent on push — the modelled core fields plus any app-specific
 *  fields spread at the top level (never a nested `extra` key). */
type SpacesPayload = {
  spaces: Space[];
  caps: CapMap;
  mutes: MutePrefs;
  reads: ReadPrefs;
  pubAccess: PubAccessMap;
  [key: string]: unknown;
};

/** Core keys the SDK models explicitly; everything else in the doc body lives in `extra`.
 *  `v` is the protocol version (re-added on write); `hash` is the CAS token (never in body). */
const CORE_SPACES_KEYS = new Set(['spaces', 'caps', 'mutes', 'reads', 'pubAccess', 'v', 'hash']);

/** Build the `_spaces` doc body: app-specific `extra` fields spread FIRST so the modelled
 *  core fields always take precedence. No nested `extra` key reaches storage. */
function toPayload(doc: SpacesDoc): SpacesPayload {
  return {
    ...doc.extra,
    spaces: doc.spaces,
    caps: doc.caps,
    mutes: doc.mutes,
    reads: doc.reads,
    pubAccess: doc.pubAccess,
  };
}

/**
 * Read-modify-CAS-write the `_spaces` doc with conflict-retry. `build` receives the
 * freshly-pulled doc and returns the next payload to push, or `null` to skip the
 * write (no-op). Shared by `casUpdateSpacesField` and `updateSpacesDoc`.
 */
async function runCas(
  client: StarfishClient,
  userId: string,
  build: (doc: SpacesDoc) => SpacesPayload | null,
): Promise<void> {
  return casMutateWithRetry({
    load: async () => {
      const doc = await pullSpacesDoc(client, userId);
      return { ctx: doc, hash: doc.hash };
    },
    build: (doc) => {
      const next = build(doc);
      return next === null ? null : { v: 1 as const, ...next };
    },
    push: (payload, hash) => client.push(spacesPush(userId), payload, hash),
  });
}

function casUpdateSpacesField<F extends keyof SpacesDoc>(
  client: StarfishClient,
  userId: string,
  field: F,
  mutate: (cur: SpacesDoc[F], doc: SpacesDoc) => SpacesDoc[F] | null,
): Promise<void> {
  return runCas(client, userId, (doc) => {
    const next = mutate(doc[field], doc);
    if (next === null) return null;
    return { ...toPayload(doc), [field]: next };
  });
}

/** Keep only the entries of a plain object whose value passes `isT`. */
function coerceRecord<T>(raw: unknown, isT: (v: unknown) => v is T): Record<string, T> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(src)) if (isT(v)) out[k] = v;
  return out;
}

function coerceMutes(raw: unknown): MutePrefs {
  // Back-compat: pre-0.16 docs keyed node mutes under `rooms`; new `nodes` wins on overlap.
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown; nodes?: unknown; spaces?: unknown };
  const pick = (v: unknown): Record<string, true | number> =>
    v && typeof v === 'object' ? (v as Record<string, true | number>) : {};
  return { nodes: { ...pick(r.rooms), ...pick(r.nodes) }, spaces: pick(r.spaces) };
}

function coerceReads(raw: unknown): ReadPrefs {
  // Back-compat: pre-0.16 docs keyed read marks under `rooms`.
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown; nodes?: unknown };
  const isTs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return { nodes: { ...coerceRecord(r.rooms, isTs), ...coerceRecord(r.nodes, isTs) } };
}

type RawSpacesDoc = {
  spaces?: Space[];
  caps?: CapMap;
  mutes?: unknown;
  reads?: unknown;
  pubAccess?: PubAccessMap;
} & Record<string, unknown>;

/** Collect every doc-body key the SDK does not model into `extra`, so app-specific
 *  fields (OctoChat's `dms`/`archivedDms`/`quickReactions`, …) survive the round-trip. */
function collectExtra(data: RawSpacesDoc | undefined): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!CORE_SPACES_KEYS.has(k)) extra[k] = v;
  return extra;
}

/** Coerce a raw `_spaces` doc body (or `undefined`) into a typed {@link SpacesDoc}.
 *  Shared by the normal pull path AND the error/empty fallback so the per-field defaults
 *  live in one place — every coercer already maps `undefined` to its empty value. */
function coerceSpacesDoc(data: RawSpacesDoc | undefined, hash: string | null): SpacesDoc {
  return {
    spaces: Array.isArray(data?.spaces) ? data!.spaces! : [],
    caps: data?.caps && typeof data.caps === 'object' ? data.caps : {},
    mutes: coerceMutes(data?.mutes),
    reads: coerceReads(data?.reads),
    pubAccess: data?.pubAccess && typeof data.pubAccess === 'object' ? data.pubAccess : {},
    extra: collectExtra(data),
    hash,
  };
}

async function pullSpacesDoc(client: StarfishClient, userId: string): Promise<SpacesDoc> {
  const res = await client.pull(spacesPull(userId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  return coerceSpacesDoc(res?.data as RawSpacesDoc | undefined, res?.hash ?? null);
}

export async function readSpaces(client: StarfishClient, userId: string): Promise<SpacesDoc> {
  try {
    return await pullSpacesDoc(client, userId);
  } catch (err) {
    console.error('[readSpaces] failed to pull spaces registry', err);
    return coerceSpacesDoc(undefined, null);
  }
}

export function updateSpacesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: { spaces: Space[]; caps: CapMap; pubAccess: PubAccessMap }) => { spaces: Space[]; caps: CapMap; pubAccess: PubAccessMap },
): Promise<void> {
  return runCas(client, userId, (doc) => {
    const cur = { spaces: doc.spaces, caps: doc.caps, pubAccess: doc.pubAccess };
    const next = mutator(cur);
    if (next === cur) return null;
    return { ...toPayload(doc), spaces: next.spaces, caps: next.caps, pubAccess: next.pubAccess };
  });
}

export function updateMutesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: MutePrefs) => MutePrefs | null,
): Promise<void> {
  return casUpdateSpacesField(client, userId, 'mutes', (cur) => mutator(cur));
}

export function updateReadsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: ReadPrefs) => ReadPrefs | null,
): Promise<void> {
  return casUpdateSpacesField(client, userId, 'reads', (cur) => mutator(cur));
}

/**
 * Read-modify-CAS-write ONE app-specific (`extra`) field of the `_spaces` doc. The SDK
 * does not model these keys (e.g. OctoChat's `dms`/`archivedDms`/`quickReactions`); they
 * round-trip untouched through every other registry write. `mutator` receives the current
 * value (or `undefined` when absent) and returns the next value, or `null` to skip the
 * write. Reading the value back: `readSpaces(...).extra[key]`.
 */
export function updateSpacesExtraField<T>(
  client: StarfishClient,
  userId: string,
  key: string,
  mutator: (cur: T | undefined) => T | null,
): Promise<void> {
  return runCas(client, userId, (doc) => {
    const next = mutator(doc.extra[key] as T | undefined);
    if (next === null) return null;
    return { ...toPayload(doc), [key]: next };
  });
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

/** Append a space to the joined list (dup-guarded) plus optional cap / link-access
 *  updates. With no updates AND the space already present, it's a no-op (skips the write). */
function addSpaceWithUpdates(
  client: StarfishClient,
  userId: string,
  space: Space,
  updates?: { caps?: CapMap; pubAccess?: PubAccessMap },
): Promise<void> {
  return updateSpacesDoc(client, userId, (cur) => {
    const exists = cur.spaces.some((s) => s.id === space.id);
    if (exists && !updates) return cur;
    return {
      spaces: exists ? cur.spaces : [...cur.spaces, space],
      caps: updates?.caps ? { ...cur.caps, ...updates.caps } : cur.caps,
      pubAccess: updates?.pubAccess ? { ...cur.pubAccess, ...updates.pubAccess } : cur.pubAccess,
    };
  });
}

export function addJoinedSpace(client: StarfishClient, userId: string, space: Space): Promise<void> {
  return addSpaceWithUpdates(client, userId, space);
}

export function addJoinedSpaceWithCap(client: StarfishClient, userId: string, space: Space, capJson: string): Promise<void> {
  return addSpaceWithUpdates(client, userId, space, { caps: { [space.id]: capJson } });
}

export function addJoinedSpaceWithLinkAccess(client: StarfishClient, userId: string, space: Space, sealed: SealedBlob): Promise<void> {
  return addSpaceWithUpdates(client, userId, space, { pubAccess: { [space.id]: sealed } });
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
  const space = buildSpace(id, trimmed);
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
