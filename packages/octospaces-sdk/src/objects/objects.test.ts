import { describe, it, expect } from 'vitest';
import type { ObjectNode } from '../core/types.js';
import {
  addObject,
  archiveObject,
  breadcrumbs,
  buildTree,
  ancestors,
  categoryId,
  DEFAULT_CATEGORY,
  nextOrder,
  patchObject,
  reparentObject,
  reorderObjects,
  seedIndexNodes,
  subtreeIds,
  objectsToRoomCategories,
  excludeAutomatedRooms,
  roomKindToSubtype,
  subtypeToRoomKind,
} from './objects.js';

const NOW = 1_700_000_000_000;

function makeNode(overrides: Partial<ObjectNode> = {}): ObjectNode {
  return {
    id: 'n1',
    type: 'room',
    parentId: null,
    order: 1,
    title: 'Test',
    updatedAt: NOW,
    ...overrides,
  };
}

describe('DEFAULT_CATEGORY', () => {
  it('is CHANNELS', () => { expect(DEFAULT_CATEGORY).toBe('CHANNELS'); });
});

describe('categoryId', () => {
  it('is deterministic for the same name', () => {
    expect(categoryId('Channels')).toBe(categoryId('Channels'));
  });
  it('differs for different names', () => {
    expect(categoryId('Alpha')).not.toBe(categoryId('Beta'));
  });
  it('starts with cat-', () => {
    expect(categoryId('test')).toMatch(/^cat-/);
  });
});

describe('nextOrder', () => {
  it('returns 1 for empty sibling list', () => {
    expect(nextOrder([])).toBe(1);
  });
  it('returns max+1', () => {
    const siblings = [makeNode({ order: 3 }), makeNode({ id: 'n2', order: 7 })];
    expect(nextOrder(siblings)).toBe(8);
  });
});

describe('buildTree', () => {
  it('builds a flat list for root nodes', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'a', order: 1 }),
      makeNode({ id: 'b', order: 2 }),
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('a');
    expect(tree[1].id).toBe('b');
  });

  it('nests children under their parent', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'cat', type: 'category', parentId: null, order: 1 }),
      makeNode({ id: 'room', type: 'room', parentId: 'cat', order: 1 }),
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('room');
  });

  it('excludes archived nodes by default', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'a', archived: true }),
      makeNode({ id: 'b' }),
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('b');
  });

  it('repairs orphans (parentId missing) → reparents to root', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'orphan', parentId: 'nonexistent' }),
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('orphan');
  });

  it('repairs cycles → reparents cycle node to root', () => {
    // a → b → a is a cycle; both should appear at root without infinite loop
    const nodes: ObjectNode[] = [
      makeNode({ id: 'a', parentId: 'b', order: 1 }),
      makeNode({ id: 'b', parentId: 'a', order: 2 }),
    ];
    const tree = buildTree(nodes);
    expect(tree.length).toBeGreaterThan(0);
  });
});

describe('breadcrumbs + ancestors', () => {
  const nodes: ObjectNode[] = [
    makeNode({ id: 'root', parentId: null, order: 1 }),
    makeNode({ id: 'child', parentId: 'root', order: 1 }),
    makeNode({ id: 'grandchild', parentId: 'child', order: 1 }),
  ];

  it('breadcrumbs returns root→self', () => {
    const trail = breadcrumbs(nodes, 'grandchild');
    expect(trail.map(n => n.id)).toEqual(['root', 'child', 'grandchild']);
  });

  it('ancestors returns root→parent (exclusive)', () => {
    const trail = ancestors(nodes, 'grandchild');
    expect(trail.map(n => n.id)).toEqual(['root', 'child']);
  });
});

describe('subtreeIds', () => {
  const nodes: ObjectNode[] = [
    makeNode({ id: 'root', parentId: null }),
    makeNode({ id: 'child1', parentId: 'root' }),
    makeNode({ id: 'child2', parentId: 'root' }),
    makeNode({ id: 'grandchild', parentId: 'child1' }),
  ];

  it('includes self and all descendants', () => {
    const ids = subtreeIds(nodes, 'root');
    expect([...ids].sort()).toEqual(['child1', 'child2', 'grandchild', 'root'].sort());
  });
});

describe('addObject', () => {
  it('appends a new node with correct order', () => {
    const { nodes, node } = addObject([], { type: 'room', title: 'general' }, NOW);
    expect(nodes).toHaveLength(1);
    expect(node.title).toBe('general');
    expect(node.type).toBe('room');
    expect(node.order).toBe(1);
  });

  it('respects provided id', () => {
    const { node } = addObject([], { id: 'my-id', type: 'category', title: 'Channels' }, NOW);
    expect(node.id).toBe('my-id');
  });
});

