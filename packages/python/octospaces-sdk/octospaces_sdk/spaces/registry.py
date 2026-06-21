"""Spaces registry — ``_spaces`` and ``_access`` RMW helpers.

Mirrors ``packages/ts/octospaces-sdk/src/spaces/registry.ts``.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional, TypedDict

from octospaces_sdk.core.ids import random_id, slugify
from octospaces_sdk.core.types import ID, CapMap, Space
from octospaces_sdk.sync.identity import Session
from octospaces_sdk.sync.paths import space_access_pull, space_access_push, spaces_pull, spaces_push

_MAX_RETRIES = 3


class SpaceMeta(TypedDict, total=False):
    name: Optional[str]
    image: Optional[str]


class SpaceMetaUpdate(TypedDict):
    name: str
    short: str
    image: Optional[str]


# Module-level listener bus for SpaceMeta updates
_meta_listeners: list[Callable[[str, SpaceMetaUpdate], None]] = []


def on_space_meta(fn: Callable[[str, SpaceMetaUpdate], None]) -> Callable[[], None]:
    _meta_listeners.append(fn)
    return lambda: _meta_listeners.remove(fn)


def broadcast_space_meta(space_id: str, meta: SpaceMetaUpdate) -> None:
    for fn in list(_meta_listeners):
        fn(space_id, meta)


# ── Spaces doc ────────────────────────────────────────────────────────────────


async def read_spaces(client: Any, user_id: str) -> dict[str, Any]:
    path = spaces_pull(user_id)
    doc = await client.pull(path)
    return doc.get("data", {}) if doc else {}


async def _update_spaces_doc(
    client: Any,
    user_id: str,
    mutator: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
    path_r = spaces_pull(user_id)
    path_w = spaces_push(user_id)
    for _ in range(_MAX_RETRIES):
        doc = await client.pull(path_r)
        data = doc.get("data", {}) if doc else {}
        base_hash = doc.get("hash") if doc else None
        updated = mutator(data)
        try:
            await client.push(path_w, updated, base_hash=base_hash)
            return
        except Exception as exc:
            if "conflict" in str(exc).lower():
                continue
            raise
    raise RuntimeError("Failed to update _spaces doc after retries")


async def update_spaces_doc(client: Any, user_id: str, mutator: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    await _update_spaces_doc(client, user_id, mutator)


async def write_spaces(client: Any, user_id: str, spaces: list[Space], base_hash: Optional[str]) -> None:
    path = spaces_push(user_id)
    await client.push(path, {"spaces": spaces}, base_hash=base_hash)


async def reorder_spaces(client: Any, user_id: str, order: list[str]) -> None:
    async def mutate(data: dict[str, Any]) -> dict[str, Any]:
        spaces = data.get("spaces", [])
        by_id = {s["id"]: s for s in spaces}
        reordered = [by_id[sid] for sid in order if sid in by_id]
        return {**data, "spaces": reordered}
    await _update_spaces_doc(client, user_id, mutate)


# ── Space access (``_access``) ────────────────────────────────────────────────


async def read_space_access(client: Any, space_id: str) -> dict[str, Any]:
    doc = await client.pull(space_access_pull(space_id))
    data = doc.get("data", {}) if doc else {}
    return {
        "owner": data.get("owner"),
        "members": data.get("members", []),
        "name": data.get("name"),
        "image": data.get("image"),
        "hash": doc.get("hash") if doc else None,
    }


async def write_space_access(
    client: Any,
    space_id: str,
    owner: str,
    members: list[str],
    base_hash: Optional[str],
    meta: Optional[dict[str, Any]] = None,
) -> None:
    data: dict[str, Any] = {"owner": owner, "members": members}
    if meta:
        data.update(meta)
    await client.push(space_access_push(space_id), data, base_hash=base_hash)


async def add_space_member(client: Any, space_id: str, owner_user_id: str, member_user_id: str) -> None:
    current = await read_space_access(client, space_id)
    members = list(current.get("members", []))
    if member_user_id not in members:
        members.append(member_user_id)
    await write_space_access(
        client, space_id, current["owner"], members, current["hash"],
        meta={"name": current.get("name"), "image": current.get("image")},
    )


async def remove_space_member(client: Any, space_id: str, member_user_id: str) -> None:
    current = await read_space_access(client, space_id)
    members = [m for m in current.get("members", []) if m != member_user_id]
    await write_space_access(
        client, space_id, current["owner"], members, current["hash"],
        meta={"name": current.get("name"), "image": current.get("image")},
    )


# ── Space creation ────────────────────────────────────────────────────────────


async def create_space(session: Session, name: str) -> Space:
    """Create a new space: write _access, seed empty object index, register in _spaces."""
    from octospaces_sdk.spaces.object_index import seed_space_object_index
    from octospaces_sdk.sync.paths import OBJECT_COLLECTIONS, owner_scope

    space_id = f"sp-{random_id()}"
    short = slugify(name)
    space = Space(id=space_id, name=name, short=short, members=1)

    # Write _access
    await write_space_access(
        session.spaces_registry_client,
        space_id,
        owner=session.user_id,
        members=[session.user_id],
        base_hash=None,
        meta={"name": name, "image": None},
    )

    # Seed empty object index
    await seed_space_object_index(session, space_id)

    # Add to _spaces registry
    async def add_space(data: dict[str, Any]) -> dict[str, Any]:
        spaces = data.get("spaces", [])
        caps = data.get("caps", {})
        return {**data, "spaces": [*spaces, space], "caps": caps}

    await _update_spaces_doc(session.account_client, session.user_id, add_space)
    return space


async def add_joined_space(client: Any, user_id: str, space: Space) -> None:
    async def mutate(data: dict[str, Any]) -> dict[str, Any]:
        spaces = data.get("spaces", [])
        if not any(s["id"] == space["id"] for s in spaces):
            spaces = [*spaces, space]
        return {**data, "spaces": spaces}
    await _update_spaces_doc(client, user_id, mutate)


async def add_joined_space_with_cap(client: Any, user_id: str, space: Space, cap_json: str) -> None:
    async def mutate(data: dict[str, Any]) -> dict[str, Any]:
        spaces = data.get("spaces", [])
        if not any(s["id"] == space["id"] for s in spaces):
            spaces = [*spaces, space]
        caps = dict(data.get("caps", {}))
        caps[space["id"]] = cap_json
        return {**data, "spaces": spaces, "caps": caps}
    await _update_spaces_doc(client, user_id, mutate)


async def add_joined_space_with_link_access(client: Any, user_id: str, space: Space, sealed: dict[str, Any]) -> None:
    async def mutate(data: dict[str, Any]) -> dict[str, Any]:
        spaces = data.get("spaces", [])
        if not any(s["id"] == space["id"] for s in spaces):
            spaces = [*spaces, space]
        pub_access = dict(data.get("pubAccess", {}))
        pub_access[space["id"]] = sealed
        return {**data, "spaces": spaces, "pubAccess": pub_access}
    await _update_spaces_doc(client, user_id, mutate)
