"""Generic object-tree model — pure logic over a space's object index.

Mirrors ``packages/ts/octospaces-sdk/src/objects/objects.ts`` exactly.

A space's contents are :class:`ObjectNode` dicts in one union-merged index doc
at ``spaces/{spaceId}/objects/_index``.  This module is the pure, testable
core: tree builder + merge-artifact guards, breadcrumbs, ordering, and node
reducers.

Because the index is union-merged (per-node last-write-wins keyed on
``updatedAt``), the tree is eventually consistent — two devices can
concurrently produce a cycle or an orphan.  ``build_tree`` is the single place
those are repaired.
"""

from __future__ import annotations

from typing import Any, Optional

from octospaces_sdk.core.ids import random_id
from octospaces_sdk.core.types import ID, NodeAccess, ObjectNode, ObjectType


# ── Tree node (render tree shape) ─────────────────────────────────────────────


class ObjectTreeNode(dict):  # type: ignore[type-arg]
    """An ``ObjectNode`` dict augmented with ``depth`` and ``children``."""


def _compare_siblings(a: ObjectNode, b: ObjectNode) -> int:
    oa, ob = a.get("order", 0), b.get("order", 0)  # type: ignore[misc]
    if oa != ob:
        return -1 if oa < ob else 1
    aid, bid = a["id"], b["id"]  # type: ignore[index]
    return -1 if aid < bid else (1 if aid > bid else 0)


def next_order(siblings: list[ObjectNode]) -> int:
    """The order value for a new node appended after *siblings*."""
    max_order = 0
    for s in siblings:
        o = s.get("order", 0)  # type: ignore[misc]
        if o > max_order:
            max_order = o
    return max_order + 1


def build_tree(
    nodes: list[ObjectNode], include_archived: bool = False
) -> list[ObjectTreeNode]:
    """Build the render tree from a flat node list, repairing merge artifacts.

    - **Archived** nodes (and their subtrees) are dropped unless
      *include_archived* is ``True``.
    - **Orphans** — a ``parentId`` that is missing or archived — reparent to
      root (``None``).
    - **Cycles** — a node reachable from itself via ``parentId`` — reparent to
      root.
    - **Siblings** sort by ``(order, id)`` for cross-device determinism.
    """
    live = nodes if include_archived else [n for n in nodes if not n.get("archived")]
    by_id: dict[ID, ObjectNode] = {n["id"]: n for n in live}  # type: ignore[index]

    def effective_parent(n: ObjectNode) -> ID | None:
        pid = n.get("parentId")  # type: ignore[misc]
        if pid is None:
            return None
        if pid not in by_id:
            return None
        seen: set[ID] = {n["id"]}  # type: ignore[index]
        cur: ID | None = pid
        while cur is not None:
            if cur in seen:
                return None
            seen.add(cur)
            parent = by_id.get(cur)
            if parent is None:
                return None
            cur = parent.get("parentId")  # type: ignore[misc]
        return pid

    children_of: dict[ID | None, list[ObjectNode]] = {}
    for n in live:
        p = effective_parent(n)
        bucket = children_of.setdefault(p, [])
        bucket.append(n)

    def attach(parent: ID | None, depth: int) -> list[ObjectTreeNode]:
        bucket = sorted(children_of.get(parent, []), key=lambda n: (n.get("order", 0), n["id"]))  # type: ignore[index]
        result: list[ObjectTreeNode] = []
        for n in bucket:
            node: ObjectTreeNode = dict(n)  # type: ignore[assignment]
            node["depth"] = depth
            node["children"] = attach(n["id"], depth + 1)  # type: ignore[index]
            result.append(node)
        return result

    return attach(None, 0)


def breadcrumbs(nodes: list[ObjectNode], id: ID) -> list[ObjectNode]:
    """Root → node trail (inclusive). Returns ``[]`` if unknown."""
    by_id: dict[ID, ObjectNode] = {n["id"]: n for n in nodes}  # type: ignore[index]
    trail: list[ObjectNode] = []
    seen: set[ID] = set()
    cur: ID | None = id
    while cur is not None and cur in by_id and cur not in seen:
        seen.add(cur)
        node = by_id[cur]
        trail.insert(0, node)
        cur = node.get("parentId")  # type: ignore[misc]
    return trail


