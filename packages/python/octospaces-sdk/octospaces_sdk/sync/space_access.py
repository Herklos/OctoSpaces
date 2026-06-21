"""Per-node (client, encryptor) resolver + cache.

Mirrors ``packages/ts/octospaces-sdk/src/sync/space-access.ts``.

The six-case resolution order (from the TS doc comment):
1. Public + no enc  → member client, no encryptor.
2. Invite + no enc  → node-member cap client, no encryptor.
3. Space + no enc   → space-member cap client, no encryptor.
4. Space/invite + enc → space-member cap client + keyring encryptor.
5. No credential    → SpaceAccessError.
6. Link-access cred → sealed cap client + keyring encryptor.
"""

from __future__ import annotations

from typing import Any, Optional, TypedDict

from octospaces_sdk.core.space_access_error import SpaceAccessError
from octospaces_sdk.core.types import DeviceKeys, NodeAccess, ObjectNode
from octospaces_sdk.sync.client import build_encryptor, make_client, open_encryptor
from octospaces_sdk.sync.identity import Session, owner_trusted_adders
from octospaces_sdk.sync.paths import keyring_pull, space_member_scope
from octospaces_sdk.sync.space_access_store import (
    get_node_access_entry,
    get_space_access_entry,
)

# In-memory cache: (space_id, node_id|None) → NodeAccessHandle
_cache: dict[tuple[str, str | None], "NodeAccessHandle"] = {}


class NodeAccessHandle(TypedDict):
    encryptor: Optional[Any]
    client: Any
    is_owner_open: bool


def clear_node_access_cache() -> None:
    """Clear the resolution cache (call on account switch)."""
    _cache.clear()


def get_space_client(space_id: str, session: Session) -> Any:
    """Return a member-gated Starfish client for *space_id* (plaintext docs)."""
    entry = get_space_access_entry(space_id)
    if entry is None:
        raise SpaceAccessError(f"No access credential for space {space_id!r}")
    if entry["kind"] == "member":
        cap = entry["cap"] if isinstance(entry["cap"], dict) else __import__("json").loads(entry["cap"])
        return make_client(cap, session.keys["edPriv"])
    # link-based
    return make_client(entry["cap"], entry["key"])


async def get_node_access(
    space_id: str,
    node_id: str,
    node: dict[str, Any],
    session: Session,
    _reg: Any = None,
) -> NodeAccessHandle:
    """Resolve the ``(client, encryptor)`` pair for a node.  Results are cached."""
    cache_key = (space_id, node_id)
    if cache_key in _cache:
        return _cache[cache_key]

    access: NodeAccess = node.get("access", "space") or "space"
    enc: bool = bool(node.get("enc"))
    trusted = owner_trusted_adders(session)
    is_owner = session.keys["edPub"] == session.owner_ed_pub

    encryptor: Optional[Any] = None
    client: Any

    if access == "public" and not enc:
        client = session.content_client
    elif enc:
        # Encrypted: need space-member cap + keyring encryptor
        client = get_space_client(space_id, session)
        encryptor = await open_encryptor(
            client,
            session.keys,
            keyring_pull(space_id),
            trusted,
        )
    elif access == "invite":
        node_entry = get_node_access_entry(space_id, node_id)
        if node_entry is None:
            raise SpaceAccessError(f"No access credential for node {node_id!r} in space {space_id!r}")
        if node_entry["kind"] == "member":
            cap = node_entry["cap"] if isinstance(node_entry["cap"], dict) else __import__("json").loads(node_entry["cap"])
            client = make_client(cap, session.keys["edPriv"])
        else:
            client = make_client(node_entry["cap"], node_entry["key"])
    else:
        # space-gated plaintext
        client = get_space_client(space_id, session)

    handle = NodeAccessHandle(encryptor=encryptor, client=client, is_owner_open=is_owner)
    _cache[cache_key] = handle
    return handle


async def build_node_access(
    session: Session,
    space_id: str,
    node_id: str,
    node: dict[str, Any],
) -> Optional[dict[str, Any]]:
    """Soft variant — returns ``None`` instead of raising."""
    try:
        handle = await get_node_access(space_id, node_id, node, session)
        return {"client": handle["client"], "encryptor": handle["encryptor"]}
    except SpaceAccessError:
        return None