describe('patchObject', () => {
  it('updates title and bumps updatedAt', () => {
    const nodes = [makeNode({ id: 'x', title: 'old', updatedAt: 0 })];
    const patched = patchObject(nodes, 'x', { title: 'new' }, NOW);
    expect(patched[0].title).toBe('new');
    expect(patched[0].updatedAt).toBe(NOW);
  });
});

describe('reparentObject', () => {
  it('moves a node to a new parent', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'cat-a', type: 'category', parentId: null }),
      makeNode({ id: 'cat-b', type: 'category', parentId: null }),
      makeNode({ id: 'room', type: 'room', parentId: 'cat-a' }),
    ];
    const result = reparentObject(nodes, 'room', 'cat-b', NOW);
    const room = result.find(n => n.id === 'room')!;
    expect(room.parentId).toBe('cat-b');
  });

  it('rejects making a node its own descendant', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'parent', type: 'category', parentId: null }),
      makeNode({ id: 'child', type: 'room', parentId: 'parent' }),
    ];
    const result = reparentObject(nodes, 'parent', 'child', NOW);
    expect(result).toBe(nodes); // unchanged
  });
});

describe('reorderObjects', () => {
  it('applies explicit order values', () => {
    const nodes = [makeNode({ id: 'x', order: 1 }), makeNode({ id: 'y', order: 2 })];
    const result = reorderObjects(nodes, { x: 5, y: 3 }, NOW);
    const x = result.find(n => n.id === 'x')!;
    const y = result.find(n => n.id === 'y')!;
    expect(x.order).toBe(5);
    expect(y.order).toBe(3);
  });
});

describe('archiveObject', () => {
  it('archives a node and its subtree', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'parent', parentId: null }),
      makeNode({ id: 'child', parentId: 'parent' }),
    ];
    const result = archiveObject(nodes, 'parent', NOW);
    expect(result.find(n => n.id === 'parent')!.archived).toBe(true);
    expect(result.find(n => n.id === 'child')!.archived).toBe(true);
  });
});

describe('seedIndexNodes', () => {
  it('creates category + room nodes', () => {
    const nodes = seedIndexNodes([{ id: 'r1', name: 'general', kind: 'channel', category: 'CHANNELS' }], NOW);
    expect(nodes.some(n => n.type === 'category')).toBe(true);
    expect(nodes.some(n => n.type === 'room')).toBe(true);
  });

  it('dedupes categories', () => {
    const rooms = [
      { id: 'r1', name: 'general', kind: 'channel' as const, category: 'CHANNELS' },
      { id: 'r2', name: 'random', kind: 'channel' as const, category: 'CHANNELS' },
    ];
    const nodes = seedIndexNodes(rooms, NOW);
    const cats = nodes.filter(n => n.type === 'category');
    expect(cats).toHaveLength(1);
  });
});

describe('roomKindToSubtype / subtypeToRoomKind', () => {
  it('channel ↔ channel', () => {
    expect(roomKindToSubtype('channel')).toBe('channel');
    expect(subtypeToRoomKind('channel')).toBe('channel');
  });
  it('dm ↔ dm', () => {
    expect(roomKindToSubtype('dm')).toBe('dm');
    expect(subtypeToRoomKind('dm')).toBe('dm');
  });
  it('automated ↔ automation', () => {
    expect(roomKindToSubtype('automated')).toBe('automation');
    expect(subtypeToRoomKind('automation')).toBe('automated');
  });
});

describe('objectsToRoomCategories', () => {
  it('returns null for empty index', () => {
    expect(objectsToRoomCategories([], 'sp-1', 'CHANNELS')).toBeNull();
  });

  it('groups rooms under their category', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'cat', type: 'category', parentId: null, order: 1, title: 'CHANNELS' }),
      makeNode({ id: 'room', type: 'room', parentId: 'cat', order: 1, title: 'general' }),
    ];
    const cats = objectsToRoomCategories(nodes, 'sp-1', 'CHANNELS')!;
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe('CHANNELS');
    expect(cats[0].rooms[0].name).toBe('general');
  });
});

describe('excludeAutomatedRooms', () => {
  it('removes categories that held ONLY automated rooms', () => {
    const cats = [{ name: 'C', rooms: [{ id: 'r', spaceId: 's', category: 'C', name: 'bot', kind: 'automated' as const }] }];
    const result = excludeAutomatedRooms(cats);
    // A category whose ONLY room was automated gets dropped entirely.
    expect(result).toHaveLength(0);
  });

  it('keeps categories that still have non-automated rooms', () => {
    const cats = [{
      name: 'C',
      rooms: [
        { id: 'r1', spaceId: 's', category: 'C', name: 'bot', kind: 'automated' as const },
        { id: 'r2', spaceId: 's', category: 'C', name: 'general', kind: 'channel' as const },
      ],
    }];
    const result = excludeAutomatedRooms(cats);
    expect(result).toHaveLength(1);
    expect(result[0].rooms).toHaveLength(1);
    expect(result[0].rooms[0].name).toBe('general');
  });
});
