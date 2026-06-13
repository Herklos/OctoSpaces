"""Per-node creation, access control, and invite flows.

Mirrors ``packages/ts/octospaces-sdk/src/spaces/nodes.ts``.
"""

from __future__ import annotations

import json
from typing import Any, Optional, TypedDict

from octospaces_sdk.core.types import ID, NodeAccess, ObjectNode, ObjectType
from octospaces_sdk.objects.objects import add_object
from octospaces_sdk.spaces.object_index import update_object_index
from octospaces_sdk.sync.base64url import from_base64_url_json, to_base64_url
from octospaces_sdk.sync.identity import Session
from octospaces_sdk.sync.paths import node_member_scope, space_member_scope


class CreateNodeInput(TypedDict, total=False):
    type: ObjectType          # required
    title: str                # required
    emoji: str
    parentId: Optional[ID]
    access: NodeAccess
    enc: bool
    meta: dict[str, Any]


class NodeInviteBundle(TypedDict):
    spaceId: str
    nodeId: str
    nodeName: str
    cap: Any
    nodeCap: Optional[Any]


class NodeInviteLinkToken(TypedDict):
    v: int        # always 1
    spaceId: str
    nodeId: str
    nodeName: str
    cap: Any      # cap-cert dict
    key: str      # ephemeral edPriv hex
    write: bool


# ── Node creation ─────────────────────────────────────────────────────────────


async def create_node(
    session: Session,
    space_id: str,
    input: CreateNodeInput,
    _reg: Any = None,
) -> ObjectNode:
    """Create a node and update the space's object index."""
    access = input.get("access")
    enc = input.get("enc", False)
    if access == "public" and enc:
        raise ValueError("A node cannot be both public and encrypted.")

    import time

    now = int(time.time() * 1000)

    result: dict[str, Any] | None = None

    async def mutate(nodes: list[ObjectNode]) -> list[ObjectNode]:
        nonlocal result
        r = add_object(nodes, input, now)
        result = r
        return r["nodes"]

    await update_object_index(session, space_id, mutate, _reg)

    if result is None:
        raise RuntimeError("Node creation failed")

    node: ObjectNode = result["node"]

    # Ensure a space keyring exists for encrypted nodes
    if enc:
        from octospaces_sdk.sync.client import owner_ensure_keyring
        from octospaces_sdk.sync.identity import owner_trusted_adders
        from octospaces_sdk.sync.paths import keyring_pull, keyring_push

        await owner_ensure_keyring(
            session.spaces_keyring_client,
            session.keys,
            keyring_pull(space_id),
            keyring_push(space_id),
            owner_trusted_adders(session),
        )

    return node


async def set_node_access(
    session: Session,
    space_id: str,
    node_id: str,
    patch: dict[str, Any],
    _reg: Any = None,
) -> None:
    """Update a node's access/enc fields in the object index."""
    import time

    now = int(time.time() * 1000)

    async def mutate(nodes: list[ObjectNode]) -> list[ObjectNode]:
        from octospaces_sdk.objects.objects import patch_object

        return patch_object(nodes, node_id, patch, now)

    await update_object_index(session, space_id, mutate, _reg)


# ── Link encode / decode ──────────────────────────────────────────────────────


def encode_node_invite_link(origin: str, token: NodeInviteLinkToken) -> str:
    return f"{origin}/join/node#{to_base64_url(token)}"


def decode_node_invite_link(fragment: str) -> NodeInviteLinkToken:
    return from_base64_url_json(fragment)  # type: ignore[return-value]


# ── Invite to node (direct bundle) ────────────────────────────────────────────


