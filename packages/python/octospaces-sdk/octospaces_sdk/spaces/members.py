"""Space membership — invites, links, join flows.

Mirrors ``packages/ts/octospaces-sdk/src/spaces/members.ts``.
"""

from __future__ import annotations

import json
from typing import Any, Optional, TypedDict

from octospaces_sdk.core.types import ID, Space
from octospaces_sdk.sync.base64url import from_base64_url_json, to_base64_url
from octospaces_sdk.sync.identity import Session
from octospaces_sdk.sync.paths import keyring_pull, keyring_push, space_member_scope


class JoinRequest(TypedDict):
    edPub: str
    kemPub: str
    userId: str


class SpaceInviteLinkToken(TypedDict):
    v: int          # always 1
    spaceId: str
    spaceName: str
    cap: Any        # cap-cert dict
    key: str        # ephemeral edPriv hex
    write: bool


# ── Make a join request ───────────────────────────────────────────────────────


def make_join_request(session: Session) -> str:
    """Produce a JSON join-request string with this session's public keys."""
    req = JoinRequest(
        edPub=session.keys["edPub"],
        kemPub=session.keys["kemPub"],
        userId=session.user_id,
    )
    return json.dumps(req, separators=(",", ":"))


# ── Link encode / decode ──────────────────────────────────────────────────────


def encode_space_invite_link(origin: str, token: SpaceInviteLinkToken) -> str:
    """Encode a space invite token as a URL fragment link."""
    return f"{origin}/join#{to_base64_url(token)}"


def decode_space_invite_link(fragment: str) -> SpaceInviteLinkToken:
    """Decode a space invite link fragment back to its token."""
    return from_base64_url_json(fragment)  # type: ignore[return-value]


# ── Invite to space (direct member-bundle) ────────────────────────────────────


async def invite_to_space(
    session: Session,
    space_id: str,
    request_json: str,
    can_write: bool = True,
    space_name: Optional[str] = None,
) -> str:
    """Owner: mint a member cap for the requester and return an invite bundle JSON."""
    from starfish_keyring import add_recipient  # type: ignore[import-untyped]
    from starfish_sharing.cap_mint import mint_member_cap  # type: ignore[import-untyped]

    import time

    from octospaces_sdk.sync.client import make_client

    req: JoinRequest = json.loads(request_json)

    scope = space_member_scope(space_id, can_write)
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

    # Add to keyring
    from octospaces_sdk.sync.client import owner_ensure_keyring
    from octospaces_sdk.sync.identity import owner_trusted_adders

    client = make_client(cap, session.keys["edPriv"])
    await _add_member_to_keyring(
        session=session,
        space_id=space_id,
        member_kem_pub=req["kemPub"],
        member_ed_pub=req["edPub"],
    )

    bundle = {
        "spaceId": space_id,
        "spaceName": space_name or "",
        "cap": cap,
        "inviteJson": request_json,
    }
    return json.dumps(bundle, separators=(",", ":"))


async def accept_space_invite(session: Session, invite_json: str) -> Space:
    """Invitee: accept a space invite bundle."""
    from octospaces_sdk.spaces.registry import (
        add_joined_space_with_cap,
        read_space_access,
    )
    from octospaces_sdk.sync.client import make_client
    from octospaces_sdk.sync.space_access_store import save_space_access_entry, MemberAccessEntry

    bundle = json.loads(invite_json)
    cap = bundle["cap"]
    space_id = bundle["spaceId"]
    space_name = bundle.get("spaceName", "")

    # The cap sub must match this session's edPub
    if cap.get("sub") != session.keys["edPub"]:
        raise ValueError("Invite cap is not addressed to this device")

    cap_json = json.dumps(cap, separators=(",", ":"))
    save_space_access_entry(space_id, MemberAccessEntry(kind="member", cap=cap_json))

    client = make_client(cap, session.keys["edPriv"])
    access = await read_space_access(client, space_id)
    space = Space(
        id=space_id,
        name=access.get("name") or space_name,
        short=space_name.lower().replace(" ", "-")[:40] or "space",
        members=len(access.get("members", [])),
    )
    await add_joined_space_with_cap(session.account_client, session.user_id, space, cap_json)
    return space


# ── Link-based join ───────────────────────────────────────────────────────────


async def create_space_invite_link(
    session: Session,
    space_id: str,
    space_name: str,
    write: bool,
    origin: str,
) -> dict[str, Any]:
    """Owner: create a shareable space invite link."""
    from starfish_identities.pairing import generate_device_keys  # type: ignore[import-untyped]
    from starfish_sharing.cap_mint import mint_member_cap  # type: ignore[import-untyped]

    import time

    from octospaces_sdk.sync.paths import space_member_scope

    # Mint an ephemeral identity
    ephemeral = generate_device_keys()
    eph_ed_priv = ephemeral["ed_priv_hex"]
    eph_ed_pub = ephemeral["ed_pub_hex"]
    eph_kem_pub = ephemeral["kem_pub_hex"]

    from octospaces_sdk.sync.paths import user_id_from_ed_pub

    eph_user_id = user_id_from_ed_pub(eph_ed_pub)
    scope = space_member_scope(space_id, write)
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

    # Add ephemeral KEM to keyring
    await _add_member_to_keyring(
        session=session,
        space_id=space_id,
        member_kem_pub=eph_kem_pub,
        member_ed_pub=eph_ed_pub,
    )

    token = SpaceInviteLinkToken(
        v=1,
        spaceId=space_id,
        spaceName=space_name,
        cap=cap,
        key=eph_ed_priv,
        write=write,
    )
    link = encode_space_invite_link(origin, token)
    return {"token": token, "link": link}


