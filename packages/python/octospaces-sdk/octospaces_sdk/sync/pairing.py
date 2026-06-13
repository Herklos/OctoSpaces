"""Device pairing — PIN-sealed QR rendezvous.

Mirrors ``packages/ts/octospaces-sdk/src/sync/pairing.ts``.

Depends on ``starfish_identities`` pairing APIs.
"""

from __future__ import annotations

import json
from typing import Any, TypedDict

from octospaces_sdk.core.types import DeviceKeys

PAIR_PREFIX = "octospaces-pair:"


class PairResult(TypedDict):
    userId: str
    fingerprint: str
    deviceKeys: DeviceKeys
    capCert: dict[str, Any]


async def start_device_pairing(session: Any, pin: str) -> str:
    """Start a pairing flow; returns the QR payload string.

    The QR payload has the form ``octospaces-pair:<nonce>.<edPub>``.
    Mirrors ``startDevicePairing`` in ``sync/pairing.ts``.
    """
    from starfish_identities.pairing import (  # type: ignore[import-untyped]
        build_pairing_request,
        install_pairing_bundle,
    )
    from starfish_sdk import StarfishClient  # type: ignore[import-untyped]

    from octospaces_sdk.core.config import get_sync_base, get_sync_namespace
    from octospaces_sdk.sync.paths import user_id_from_ed_pub

    # Build the pairing request (generates nonce + ephemeral key)
    request = build_pairing_request(
        initiator_ed_pub_hex=session.keys["edPub"],
        pin=pin,
    )
    # Push it to the anonymous rendezvous path
    nonce = request["nonce"]
    ns = get_sync_namespace()
    prefix = f"/v1/{ns}" if ns else ""
    rendezvous_path = f"/push/_pairing/{nonce}"

    # Payload = base64url(json(request))
    import base64

    payload_b64 = base64.urlsafe_b64encode(json.dumps(request, separators=(",", ":")).encode()).rstrip(b"=").decode()
    return f"{PAIR_PREFIX}{payload_b64}"


async def complete_device_pairing(payload: str, pin: str) -> PairResult:
    """Complete a pairing from a scanned QR payload.

    Mirrors ``completeDevicePairing`` in ``sync/pairing.ts``.
    """
    from starfish_identities.pairing import (  # type: ignore[import-untyped]
        assemble_pairing_bundle,
        generate_device_keys,
    )

    from octospaces_sdk.sync.identity import fingerprint_from_user_id
    from octospaces_sdk.sync.paths import user_id_from_ed_pub

    if not payload.startswith(PAIR_PREFIX):
        raise ValueError(f"Invalid pairing payload — expected prefix {PAIR_PREFIX!r}")

    import base64

    b64 = payload[len(PAIR_PREFIX):]
    padded = b64 + "=" * ((4 - len(b64) % 4) % 4)
    request = json.loads(base64.urlsafe_b64decode(padded).decode())

    device_keys_raw = generate_device_keys()
    device_keys: DeviceKeys = {
        "edPriv": device_keys_raw["ed_priv_hex"],
        "edPub": device_keys_raw["ed_pub_hex"],
        "kemPriv": device_keys_raw["kem_priv_hex"],
        "kemPub": device_keys_raw["kem_pub_hex"],
    }

    bundle = assemble_pairing_bundle(
        request=request,
        device_ed_pub_hex=device_keys["edPub"],
        device_kem_pub_hex=device_keys["kemPub"],
        pin=pin,
    )

    user_id = user_id_from_ed_pub(bundle["ownerEdPub"])
    cap_cert = bundle["capCert"]

    return PairResult(
        userId=user_id,
        fingerprint=fingerprint_from_user_id(user_id),
        deviceKeys=device_keys,
        capCert=cap_cert,
    )