async def invite_to_node(
    session: Session,
    space_id: str,
    node_id: str,
    request_json: str,
    node: dict[str, Any],
    node_name: Optional[str] = None,
) -> str:
    """Owner: mint a cap for the requester and return an invite bundle JSON."""
    from starfish_sharing.cap_mint import mint_member_cap  # type: ignore[import-untyped]

    import time

    from octospaces_sdk.sync.paths import node_member_scope, space_member_scope

    req = json.loads(request_json)
    enc = bool(node.get("enc"))

    # Use space-member scope for enc nodes (needs keyring), node-member for plaintext invite
    scope = space_member_scope(space_id, True) if enc else node_member_scope(space_id, node_id, True)

    now = int(time.time())
    cap = mint_member_cap(
        iss_ed_priv_hex=session.keys["edPriv"],
        iss_ed_pub_hex=session.keys["edPub"],
        iss_user_id=session.user_id,
        sub_ed_pub_hex=req["edPub"],
        sub_kem_pub_hex=req["kemPub"],
        sub_user_id=req["userId"],
        scope=scope,
        nbf=now,
        exp=now + 30 * 86400,
    )

    bundle = NodeInviteBundle(
        spaceId=space_id,
        nodeId=node_id,
        nodeName=node_name or node_id,
        cap=cap,
        nodeCap=None,
    )
    return json.dumps(bundle, separators=(",", ":"))


async def accept_node_invite(session: Session, bundle_json: str) -> str:
    """Invitee: accept a node invite bundle; returns the node id."""
    from octospaces_sdk.sync.client import make_client
    from octospaces_sdk.sync.space_access_store import MemberAccessEntry, save_node_access_entry

    bundle = json.loads(bundle_json)
    space_id = bundle["spaceId"]
    node_id = bundle["nodeId"]
    cap = bundle["cap"]

    if cap.get("sub") != session.keys["edPub"]:
        raise ValueError("Node invite cap is not addressed to this device")

    cap_json = json.dumps(cap, separators=(",", ":"))
    save_node_access_entry(space_id, node_id, MemberAccessEntry(kind="member", cap=cap_json))
    return node_id


# ── Node invite link ──────────────────────────────────────────────────────────


async def create_node_invite_link(
    session: Session,
    space_id: str,
    node_id: str,
    node_name: str,
    node: dict[str, Any],
    write: bool,
    origin: str,
) -> dict[str, Any]:
    from starfish_identities.pairing import generate_device_keys  # type: ignore[import-untyped]
    from starfish_sharing.cap_mint import mint_member_cap  # type: ignore[import-untyped]

    import time

    from octospaces_sdk.sync.paths import node_member_scope, space_member_scope, user_id_from_ed_pub

    enc = bool(node.get("enc"))
    ephemeral = generate_device_keys()
    eph_ed_priv = ephemeral["ed_priv_hex"]
    eph_ed_pub = ephemeral["ed_pub_hex"]
    eph_kem_pub = ephemeral["kem_pub_hex"]
    eph_user_id = user_id_from_ed_pub(eph_ed_pub)

    scope = space_member_scope(space_id, write) if enc else node_member_scope(space_id, node_id, write)
    now = int(time.time())
    cap = mint_member_cap(
        iss_ed_priv_hex=session.keys["edPriv"],
        iss_ed_pub_hex=session.keys["edPub"],
        iss_user_id=session.user_id,
        sub_ed_pub_hex=eph_ed_pub,
        sub_kem_pub_hex=eph_kem_pub,
        sub_user_id=eph_user_id,
        scope=scope,
        nbf=now,
        exp=now + 30 * 86400,
    )

    token = NodeInviteLinkToken(
        v=1,
        spaceId=space_id,
        nodeId=node_id,
        nodeName=node_name,
        cap=cap,
        key=eph_ed_priv,
        write=write,
    )
    link = encode_node_invite_link(origin, token)
    return {"token": token, "link": link}


async def join_node_by_link(session: Session, token: NodeInviteLinkToken) -> str:
    """Invitee: redeem a node invite link; returns the node id."""
    from octospaces_sdk.sync.client import make_client
    from octospaces_sdk.sync.space_access_store import LinkAccessEntry, save_node_access_entry

    space_id = token["spaceId"]
    node_id = token["nodeId"]
    cap = token["cap"]
    key = token["key"]

    save_node_access_entry(
        space_id,
        node_id,
        LinkAccessEntry(kind="link", cap=cap, key=key, write=token["write"]),
    )
    return node_id