async def join_space_by_link(session: Session, token: SpaceInviteLinkToken) -> Space:
    """Invitee: redeem a space invite link."""
    from octospaces_sdk.spaces.registry import (
        add_joined_space_with_link_access,
        read_space_access,
    )
    from octospaces_sdk.sync.account_seal import seal_to_self
    from octospaces_sdk.sync.client import make_client
    from octospaces_sdk.sync.space_access_store import LinkAccessEntry, save_space_access_entry

    space_id = token["spaceId"]
    cap = token["cap"]
    key = token["key"]

    client = make_client(cap, key)
    access = await read_space_access(client, space_id)
    space = Space(
        id=space_id,
        name=access.get("name") or token["spaceName"],
        short=token["spaceName"].lower().replace(" ", "-")[:40] or "space",
        members=len(access.get("members", [])),
    )

    # Seal the link credential to self for the _spaces registry
    sealed = seal_to_self(
        session,
        json.dumps({"cap": cap, "key": key, "write": token["write"]}, separators=(",", ":")),
    )

    save_space_access_entry(space_id, LinkAccessEntry(kind="link", cap=cap, key=key, write=token["write"]))
    await add_joined_space_with_link_access(session.account_client, session.user_id, space, sealed)
    return space


# ── Recover space access on sign-in ──────────────────────────────────────────


async def recover_space_access(
    session: Session,
    server: dict[str, Any],
) -> None:
    """Hydrate the access store from server-provided caps + pubAccess."""
    from octospaces_sdk.sync.space_access_store import hydrate_space_access_store

    await hydrate_space_access_store(
        user_id=session.user_id,
        server_caps=server.get("caps", {}),
        server_link_access=server.get("pubAccess", {}),
    )


# ── Device → keyring ──────────────────────────────────────────────────────────


async def add_device_to_space_keyring(
    session: Session,
    space_id: str,
    device: dict[str, Any],
) -> None:
    await _add_member_to_keyring(
        session=session,
        space_id=space_id,
        member_kem_pub=device["kemPub"],
        member_ed_pub=device["edPub"],
    )


# ── Internal keyring helper ───────────────────────────────────────────────────


async def _add_member_to_keyring(
    *,
    session: Session,
    space_id: str,
    member_kem_pub: str,
    member_ed_pub: str,
) -> None:
    """Pull the space keyring, add a recipient, push back.

    Uses the low-level keyring API to:
    1. Pull + parse the Keyring document.
    2. Unwrap the current CEK using our own KEM private key.
    3. Re-wrap it for the new recipient.
    4. Push the updated Keyring.
    """
    from starfish_keyring.keyring import (  # type: ignore[import-untyped]
        Keyring,
        add_recipient as kr_add_recipient,
        create_keyring,
        unwrap_from_entry,
    )

    from octospaces_sdk.sync.identity import owner_trusted_adders
    from octospaces_sdk.sync.paths import keyring_pull, keyring_push

    pull_path = keyring_pull(space_id)
    push_path = keyring_push(space_id)

    doc = await session.spaces_keyring_client.pull(pull_path)
    base_hash: str | None = None

    if doc is None or not doc.get("data"):
        # No keyring yet — create one with just ourselves
        keyring, _ = create_keyring(
            adder_ed_priv_hex=session.keys["edPriv"],
            adder_ed_pub_hex=session.keys["edPub"],
            recipients=[session.keys["kemPub"]],
        )
        # Push the newly created keyring first so we have a base hash
        await session.spaces_keyring_client.push(push_path, keyring.to_dict())
        doc = await session.spaces_keyring_client.pull(pull_path)
        base_hash = doc.get("hash") if doc else None
    else:
        keyring = Keyring.from_dict(doc["data"])
        base_hash = doc.get("hash")

    # Find our own wrapped entry in the current epoch to recover the CEK
    epoch_key = str(keyring.current_epoch)
    epoch_obj = keyring.epochs.get(epoch_key)
    if epoch_obj is None:
        raise RuntimeError(f"Keyring epoch {keyring.current_epoch} not found")

    current_cek: bytes | None = None
    for entry in epoch_obj.wrapped_keys:
        if entry.sub_kem == session.keys["kemPub"]:
            current_cek = unwrap_from_entry(entry, session.keys["kemPriv"])
            break

    if current_cek is None:
        raise RuntimeError("Could not unwrap keyring CEK — our KEM key is not a recipient")

    updated_keyring = kr_add_recipient(
        keyring,
        adder_ed_priv_hex=session.keys["edPriv"],
        adder_ed_pub_hex=session.keys["edPub"],
        current_cek=current_cek,
        recipient_kem_hex=member_kem_pub,
    )
    await session.spaces_keyring_client.push(push_path, updated_keyring.to_dict(), base_hash)
