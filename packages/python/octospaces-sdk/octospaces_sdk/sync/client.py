"""Starfish client construction and low-level sync helpers.

Mirrors ``packages/ts/octospaces-sdk/src/sync/client.ts``.

Depends on ``starfish_sdk`` (Python port of ``@drakkar.software/starfish-client``),
``starfish_identities``, ``starfish_keyring``, and ``starfish_protocol``.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Optional

from starfish_protocol.request_signing import sign_request  # type: ignore[import-untyped]
from starfish_protocol.cap import sign_cap_cert  # type: ignore[import-untyped]

from octospaces_sdk.core.config import get_sync_base, get_sync_namespace, get_shared_spaces_namespace
from octospaces_sdk.core.types import DeviceKeys, PublicProfile
from octospaces_sdk.sync.paths import (
    account_scope,
    linked_device_scope,
    owner_scope,
    profile_pull,
    profile_push,
    space_member_scope,
    spaces_pull,
    spaces_push,
    user_id_from_ed_pub,
)


# ── Auth headers ──────────────────────────────────────────────────────────────


def build_auth_headers(
    cap: dict[str, Any],
    dev_ed_priv_hex: str,
    method: str,
    path_and_query: str,
    body: bytes = b"",
    *,
    host: str = "",
    ts: Optional[int] = None,
    nonce: Optional[str] = None,
) -> dict[str, str]:
    """Build the three auth headers required by the Starfish sync server.

    Returns::

        {
            "Authorization": "Cap <base64(json(cap))>",
            "X-Starfish-Sig":   "<base64(Ed25519 sig)>",
            "X-Starfish-Ts":    "<unix-ms>",
            "X-Starfish-Nonce": "<base64(16 random bytes)>",
        }

    Mirrors ``buildAuthHeaders`` in ``sync/client.ts`` and
    ``cap_auth_headers`` in ``Infra/sync/tests/utils/caps.py``.
    """
    cap_b64 = base64.b64encode(json.dumps(cap, separators=(",", ":")).encode()).decode()

    ts_ms = ts if ts is not None else int(time.time() * 1000)

    sig, actual_ts, actual_nonce = sign_request(
        dev_ed_priv_hex=dev_ed_priv_hex,
        method=method.upper(),
        path_and_query=path_and_query,
        body=body,
        host=host,
        ts=ts_ms,
        nonce=nonce,
    )

    return {
        "Authorization": f"Cap {cap_b64}",
        "X-Starfish-Sig": sig,
        "X-Starfish-Ts": str(actual_ts),
        "X-Starfish-Nonce": actual_nonce,
    }


# ── Cap minting ───────────────────────────────────────────────────────────────


def _mint_self_cap(
    keys: DeviceKeys,
    user_id: str,
    scope: dict[str, Any],
    *,
    ttl_days: int = 365,
) -> dict[str, Any]:
    """Mint a self-signed device cap (root → device)."""
    from starfish_identities.cap_mint import mint_device_cap  # type: ignore[import-untyped]

    now = int(time.time())
    return mint_device_cap(
        iss_ed_priv_hex=keys["edPriv"],
        iss_ed_pub_hex=keys["edPub"],
        iss_user_id=user_id,
        sub_ed_pub_hex=keys["edPub"],
        sub_kem_pub_hex=keys["kemPub"],
        sub_user_id=user_id,
        scope=scope,
        nbf=now,
        exp=now + ttl_days * 86400,
    )


def _mint_member_cap(
    issuer_keys: DeviceKeys,
    issuer_user_id: str,
    subject_ed_pub: str,
    subject_kem_pub: str,
    subject_user_id: str,
    scope: dict[str, Any],
    *,
    ttl_days: int = 30,
) -> dict[str, Any]:
    from starfish_sharing.cap_mint import mint_member_cap  # type: ignore[import-untyped]

    now = int(time.time())
    return mint_member_cap(
        iss_ed_priv_hex=issuer_keys["edPriv"],
        iss_ed_pub_hex=issuer_keys["edPub"],
        iss_user_id=issuer_user_id,
        sub_ed_pub_hex=subject_ed_pub,
        sub_kem_pub_hex=subject_kem_pub,
        sub_user_id=subject_user_id,
        scope=scope,
        nbf=now,
        exp=now + ttl_days * 86400,
    )


# ── Client construction ───────────────────────────────────────────────────────


def make_client(
    cap: dict[str, Any],
    dev_ed_priv_hex: str,
    namespace_override: Optional[str] = None,
) -> Any:
    """Construct a StarfishClient for *cap* and the configured sync server.

    Mirrors ``makeClient`` in ``sync/client.ts``.
    """
    from starfish_sdk import StarfishClient  # type: ignore[import-untyped]

    ns = namespace_override or get_sync_namespace()
    base = get_sync_base()
    prefix = f"/v1/{ns}" if ns else ""

    return StarfishClient(
        base_url=base,
        path_prefix=prefix,
        cap=cap,
        dev_ed_priv_hex=dev_ed_priv_hex,
    )


async def _build_clients_for_identity(
    keys: DeviceKeys,
    user_id: str,
) -> tuple[Any, Any, Any, Any, Any, Any]:
    """Mint caps and construct the four clients for a Session.

    Returns (chat_client, account_client, spaces_registry_client,
             spaces_keyring_client, chat_cap, account_cap).
    """
    chat_cap = _mint_self_cap(keys, user_id, owner_scope())
    account_cap = _mint_self_cap(keys, user_id, account_scope(user_id))

    chat_client = make_client(chat_cap, keys["edPriv"])
    account_client = make_client(account_cap, keys["edPriv"])

    shared_ns = get_shared_spaces_namespace()
    if shared_ns:
        spaces_registry_client = make_client(account_cap, keys["edPriv"], namespace_override=shared_ns)
        spaces_keyring_client = make_client(chat_cap, keys["edPriv"], namespace_override=shared_ns)
    else:
        spaces_registry_client = account_client
        spaces_keyring_client = chat_client

    return (
        chat_client,
        account_client,
        spaces_registry_client,
        spaces_keyring_client,
        chat_cap,
        account_cap,
    )


# ── Keyring / encryptor helpers ───────────────────────────────────────────────


async def owner_ensure_keyring(
    client: Any,
    keys: DeviceKeys,
    keyring_pull_path: str,
    keyring_push_path: str,
    trusted_adders: Optional[list[str]] = None,
) -> Any:
    """Pull the space keyring; create it if missing.  Returns an Encryptor.

    Mirrors ``ownerEnsureKeyring`` in ``sync/client.ts``.
    """
    from starfish_keyring import (  # type: ignore[import-untyped]
        Keyring,
        create_keyring,
        create_keyring_encryptor,
    )

    adders = trusted_adders or [keys["edPub"]]

    doc = await client.pull(keyring_pull_path)
    keyring_dict = doc.get("data") if doc else None

    if keyring_dict is None:
        keyring, _ = create_keyring(
            adder_ed_priv_hex=keys["edPriv"],
            adder_ed_pub_hex=keys["edPub"],
            recipients=[keys["kemPub"]],
        )
        await client.push(keyring_push_path, keyring.to_dict())
    else:
        keyring = Keyring.from_dict(keyring_dict)

    return create_keyring_encryptor(
        keyring,
        keys["kemPub"],
        keys["kemPriv"],
        trusted_adders=adders,
    )


async def open_encryptor(
    client: Any,
    keys: DeviceKeys,
    keyring_pull_path: str,
    trusted_adders: list[str],
) -> Any:
    """Pull the keyring and return an Encryptor. Raises SpaceAccessError on denial."""
    from starfish_keyring import Keyring, create_keyring_encryptor  # type: ignore[import-untyped]

    from octospaces_sdk.core.space_access_error import SpaceAccessError

    doc = await client.pull(keyring_pull_path)
    if doc is None or doc.get("data") is None:
        raise SpaceAccessError(f"Keyring not found at {keyring_pull_path}")

    keyring = Keyring.from_dict(doc["data"])
    return create_keyring_encryptor(
        keyring,
        keys["kemPub"],
        keys["kemPriv"],
        trusted_adders=trusted_adders,
    )


async def build_encryptor(
    client: Any,
    keys: DeviceKeys,
    keyring_pull_path: str,
    trusted_adders: list[str],
) -> Any | None:
    """Soft variant of ``open_encryptor`` — returns ``None`` instead of raising."""
    try:
        return await open_encryptor(client, keys, keyring_pull_path, trusted_adders)
    except Exception:
        return None


# ── Profile helpers ───────────────────────────────────────────────────────────


async def read_profile(user_id: str) -> PublicProfile:
    """Read the public profile for *user_id* from the sync server."""
    from octospaces_sdk.sync.profile_cache import load_cached_profile

    cached = await load_cached_profile(user_id)
    if cached is not None:
        return cached
    # Profile reads are public — use an anonymous pull
    from starfish_sdk import StarfishClient  # type: ignore[import-untyped]

    base = get_sync_base()
    ns = get_sync_namespace()
    prefix = f"/v1/{ns}" if ns else ""
    path = profile_pull(user_id)
    client = StarfishClient(base_url=base, path_prefix=prefix, cap=None, dev_ed_priv_hex="")
    try:
        doc = await client.pull(path)
        profile: PublicProfile = doc.get("data", {}) if doc else {}
        return profile
    except Exception:
        return PublicProfile(pseudo=None, avatar=None, edPub=None, kemPub=None)


async def write_profile(client: Any, user_id: str, patch: dict[str, Any]) -> None:
    """Write a profile patch for *user_id*."""
    path = profile_push(user_id)
    existing_doc = await client.pull(profile_pull(user_id))
    existing = existing_doc.get("data", {}) if existing_doc else {}
    merged = {**existing, **patch}
    base_hash = existing_doc.get("hash") if existing_doc else None
    await client.push(path, merged, base_hash=base_hash)
