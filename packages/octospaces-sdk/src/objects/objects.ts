/**
 * Unified Object model — pure logic over the space object index.
 *
 * A space's contents (rooms, categories, docs, projects, tasks, …) are
 * {@link ObjectNode}s in one union-merged index doc at
 * `spaces/{spaceId}/objects/_index`. THIS module is the pure, testable core:
 * the tree builder + merge-artifact guards, breadcrumbs, ordering, and the node
 * reducers a `store.set` applies.
 *
 * Because the index is union-merged (per-node last-write-wins keyed on `updatedAt`),
 * the tree is eventually consistent — two devices can concurrently produce a cycle
 * or an orphan. The builder below is the single place those are repaired so every
 * consumer renders a well-formed tree.
 *
 * **Transitional bridges** (`objectsToRoomCategories`, `roomKindToSubtype`, …) project
 * the object tree into the legacy `Room`-based shape that apps still speak during their
 * migration onto the object model. They are purely mechanical projections over
 * `ObjectNode` and carry no domain-specific names.
 */
import type { ID, ObjectNode, ObjectType, Room, RoomSubtype } from '../core/types.js';
import { randomId, roomSlug } from '../core/ids.js';

/** The bucket new/unfiled objects land in, and the fallback a deleted category's
 *  objects are reassigned to. */
export const DEFAULT_CATEGORY = 'CHANNELS';

/** Deterministic category-node id from its name, so two devices that concurrently
 *  create the SAME category mint the SAME id → the union-merge dedupes them. */
export const categoryId = (name: string): ID => `cat-${roomSlug(name) || randomId()}`;

/** A node plus its resolved children — the shape a tree view renders. */
export interface ObjectTreeNode extends ObjectNode {
  depth: number;
  children: ObjectTreeNode[];
}

/** Map a legacy {@link Room} `kind` to the unified room {@link RoomSubtype}. */
export function roomKindToSubtype(kind: Room['kind']): RoomSubtype {
  switch (kind) {
    case 'dm': return 'dm';
    case 'automated': return 'automation';
    default: return 'channel';
  }
}

/** Inverse of {@link roomKindToSubtype}. A legacy persisted `'stream'` subtype hits
 *  the `default` and reads back as a plain `'channel'` (normalization). */
export function subtypeToRoomKind(subtype: RoomSubtype | undefined): Room['kind'] {
  switch (subtype) {
    case 'dm': return 'dm';
    case 'automation': return 'automated';
    default: return 'channel';
  }
}

function compareSiblings(a: ObjectNode, b: ObjectNode): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The order value for a new node appended after `siblings`. */
export function nextOrder(siblings: ObjectNode[]): number {
  let max = 0;
  for (const s of siblings) if (s.order > max) max = s.order;
  return max + 1;
}

/**
 * Build the render tree from a flat node list, repairing merge artifacts:
 *  - **archived** nodes (and their subtrees) are dropped.
 *  - **orphans** — a `parentId` that is missing or archived — reparent to root.
 *  - **cycles** — a node reachable from itself via `parentId` — reparent to root.
 *  - **siblings** sort by {@link compareSiblings} for cross-device determinism.
 */
export function buildTree(nodes: ObjectNode[], includeArchived = false): ObjectTreeNode[] {
  const live = includeArchived ? nodes : nodes.filter((n) => !n.archived);
  const byId = new Map<ID, ObjectNode>(live.map((n) => [n.id, n]));

  const effectiveParent = (n: ObjectNode): ID | null => {
    if (n.parentId == null) return null;
    if (!byId.has(n.parentId)) return null;
    const seen = new Set<ID>([n.id]);
    let cur: ID | null = n.parentId;
    while (cur != null) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      const parent = byId.get(cur);
      if (!parent) return null;
      cur = parent.parentId;
    }
    return n.parentId;
  };

  const childrenOf = new Map<ID | null, ObjectNode[]>();
  for (const n of live) {
    const p = effectiveParent(n);
    const bucket = childrenOf.get(p) ?? [];
    bucket.push(n);
    childrenOf.set(p, bucket);
  }

  function attach(parent: ID | null, depth: number): ObjectTreeNode[] {
    return (childrenOf.get(parent) ?? [])
      .slice()
      .sort(compareSiblings)
      .map((n): ObjectTreeNode => ({ ...n, depth, children: attach(n.id, depth + 1) }));
  }

  return attach(null, 0);
}

