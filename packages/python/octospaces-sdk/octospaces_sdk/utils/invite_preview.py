"""Invite preview — classify an invite string without joining.

Mirrors ``packages/ts/octospaces-sdk/src/utils/invite-preview.ts``.

Three recognised kinds:
- ``space-link``   — base64url-encoded JSON token in the URL fragment (``/join#<b64>``)
- ``node-link``    — same but ``/join/node#<b64>``
- ``member-bundle`` — plain JSON with ``spaceId``, ``cap``, and ``inviteJson``
"""

from __future__ import annotations

import json
from typing import Any, Literal, Optional, TypedDict


class SpaceLinkPreview(TypedDict):
    kind: Literal["space-link"]
    space_name: str
    write: bool
    token: dict[str, Any]


class NodeLinkPreview(TypedDict):
    kind: Literal["node-link"]
    space_name: str
    node_title: Optional[str]
    token: dict[str, Any]


class MemberBundlePreview(TypedDict):
    kind: Literal["member-bundle"]
    space_name: str
    space_id: str
    issuer_key: Optional[str]
    invite_json: str


InvitePreview = SpaceLinkPreview | NodeLinkPreview | MemberBundlePreview


def _decode_b64url_json(fragment: str) -> dict[str, Any]:
    import base64

    b64 = fragment
    # Restore padding
    padded = b64 + "=" * ((4 - len(b64) % 4) % 4)
    raw = base64.urlsafe_b64decode(padded).decode()
    return json.loads(raw)


def preview_invite(raw: str) -> InvitePreview:
    """Classify *raw* as a space-link, node-link, or member-bundle.

    Raises :exc:`ValueError` if *raw* is not recognisable.
    """
    raw = raw.strip()

    # Check for URL fragment link patterns
    node_marker = "/join/node#"
    space_marker = "/join#"

    if node_marker in raw:
        fragment = raw.split(node_marker, 1)[1]
        token = _decode_b64url_json(fragment)
        return NodeLinkPreview(
            kind="node-link",
            space_name=token.get("spaceName", ""),
            node_title=token.get("nodeName"),
            token=token,
        )

    if space_marker in raw:
        fragment = raw.split(space_marker, 1)[1]
        token = _decode_b64url_json(fragment)
        return SpaceLinkPreview(
            kind="space-link",
            space_name=token.get("spaceName", ""),
            write=bool(token.get("write", False)),
            token=token,
        )

    # Try as JSON member-bundle
    try:
        bundle = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Unrecognised invite format: {raw!r}") from exc

    space_id: str = bundle.get("spaceId", "")
    space_name: str = bundle.get("spaceName", "")
    invite_json: str = raw
    # Issuer key: the cap's ``iss`` field if present
    cap = bundle.get("cap") or {}
    issuer_key: Optional[str] = cap.get("iss") if isinstance(cap, dict) else None

    return MemberBundlePreview(
        kind="member-bundle",
        space_name=space_name,
        space_id=space_id,
        issuer_key=issuer_key,
        invite_json=invite_json,
    )
