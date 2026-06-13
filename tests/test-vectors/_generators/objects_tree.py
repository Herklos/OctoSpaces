"""Generate objects-tree.json — pure object tree logic vector.

Run from the octospaces repo root:
    python3 tests/test-vectors/_generators/objects_tree.py

Writes to:
    tests/test-vectors/objects-tree.json
"""

from __future__ import annotations

import json
import pathlib

NOW = 1_700_000_000_000


def make_node(overrides: dict | None = None) -> dict:
    base = {
        "id": "n1",
        "type": "item",
        "parentId": None,
        "order": 1,
        "title": "Test",
        "updatedAt": NOW,
    }
    if overrides:
        base.update(overrides)
    return base


def main() -> None:
    vectors = {
        "description": (
            "Cross-language vector for pure object-tree logic. "
            "nextOrder, buildTree (flat/nested/archived/orphan/cycle), "
            "breadcrumbs, ancestors, subtreeIds. "
            "Both TS and Python must reproduce these outputs exactly."
        ),
        "now": NOW,
        "nextOrder": [
            {"siblings": [], "expected": 1},
            {"siblings": [make_node({"order": 3}), make_node({"id": "n2", "order": 7})], "expected": 8},
            {"siblings": [make_node({"order": 1})], "expected": 2},
        ],
        "buildTree_flat": {
            "input": [make_node({"id": "a", "order": 1}), make_node({"id": "b", "order": 2})],
            "expected_ids_in_order": ["a", "b"],
            "expected_lengths": {"root": 2},
        },
        "buildTree_nested": {
            "input": [
                make_node({"id": "folder", "type": "folder", "parentId": None, "order": 1}),
                make_node({"id": "page", "type": "page", "parentId": "folder", "order": 1}),
            ],
            "expected_root_ids": ["folder"],
            "expected_folder_child_ids": ["page"],
        },
        "buildTree_archived": {
            "input": [make_node({"id": "a", "archived": True}), make_node({"id": "b"})],
            "expected_root_ids": ["b"],
        },
        "buildTree_orphan": {
            "input": [make_node({"id": "orphan", "parentId": "nonexistent"})],
            "expected_root_ids": ["orphan"],
            "note": "orphan repaired to root",
        },
        "breadcrumbs": {
            "input": [
                make_node({"id": "root", "parentId": None, "order": 1}),
                make_node({"id": "child", "parentId": "root", "order": 1}),
                make_node({"id": "grandchild", "parentId": "child", "order": 1}),
            ],
            "cases": [
                {"nodeId": "grandchild", "expected_ids": ["root", "child", "grandchild"]},
                {"nodeId": "root", "expected_ids": ["root"]},
            ],
        },
        "subtreeIds": {
            "input": [
                make_node({"id": "root", "parentId": None, "order": 1}),
                make_node({"id": "child1", "parentId": "root", "order": 1}),
                make_node({"id": "child2", "parentId": "root", "order": 2}),
                make_node({"id": "grandchild", "parentId": "child1", "order": 1}),
            ],
            "cases": [
                {"nodeId": "root", "expected_ids": ["root", "child1", "child2", "grandchild"]},
                {"nodeId": "child1", "expected_ids": ["child1", "grandchild"]},
            ],
        },
        "addObject": {
            "input_nodes": [],
            "input": {"type": "item", "title": "Hello", "parentId": None},
            "expected_title": "Hello",
            "expected_parentId": None,
            "expected_type": "item",
            "note": "id is random — only type/title/parentId asserted",
        },
        "patchObject": {
            "input": [make_node({"id": "x", "title": "Old"})],
            "patch": {"title": "New"},
            "nodeId": "x",
            "expected_title": "New",
        },
    }

    out_path = pathlib.Path(__file__).resolve().parents[1] / "objects-tree.json"
    out_path.write_text(json.dumps(vectors, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