/** The root→node trail (inclusive) for breadcrumbs. Returns `[]` if unknown. */
export function breadcrumbs(nodes: ObjectNode[], id: ID): ObjectNode[] {
  const byId = new Map<ID, ObjectNode>(nodes.map((n) => [n.id, n]));
  const trail: ObjectNode[] = [];
  const seen = new Set<ID>();
  let cur: ID | null = id;
  while (cur != null && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const node: ObjectNode = byId.get(cur)!;
    trail.unshift(node);
    cur = node.parentId;
  }
  return trail;
}

/** The root→parent trail (EXCLUSIVE of the node itself). */
export function ancestors(nodes: ObjectNode[], id: ID): ObjectNode[] {
  return breadcrumbs(nodes, id).slice(0, -1);
}

/** The ids of a node and its whole subtree (for cascade-archive). */
export function subtreeIds(nodes: ObjectNode[], rootId: ID): Set<ID> {
  const childrenOf = new Map<ID | null, ID[]>();
  for (const n of nodes) {
    const bucket = childrenOf.get(n.parentId) ?? [];
    bucket.push(n.id);
    childrenOf.set(n.parentId, bucket);
  }
  const out = new Set<ID>();
  const walk = (id: ID) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return out;
}

// ── Node reducers (pure: ObjectNode[] → ObjectNode[]) ─────────────────────────

export interface NewObjectInput {
  type: ObjectType;
  subtype?: RoomSubtype;
  parentId?: ID | null;
  title: string;
  emoji?: string;
  automation?: import('../core/types.js').AutomationMeta;
  /** Provide to reuse an id (e.g. a room id derived elsewhere); else minted. */
  id?: ID;
}

/** Append a new node under `parentId` at the end of its sibling order. */
export function addObject(nodes: ObjectNode[], input: NewObjectInput, now: number): { nodes: ObjectNode[]; node: ObjectNode } {
  const parentId = input.parentId ?? null;
  const siblings = nodes.filter((n) => n.parentId === parentId);
  const node: ObjectNode = {
    id: input.id ?? `obj-${randomId()}`,
    type: input.type,
    ...(input.subtype ? { subtype: input.subtype } : {}),
    parentId,
    order: nextOrder(siblings),
    title: input.title,
    ...(input.emoji ? { emoji: input.emoji } : {}),
    updatedAt: now,
    ...(input.automation ? { automation: input.automation } : {}),
  };
  return { nodes: [...nodes, node], node };
}

/** Patch a node's mutable metadata (title/emoji/automation), bumping `updatedAt`. */
export function patchObject(nodes: ObjectNode[], id: ID, patch: Partial<Pick<ObjectNode, 'title' | 'emoji' | 'automation'>>, now: number): ObjectNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now } : n));
}

/** Reparent a node (move in the tree). Rejects making a node its own descendant. */
export function reparentObject(nodes: ObjectNode[], id: ID, parentId: ID | null, now: number): ObjectNode[] {
  if (id === parentId) return nodes;
  if (parentId != null && subtreeIds(nodes, id).has(parentId)) return nodes;
  const siblings = nodes.filter((n) => n.parentId === parentId && n.id !== id);
  return nodes.map((n) => (n.id === id ? { ...n, parentId, order: nextOrder(siblings), updatedAt: now } : n));
}

/** Set explicit sibling order (drag-reorder). */
export function reorderObjects(nodes: ObjectNode[], orderById: Record<ID, number>, now: number): ObjectNode[] {
  return nodes.map((n) => (n.id in orderById ? { ...n, order: orderById[n.id]!, updatedAt: now } : n));
}

