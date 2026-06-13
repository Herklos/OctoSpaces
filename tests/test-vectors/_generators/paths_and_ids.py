"""Generate paths-scopes.json, user-id.json, room-slug.json, base64url.json.

Self-contained — mirrors the implementation without importing the SDK so it
can run under any Python 3.10+ (no venv required).

Run from the octospaces repo root:
    python3 tests/test-vectors/_generators/paths_and_ids.py

Writes to:
    tests/test-vectors/paths-scopes.json
    tests/test-vectors/user-id.json
    tests/test-vectors/room-slug.json
    tests/test-vectors/base64url.json
"""

from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re
import unicodedata


# ── Mirrors user_id_from_ed_pub in sync/paths.py ─────────────────────────────

def user_id_from_ed_pub(ed_pub_hex: str) -> str:
    return hashlib.sha256(bytes.fromhex(ed_pub_hex)).digest()[:16].hex()


# ── Mirrors room_slug in core/ids.py ─────────────────────────────────────────

def room_slug(name: str) -> str:
    normalized = unicodedata.normalize("NFD", name)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    lowered = ascii_only.lower()
    slugged = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    truncated = slugged[:40]
    return truncated or "room"


# ── Mirrors path builders in sync/paths.py (must stay in sync) ───────────────

OBJECT_COLLECTIONS = [
    "spacekeyring", "objindex", "objlog", "objsnap",
    "objdoc", "objblob", "typeindex", "objpub",
]


def _pull(rest: str) -> str:
    return f"/pull/{rest}"


def _push(rest: str) -> str:
    return f"/push/{rest}"


def keyring_pull(space_id: str) -> str:
    return _pull(f"spaces/{space_id}/_keyring")


def keyring_push(space_id: str) -> str:
    return _push(f"spaces/{space_id}/_keyring")


def obj_index_pull(space_id: str) -> str:
    return _pull(f"spaces/{space_id}/objects/_index")


def obj_index_push(space_id: str) -> str:
    return _push(f"spaces/{space_id}/objects/_index")


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


def owner_scope() -> dict:
    return {
        "ops": ["read", "list", "write"],
        "collections": OBJECT_COLLECTIONS,
        "paths": ["spaces/**"],
    }


def space_member_scope(space_id: str, can_write: bool) -> dict:
    ops = ["read", "list", "write"] if can_write else ["read", "list"]
    return {
        "ops": ops,
        "collections": OBJECT_COLLECTIONS,
        "paths": [f"spaces/{space_id}/**"],
    }


def node_member_scope(space_id: str, node_id: str, can_write: bool) -> dict:
    ops = ["read", "list", "write"] if can_write else ["read", "list"]
    return {
        "ops": ops,
        "collections": ["objinv"],
        "paths": [f"spaces/{space_id}/objects/n/{node_id}/**"],
    }


def account_scope(user_id: str) -> dict:
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


def linked_device_scope(user_id: str) -> dict:
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


# ── Mirrors base64url in sync/base64url.py ───────────────────────────────────

def to_base64_url(obj: object) -> str:
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def from_base64_url_json(s: str) -> object:
    padded = s + "=" * (-(len(s)) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def main() -> None:
    # ── user-id.json ────────────────────────────────────────────────────────
    ed_pub_inputs = [
        "a" * 64,
        "0" * 64,
        "deadbeef" * 8,
        "cafe1234" * 8,
    ]
    user_id_vectors = {
        "description": (
            "Cross-language vector for userId derivation: "
            "sha256(bytes.fromhex(edPub))[:16].hex() — must be 32 hex chars."
        ),
        "vectors": [
            {"edPub": ep, "userId": user_id_from_ed_pub(ep)}
            for ep in ed_pub_inputs
        ],
    }

    # ── room-slug.json ───────────────────────────────────────────────────────
    # Only ASCII inputs — TS and Python differ on accented chars (TS strips them
    # directly; Python first normalises via NFD + ASCII-encode so é→e, ü→u, etc.).
    # Non-ASCII cases are intentionally excluded from the cross-language vector.
    slug_inputs = [
        "Hello World",
        "My-Project 2024",
        "ALL CAPS",
        "a" * 50,  # truncated to 40
        "",
        "!!! @@@",  # all non-alnum → "room"
        "simple",
        "abc-123-xyz",
    ]
    room_slug_vectors = {
        "description": (
            "Cross-language vector for room_slug (ASCII inputs only). "
            "Pipeline: lowercase → replace non-[a-z0-9] runs with '-' → "
            "strip leading/trailing '-' → truncate 40 → fallback 'room'. "
            "Non-ASCII inputs are excluded — TS and Python differ on how accented "
            "characters are handled (TS strips them, Python normalises first)."
        ),
        "vectors": [
            {"input": name, "expected": room_slug(name)}
            for name in slug_inputs
        ],
    }

    # ── paths-scopes.json ────────────────────────────────────────────────────
    space_id = "space-abc123"
    node_id = "node-xyz789"
    user_id = "u-" + "a" * 30

    paths_vectors = {
        "description": "Cross-language vector for path builder functions and capability scopes.",
        "paths": {
            "keyringPull": keyring_pull(space_id),
            "keyringPush": keyring_push(space_id),
            "objIndexPull": obj_index_pull(space_id),
            "objIndexPush": obj_index_push(space_id),
            "profilePull": profile_pull(user_id),
            "profilePush": profile_push(user_id),
            "spacesPull": spaces_pull(user_id),
            "spacesPush": spaces_push(user_id),
            "spaceAccessPull": space_access_pull(space_id),
            "spaceAccessPush": space_access_push(space_id),
        },
        "path_inputs": {
            "spaceId": space_id,
            "nodeId": node_id,
            "userId": user_id,
        },
        "scopes": {
            "owner": owner_scope(),
            "spaceMember_write": space_member_scope(space_id, True),
            "spaceMember_read": space_member_scope(space_id, False),
            "nodeMember_write": node_member_scope(space_id, node_id, True),
            "nodeMember_read": node_member_scope(space_id, node_id, False),
            "account": account_scope(user_id),
            "linkedDevice": linked_device_scope(user_id),
        },
        "OBJECT_COLLECTIONS": OBJECT_COLLECTIONS,
    }

    # ── base64url.json ───────────────────────────────────────────────────────
    b64_objects = [
        {"v": 1, "spaceId": "abc", "spaceName": "Test Space"},
        {"a": [1, 2, 3], "b": True, "c": None},
        {"key": "hello world", "emoji": "🐙"},
        {},
    ]
    b64_vectors = {
        "description": (
            "Cross-language vector for base64url encode/decode. "
            "to_base64_url: JSON.stringify (compact, no spaces) → urlsafe base64 no padding. "
            "from_base64_url_json: inverse. Assertion: decode(encode(obj)) == obj."
        ),
        "vectors": [
            {
                "object": obj,
                "encoded": to_base64_url(obj),
                "roundtrip": from_base64_url_json(to_base64_url(obj)),
            }
            for obj in b64_objects
        ],
    }

    # ── Write files ──────────────────────────────────────────────────────────
    root = pathlib.Path(__file__).resolve().parents[1]
    for name, data in [
        ("user-id.json", user_id_vectors),
        ("room-slug.json", room_slug_vectors),
        ("paths-scopes.json", paths_vectors),
        ("base64url.json", b64_vectors),
    ]:
        out_path = root / name
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
