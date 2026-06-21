"""Object index — seed / read / update the ``_index`` doc for a space.

Mirrors ``packages/ts/octospaces-sdk/src/spaces/object-index.ts``.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Optional

from octospaces_sdk.core.types import ObjectNode
from octospaces_sdk.sync.identity import Session
from octospaces_sdk.sync.paths import obj_index_pull, obj_index_push

_MAX_RETRIES = 3


def _strip_invite_node(node: ObjectNode) -> ObjectNode:
    """Strip title/emoji from invite nodes before writing to the shared index."""
    if node.get("access") == "invite":
        stripped = dict(node)
        stripped.pop("title", None)
        stripped.pop("emoji", None)
        return stripped  # type: ignore[return-value]
    return node


async def push_index_seed(client: Any, space_id: str, nodes: list[ObjectNode] | None = None) -> None:
    """Idempotently write an empty (or seeded) object index."""
    path_r = obj_index_pull(space_id)
    path_w = obj_index_push(space_id)

    existing = await client.pull(path_r)
    if existing and existing.get("data"):
        return  # Already seeded

    now = int(time.time() * 1000)
    index = {"v": 2, "objects": nodes or [], "updatedAt": now}
    await client.push(path_w, index)


async def seed_space_object_index(session: Session, space_id: str, nodes: list[ObjectNode] | None = None) -> None:
    await push_index_seed(session.content_client, space_id, nodes)


async def update_object_index(
    session: Session,
    space_id: str,
    mutator: Callable[[list[ObjectNode]], list[ObjectNode]],
    _reg: Any = None,
) -> None:
    """Read-modify-write the object index with up to 3 retries on conflict."""
    path_r = obj_index_pull(space_id)
    path_w = obj_index_push(space_id)

    for _ in range(_MAX_RETRIES):
        doc = await session.content_client.pull(path_r)
        data = doc.get("data", {}) if doc else {}
        base_hash = doc.get("hash") if doc else None
        nodes: list[ObjectNode] = data.get("objects", [])
        now = int(time.time() * 1000)
        updated = mutator(nodes)
        # Strip invite titles before writing
        clean = [_strip_invite_node(n) for n in updated]
        index = {**data, "objects": clean, "updatedAt": now}
        try:
            await session.content_client.push(path_w, index, base_hash=base_hash)
            return
        except Exception as exc:
            if "conflict" in str(exc).lower():
                continue
            raise
    raise RuntimeError("Failed to update object index after retries")


async def read_object_tree(session: Session, space_id: str) -> list[ObjectNode]:
    """Pull the object index and return the flat node list."""
    doc = await session.content_client.pull(obj_index_pull(space_id))
    data = doc.get("data", {}) if doc else {}
    return data.get("objects", [])