/** Cascade-archive a node and its whole subtree (soft delete). */
export function archiveObject(nodes: ObjectNode[], id: ID, now: number): ObjectNode[] {
  const ids = subtreeIds(nodes, id);
  return nodes.map((n) => (ids.has(n.id) ? { ...n, archived: true, updatedAt: now } : n));
}

// ── Transitional bridges (Room-based projections) ─────────────────────────────
// Used while apps migrate their content onto the generic object model. Both apps
// still speak the legacy `Room` type; these projections stay until that migration
// is complete.

/** The category→rooms grouping the legacy UI consumes. */
export interface AdaptedCategory {
  name: string;
  rooms: Room[];
}

/**
 * Project the room/category nodes of an index into the legacy `{ name, rooms }[]`
 * shape that app UIs still consume. Category nodes become buckets; room nodes become
 * {@link Room}s grouped under their parent category (or `fallbackCategory` at root).
 * Returns null when the index holds no room/category nodes yet.
 *
 * @deprecated Use the object tree directly once apps complete their migration.
 */
export function objectsToRoomCategories(nodes: ObjectNode[], spaceId: string, fallbackCategory: string): AdaptedCategory[] | null {
  const live = nodes.filter((n) => !n.archived);
  const cats = live.filter((n) => n.type === 'category').slice().sort(compareSiblings);
  const rooms = live.filter((n) => n.type === 'room');
  if (cats.length === 0 && rooms.length === 0) return null;

  const titleById = new Map<ID, string>(cats.map((c) => [c.id, c.title]));
  const buckets = new Map<string, Room[]>();
  for (const c of cats) buckets.set(c.title, []);

  const toRoom = (n: ObjectNode, category: string): Room => ({
    id: n.id,
    spaceId,
    category,
    name: n.title,
    kind: subtypeToRoomKind(n.subtype),
    ...(n.automation ? { automation: n.automation } : {}),
  });

  for (const n of rooms.slice().sort(compareSiblings)) {
    const category = (n.parentId != null && titleById.get(n.parentId)) || fallbackCategory;
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category)!.push(toRoom(n, category));
  }
  return [...buckets.entries()].map(([name, rs]) => ({ name, rooms: rs }));
}

/**
 * Drop `kind: 'automated'` rooms from a category list (they belong to an Agents
 * view, not the main room list). A category that held only agents is removed too.
 *
 * @deprecated Use the object tree directly once apps complete their migration.
 */
export function excludeAutomatedRooms(categories: AdaptedCategory[]): AdaptedCategory[] {
  return categories
    .map((c) => ({ ...c, rooms: c.rooms.filter((r) => r.kind !== 'automated') }))
    .filter((c, i) => c.rooms.length > 0 || categories[i].rooms.length === 0);
}

// ── Seed: build the initial index nodes for a freshly-created space ────────────

/** A minimal object descriptor the {@link seedIndexNodes} builder turns into nodes. */
export interface SeedRoom {
  id: ID;
  name: string;
  kind: Room['kind'];
  category: string;
}

/**
 * Build the initial `ObjectNode[]` for a brand-new space's index: a `category` node
 * per distinct category and a `room` node per seed object parented under it. Pure +
 * deterministic (category ids via {@link categoryId}).
 */
export function seedIndexNodes(rooms: SeedRoom[], now: number): ObjectNode[] {
  const out: ObjectNode[] = [];
  const catId = new Map<string, ID>();
  let catOrder = 0;
  for (const r of rooms) {
    if (catId.has(r.category)) continue;
    const id = categoryId(r.category);
    catId.set(r.category, id);
    out.push({ id, type: 'category', parentId: null, order: catOrder++, title: r.category, updatedAt: now });
  }
  const orderInCat = new Map<ID, number>();
  for (const r of rooms) {
    const parentId = catId.get(r.category)!;
    const order = (orderInCat.get(parentId) ?? 0) + 1;
    orderInCat.set(parentId, order);
    out.push({ id: r.id, type: 'room', subtype: roomKindToSubtype(r.kind), parentId, order, title: r.name, updatedAt: now });
  }
  return out;
}
