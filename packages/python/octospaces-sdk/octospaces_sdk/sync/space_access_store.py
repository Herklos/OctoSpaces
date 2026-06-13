"""Unified local member/link access store.

Mirrors ``packages/ts/octospaces-sdk/src/sync/space-access-store.ts``.

Stores cap credentials for joined spaces (member cap or link-based sealed
credential) in the injectable KV adapter so they survive process restarts.
"""

from __future__ import annotations

import json
from typing import Any, Literal, Optional, TypedDict

from octospaces_sdk.core.adapters import kv_get, kv_remove, kv_set

_KV_PREFIX = "octospaces.access."


class MemberAccessEntry(TypedDict):
    kind: Literal["member"]
    cap: str  # JSON-encoded cap-cert


class LinkAccessEntry(TypedDict):
    kind: Literal["link"]
    cap: Any  # cap-cert dict
    key: str   # ephemeral edPriv hex
    write: bool


SpaceAccessEntry = MemberAccessEntry | LinkAccessEntry
SpaceAccessMap = dict[str, SpaceAccessEntry]

# In-memory cache (warm on hydrate)
_store: SpaceAccessMap = {}


def _entry_key(space_id: str, node_id: Optional[str] = None) -> str:
    if node_id:
        return f"{space_id}:{node_id}"
    return space_id


async def hydrate_space_access_store(
    user_id: str,
    server_caps: dict[str, str],
    server_link_access: dict[str, Any],
) -> None:
    """Populate the in-memory store from server-provided caps + link access."""
    for space_id, cap_json in server_caps.items():
        _store[space_id] = MemberAccessEntry(kind="member", cap=cap_json)
    for key, val in server_link_access.items():
        _store[key] = val
    # Also persist to KV
    await kv_set(f"{_KV_PREFIX}{user_id}", json.dumps(_store))


def get_space_access_entry(space_id: str) -> SpaceAccessEntry | None:
    return _store.get(_entry_key(space_id))


def save_space_access_entry(space_id: str, entry: SpaceAccessEntry) -> None:
    _store[_entry_key(space_id)] = entry


def remove_space_access_entry(space_id: str) -> None:
    _store.pop(_entry_key(space_id), None)


def get_node_access_entry(space_id: str, node_id: str) -> SpaceAccessEntry | None:
    return _store.get(_entry_key(space_id, node_id))


def save_node_access_entry(space_id: str, node_id: str, entry: SpaceAccessEntry) -> None:
    _store[_entry_key(space_id, node_id)] = entry


def remove_node_access_entry(space_id: str, node_id: str) -> None:
    _store.pop(_entry_key(space_id, node_id), None)


def local_space_access_entries() -> SpaceAccessMap:
    return dict(_store)


def member_caps_from_store() -> dict[str, str]:
    return {k: v["cap"] for k, v in _store.items() if v.get("kind") == "member"}  # type: ignore[typeddict-item]


def link_access_from_store() -> dict[str, Any]:
    return {k: v for k, v in _store.items() if v.get("kind") == "link"}


def clear_space_access_store() -> None:
    _store.clear()
