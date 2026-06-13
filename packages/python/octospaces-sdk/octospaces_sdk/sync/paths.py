"""Collection path + cap-scope helpers for OctoSpaces.

Mirrors ``packages/ts/octospaces-sdk/src/sync/paths.ts`` exactly — same
function names (snake_case), same string outputs.

Paths are signed relative to SYNC_BASE; the server mounts the sync router
at root, so they start with /pull or /push.  Everything for a space is
nested under ``spaces/{spaceId}/…`` so a single ``spaces/{spaceId}/**``
member cap covers a whole space.

``objinv`` (invite-plaintext content) is intentionally excluded from
``OBJECT_COLLECTIONS`` / ``space_member_scope`` — only a per-node cap
(``node_member_scope``) can reach it.
"""

from __future__ import annotations

import hashlib
from typing import Any, TypedDict


class ScopePreset(TypedDict):
    ops: list[str]
    collections: list[str]
    paths: list[str]


def _pull(rest: str) -> str:
    return f"/pull/{rest}"


def _push(rest: str) -> str:
    return f"/push/{rest}"


# ── Space ID helpers ──────────────────────────────────────────────────────────


def space_id_from_room_id(room_id: str) -> str:
    """A room id is ``sp-<rand>-<name>``; the space is its first two ``-`` segments."""
    return "-".join(room_id.split("-")[:2])


# ── Space-wide keyring ────────────────────────────────────────────────────────


def keyring_name(space_id: str) -> str:
    return f"spaces/{space_id}"


def keyring_pull(space_id: str) -> str:
    return _pull(f"{keyring_name(space_id)}/_keyring")


def keyring_push(space_id: str) -> str:
    return _push(f"{keyring_name(space_id)}/_keyring")


# ── Attachments ───────────────────────────────────────────────────────────────


def attachment_name(room_id: str, blob_id: str) -> str:
    return f"spaces/{space_id_from_room_id(room_id)}/attachments/{room_id}/{blob_id}"


def attachment_pull(room_id: str, blob_id: str) -> str:
    return _pull(attachment_name(room_id, blob_id))


def attachment_push(room_id: str, blob_id: str) -> str:
    return _push(attachment_name(room_id, blob_id))


# ── Profile + registries ──────────────────────────────────────────────────────


def profile_pull(user_id: str) -> str:
    return _pull(f"user/{user_id}/profile")


def profile_push(user_id: str) -> str:
    return _push(f"user/{user_id}/profile")


def spaces_pull(user_id: str) -> str:
    return _pull(f"user/{user_id}/_spaces")


def spaces_push(user_id: str) -> str:
    return _push(f"user/{user_id}/_spaces")


def space_access_pull(space_id: str) -> str:
    return _pull(f"spaces/{space_id}/_access")


def space_access_push(space_id: str) -> str:
    return _push(f"spaces/{space_id}/_access")


# ── Object index ──────────────────────────────────────────────────────────────


def obj_index_name(space_id: str) -> str:
    return f"spaces/{space_id}/objects/_index"


def obj_index_pull(space_id: str) -> str:
    return _pull(obj_index_name(space_id))


def obj_index_push(space_id: str) -> str:
    return _push(obj_index_name(space_id))


# ── Object content (space:member gated) ──────────────────────────────────────


def obj_log_name(space_id: str, object_id: str) -> str:
    return f"spaces/{space_id}/objects/logs/{object_id}"


def obj_log_pull(space_id: str, object_id: str) -> str:
    return _pull(obj_log_name(space_id, object_id))


def obj_log_push(space_id: str, object_id: str) -> str:
    return _push(obj_log_name(space_id, object_id))


def obj_doc_name(space_id: str, object_id: str) -> str:
    return f"spaces/{space_id}/objects/docs/{object_id}"


def obj_doc_pull(space_id: str, object_id: str) -> str:
    return _pull(obj_doc_name(space_id, object_id))


def obj_doc_push(space_id: str, object_id: str) -> str:
    return _push(obj_doc_name(space_id, object_id))


def object_blob_name(space_id: str, blob_id: str) -> str:
    return f"spaces/{space_id}/objects/blobs/{blob_id}"


def object_blob_pull(space_id: str, blob_id: str) -> str:
    return _pull(object_blob_name(space_id, blob_id))


def object_blob_push(space_id: str, blob_id: str) -> str:
    return _push(object_blob_name(space_id, blob_id))


# ── Public node content (world-readable) ─────────────────────────────────────


def obj_pub_name(space_id: str, node_id: str) -> str:
    return f"spaces/{space_id}/objects/pub/{node_id}"