def ancestors(nodes: list[ObjectNode], id: ID) -> list[ObjectNode]:
    """Root → parent trail (EXCLUSIVE of the node itself)."""
    return breadcrumbs(nodes, id)[:-1]


def subtree_ids(nodes: list[ObjectNode], root_id: ID) -> set[ID]:
    """The ids of a node and its whole subtree (for cascade-archive)."""
    children_of: dict[ID | None, list[ID]] = {}
    for n in nodes:
        bucket = children_of.setdefault(n.get("parentId"), [])  # type: ignore[misc]
        bucket.append(n["id"])  # type: ignore[index]

    out: set[ID] = set()

    def walk(id: ID) -> None:
        if id in out:
            return
        out.add(id)
        for child in children_of.get(id, []):
            walk(child)

    walk(root_id)
    return out


# ── Node reducers (pure: list[ObjectNode] → list[ObjectNode]) ─────────────────


class NewObjectInput(dict):  # type: ignore[type-arg]
    """Input for :func:`add_object`.  All keys are optional except ``type`` and
    ``title``."""


def add_object(
    nodes: list[ObjectNode],
    input: dict[str, Any],
    now: int,
) -> dict[str, Any]:
    """Append a new node under ``parentId`` at the end of its sibling order.

    Returns ``{"nodes": <new list>, "node": <the created node>}``.
    """
    parent_id: ID | None = input.get("parentId")
    siblings = [n for n in nodes if n.get("parentId") == parent_id]  # type: ignore[misc]
    node: ObjectNode = {
        "id": input.get("id") or f"obj-{random_id()}",
        "type": input["type"],
        "parentId": parent_id,
        "order": next_order(siblings),
        "title": input["title"],
        "updatedAt": now,
    }
    if input.get("emoji"):
        node["emoji"] = input["emoji"]  # type: ignore[typeddict-unknown-key]
    if input.get("meta"):
        node["meta"] = input["meta"]  # type: ignore[typeddict-unknown-key]
    access = input.get("access")
    if access and access != "space":
        node["access"] = access  # type: ignore[typeddict-unknown-key]
    if input.get("enc"):
        node["enc"] = True  # type: ignore[typeddict-unknown-key]
    return {"nodes": [*nodes, node], "node": node}


def patch_object(
    nodes: list[ObjectNode],
    id: ID,
    patch: dict[str, Any],
    now: int,
) -> list[ObjectNode]:
    """Patch mutable metadata (title/emoji/meta/access/enc), bumping ``updatedAt``."""
    return [
        dict(n, **patch, updatedAt=now) if n["id"] == id else n  # type: ignore[index]
        for n in nodes
    ]


def reparent_object(
    nodes: list[ObjectNode],
    id: ID,
    parent_id: ID | None,
    now: int,
) -> list[ObjectNode]:
    """Reparent a node (move in the tree). Rejects making a node its own descendant."""
    if id == parent_id:
        return nodes
    if parent_id is not None and parent_id in subtree_ids(nodes, id):
        return nodes
    siblings = [n for n in nodes if n.get("parentId") == parent_id and n["id"] != id]  # type: ignore[index, misc]
    return [
        dict(n, parentId=parent_id, order=next_order(siblings), updatedAt=now)  # type: ignore[index]
        if n["id"] == id  # type: ignore[index]
        else n
        for n in nodes
    ]


def reorder_objects(
    nodes: list[ObjectNode],
    order_by_id: dict[ID, int],
    now: int,
) -> list[ObjectNode]:
    """Set explicit sibling order (drag-reorder)."""
    return [
        dict(n, order=order_by_id[n["id"]], updatedAt=now)  # type: ignore[index]
        if n["id"] in order_by_id  # type: ignore[index]
        else n
        for n in nodes
    ]


def archive_object(nodes: list[ObjectNode], id: ID, now: int) -> list[ObjectNode]:
    """Cascade-archive a node and its whole subtree (soft delete)."""
    ids = subtree_ids(nodes, id)
    return [
        dict(n, archived=True, updatedAt=now) if n["id"] in ids else n  # type: ignore[index]
        for n in nodes
    ]
