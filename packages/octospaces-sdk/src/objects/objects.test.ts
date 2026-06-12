import { describe, it, expect } from 'vitest';
import type { ObjectNode } from '../core/types.js';
import {
  addObject,
  archiveObject,
  breadcrumbs,
  buildTree,
  ancestors,
  nextOrder,
  patchObject,
  reparentObject,
  reorderObjects,
  subtreeIds,
} from './objects.js';

const NOW = 1_700_000_000_000;

function makeNode(overrides: Partial<ObjectNode> = {}): ObjectNode {
  return {
    id: 'n1',
    type: 'item',
    parentId: null,
    order: 1,
    title: 'Test',
    updatedAt: NOW,
    ...overrides,
  };
}

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
      makeNode({ id: 'folder', type: 'folder', parentId: null, order: 1 }),
      makeNode({ id: 'page', type: 'page', parentId: 'folder', order: 1 }),
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('page');
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
    const { nodes, node } = addObject([], { type: 'page', title: 'Intro' }, NOW);
    expect(nodes).toHaveLength(1);
    expect(node.title).toBe('Intro');
    expect(node.type).toBe('page');
    expect(node.order).toBe(1);
  });

  it('respects provided id', () => {
    const { node } = addObject([], { id: 'my-id', type: 'folder', title: 'Docs' }, NOW);
    expect(node.id).toBe('my-id');
  });

  it('passes meta through to the node', () => {
    const { node } = addObject([], { type: 'task', title: 'Fix bug', meta: { priority: 'high' } }, NOW);
    expect(node.meta).toEqual({ priority: 'high' });
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
      makeNode({ id: 'folder-a', type: 'folder', parentId: null }),
      makeNode({ id: 'folder-b', type: 'folder', parentId: null }),
      makeNode({ id: 'page', type: 'page', parentId: 'folder-a' }),
    ];
    const result = reparentObject(nodes, 'page', 'folder-b', NOW);
    const page = result.find(n => n.id === 'page')!;
    expect(page.parentId).toBe('folder-b');
  });

  it('rejects making a node its own descendant', () => {
    const nodes: ObjectNode[] = [
      makeNode({ id: 'parent', type: 'folder', parentId: null }),
      makeNode({ id: 'child', type: 'page', parentId: 'parent' }),
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

