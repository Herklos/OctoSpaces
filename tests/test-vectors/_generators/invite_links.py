"""Generate invite-links.json — space/node invite link encode/decode vector.

Run from the octospaces repo root:
    python3 tests/test-vectors/_generators/invite_links.py

Writes to:
    tests/test-vectors/invite-links.json
"""

from __future__ import annotations

import base64
import json
import pathlib


def to_base64_url(obj: object) -> str:
    json_bytes = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(json_bytes).rstrip(b"=").decode("ascii")


def from_base64_url_json(s: str) -> object:
    padded = s + "=" * (-len(s) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def encode_space_invite_link(origin: str, token: dict) -> str:
    return f"{origin}/join#{to_base64_url(token)}"


def encode_node_invite_link(origin: str, token: dict) -> str:
    return f"{origin}/join/node#{to_base64_url(token)}"


ORIGIN = "https://app.octospaces.dev"
SPACE_ID = "space-test-abc123"
NODE_ID = "node-test-xyz789"

# A minimal cap structure for the token (simplified — no real crypto)
FAKE_CAP = {
    "iss": "a" * 64,
    "sub": "b" * 64,
    "iat": 1_700_000_000,
    "exp": 1_700_000_000 + 30 * 86400,
    "scope": {"collection": "chat", "spaceId": SPACE_ID, "write": True},
    "sig": "c" * 128,
}

SPACE_TOKEN = {
    "v": 1,
    "spaceId": SPACE_ID,
    "spaceName": "My Test Space",
    "cap": FAKE_CAP,
    "key": "d" * 64,
    "write": True,
}

NODE_TOKEN = {
    "v": 1,
    "spaceId": SPACE_ID,
    "nodeId": NODE_ID,
    "nodeName": "Meeting Notes",
    "cap": FAKE_CAP,
    "key": "e" * 64,
    "write": False,
}


def main() -> None:
    space_link = encode_space_invite_link(ORIGIN, SPACE_TOKEN)
    node_link = encode_node_invite_link(ORIGIN, NODE_TOKEN)

    # Extract fragments
    space_fragment = space_link.split("#", 1)[1]
    node_fragment = node_link.split("#", 1)[1]

    # Verify round-trips
    space_decoded = from_base64_url_json(space_fragment)
    node_decoded = from_base64_url_json(node_fragment)
    assert space_decoded == SPACE_TOKEN, f"Space token round-trip failed: {space_decoded}"
    assert node_decoded == NODE_TOKEN, f"Node token round-trip failed: {node_decoded}"

    vectors = {
        "description": (
            "Cross-language vector for invite link encode/decode. "
            "encode_space_invite_link: '{origin}/join#{base64url(token)}'. "
            "encode_node_invite_link: '{origin}/join/node#{base64url(token)}'. "
            "Decode by parsing fragment as base64url JSON. "
            "Assertion: decode(fragment) == original token."
        ),
        "origin": ORIGIN,
        "spaceToken": {
            "token": SPACE_TOKEN,
            "encoded_fragment": space_fragment,
            "full_link": space_link,
            "decoded": space_decoded,
        },
        "nodeToken": {
            "token": NODE_TOKEN,
            "encoded_fragment": node_fragment,
            "full_link": node_link,
            "decoded": node_decoded,
        },
    }

    out_path = pathlib.Path(__file__).resolve().parents[1] / "invite-links.json"
    out_path.write_text(json.dumps(vectors, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