def obj_pub_pull(space_id: str, node_id: str) -> str:
    return _pull(obj_pub_name(space_id, node_id))


def obj_pub_push(space_id: str, node_id: str) -> str:
    return _push(obj_pub_name(space_id, node_id))


# ── Invite-only plaintext content (cap-gated) ─────────────────────────────────


def obj_inv_name(space_id: str, node_id: str) -> str:
    return f"spaces/{space_id}/objects/n/{node_id}/content"


def obj_inv_pull(space_id: str, node_id: str) -> str:
    return _pull(obj_inv_name(space_id, node_id))


def obj_inv_push(space_id: str, node_id: str) -> str:
    return _push(obj_inv_name(space_id, node_id))


# ── Per-space custom type registry ────────────────────────────────────────────


def types_index_name(space_id: str) -> str:
    return f"spaces/{space_id}/types/_index"


def types_index_pull(space_id: str) -> str:
    return _pull(types_index_name(space_id))


def types_index_push(space_id: str) -> str:
    return _push(types_index_name(space_id))


# ── Global object directory (server projection) ───────────────────────────────


def object_dir_name(shard: str = "public") -> str:
    return f"_index/objects/{shard}"


def object_dir_pull(shard: str = "public") -> str:
    return _pull(object_dir_name(shard))


# ── Generic object collections (cap scopes) ──────────────────────────────────
# ``objinv`` is intentionally excluded — only per-node caps can reach it.
OBJECT_COLLECTIONS: list[str] = [
    "spacekeyring",
    "objindex",
    "objlog",
    "objsnap",
    "objdoc",
    "objblob",
    "typeindex",
    "objpub",
]


# ── Cap scopes ────────────────────────────────────────────────────────────────


def owner_scope() -> ScopePreset:
    """Full owner/device access to every space the identity owns."""
    return {
        "ops": ["read", "list", "write"],
        "collections": OBJECT_COLLECTIONS,
        "paths": ["spaces/**"],
    }


def space_member_scope(space_id: str, can_write: bool) -> ScopePreset:
    """Member access to one SPACE — keyring + all node content docs."""
    ops = ["read", "list", "write"] if can_write else ["read", "list"]
    return {
        "ops": ops,
        "collections": OBJECT_COLLECTIONS,
        "paths": [f"spaces/{space_id}/**"],
    }


def node_member_scope(space_id: str, node_id: str, can_write: bool) -> ScopePreset:
    """Narrow per-node cap for ``invite+plaintext`` nodes (``objinv`` only)."""
    ops = ["read", "list", "write"] if can_write else ["read", "list"]
    return {
        "ops": ops,
        "collections": ["objinv"],
        "paths": [f"spaces/{space_id}/objects/n/{node_id}/**"],
    }


def account_scope(user_id: str) -> ScopePreset:
    """Personal cap: profile + space registry + device directory + all spaces."""
    return {
        "ops": ["read", "list", "write"],
        "collections": ["profile", "devices", "spaces", "spaceregistry"],
        "paths": [
            f"user/{user_id}/profile",
            f"users/{user_id}/_devices",
            f"user/{user_id}/_spaces",
            "spaces/**",
        ],
    }


def linked_device_scope(user_id: str) -> ScopePreset:
    """Single cap-cert scope granted to a PAIRED (linked) device."""
    return {
        "ops": ["read", "list", "write"],
        "collections": [*OBJECT_COLLECTIONS, "profile", "devices", "spaces", "spaceregistry"],
        "paths": [
            "spaces/**",
            f"user/{user_id}/profile",
            f"users/{user_id}/_devices",
            f"user/{user_id}/_spaces",
        ],
    }


def space_id_from_cap(cap: dict[str, Any]) -> str | None:
    """Extract the single space id a member cap is scoped to.

    Returns ``None`` if the cap names no space path OR more than one distinct space.
    """
    import re

    found: str | None = None
    paths: list[str] = cap.get("scope", {}).get("paths", [])
    for p in paths:
        m = re.match(r"^spaces/([^/]+)/", p)
        if not m:
            continue
        sid = m.group(1)
        if found is not None and found != sid:
            return None
        found = sid
    return found


def bytes_to_hex(b: bytes) -> str:
    """Convert bytes to lowercase hex."""
    return b.hex()


def user_id_from_ed_pub(ed_pub_hex: str) -> str:
    """Canonical identity derivation: ``userId = sha256(edPub)[0:16]`` as 32 hex chars."""
    pub_bytes = bytes.fromhex(ed_pub_hex)
    digest = hashlib.sha256(pub_bytes).digest()
    return digest[:16].hex()
