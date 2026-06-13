/**
 * Cross-language conformance for objects/objects.ts.
 * Shares tests/test-vectors/objects-tree.json with the Python suite.
 */
import { describe, it, expect } from 'vitest';
import type { ObjectNode } from '../core/types.js';
import {
  addObject,
  breadcrumbs,
  buildTree,
  nextOrder,
  patchObject,
  subtreeIds,
} from './objects.js';
import vectors from '../../../../../tests/test-vectors/objects-tree.json';

const NOW = vectors.now;

describe('nextOrder (vectors)', () => {
  for (const c of vectors.nextOrder) {
    it(`siblings length ${c.siblings.length} → ${c.expected}`, () => {
      expect(nextOrder(c.siblings as ObjectNode[])).toBe(c.expected);
    });
  }
});

describe('buildTree (vectors)', () => {
  it('flat', () => {
    const v = vectors.buildTree_flat;
    const tree = buildTree(v.input as ObjectNode[]);
    expect(tree.map((n) => n.id)).toEqual(v.expected_ids_in_order);
    expect(tree.length).toBe(v.expected_lengths.root);
  });

  it('nested', () => {
    const v = vectors.buildTree_nested;
    const tree = buildTree(v.input as ObjectNode[]);
    expect(tree.map((n) => n.id)).toEqual(v.expected_root_ids);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(v.expected_folder_child_ids);
  });

  it('archived excluded', () => {
    const v = vectors.buildTree_archived;
    const tree = buildTree(v.input as ObjectNode[]);
    expect(tree.map((n) => n.id)).toEqual(v.expected_root_ids);
  });

  it('orphan repaired to root', () => {
    const v = vectors.buildTree_orphan;
    const tree = buildTree(v.input as ObjectNode[]);
    expect(tree.map((n) => n.id)).toEqual(v.expected_root_ids);
  });
});

describe('breadcrumbs (vectors)', () => {
  for (const c of vectors.breadcrumbs.cases) {
    it(`breadcrumbs for ${c.nodeId}`, () => {
      const crumbs = breadcrumbs(vectors.breadcrumbs.input as ObjectNode[], c.nodeId);
      expect(crumbs.map((n) => n.id)).toEqual(c.expected_ids);
    });
  }
});

describe('subtreeIds (vectors)', () => {
  for (const c of vectors.subtreeIds.cases) {
    it(`subtreeIds for ${c.nodeId}`, () => {
      const result = subtreeIds(vectors.subtreeIds.input as ObjectNode[], c.nodeId);
      expect([...result].sort()).toEqual([...c.expected_ids].sort());
    });
  }
});

describe('addObject (vectors)', () => {
  it('adds an object with correct fields', () => {
    const v = vectors.addObject;
    const result = addObject(v.input_nodes as ObjectNode[], v.input as Parameters<typeof addObject>[1], NOW);
    expect(result.node.title).toBe(v.expected_title);
    expect(result.node.parentId).toBe(v.expected_parentId);
    expect(result.node.type).toBe(v.expected_type);
    expect(typeof result.node.id).toBe('string');
  });
});

describe('patchObject (vectors)', () => {
  it('patches a node title', () => {
    const v = vectors.patchObject;
    const nodes = patchObject(v.input as ObjectNode[], v.nodeId, v.patch, NOW);
    const patched = nodes.find((n) => n.id === v.nodeId)!;
    expect(patched.title).toBe(v.expected_title);
  });
});
