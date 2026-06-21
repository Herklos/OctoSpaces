"""Session / identity management.

Mirrors ``packages/ts/octospaces-sdk/src/sync/identity.ts``.

Depends on ``starfish-identities`` and ``starfish-sdk`` (the Python Starfish
packages from the ``satellite`` monorepo).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from starfish_identities.identity import derive_root_identity  # type: ignore[import-untyped]
from starfish_identities.pairing import generate_device_keys  # type: ignore[import-untyped]

from octospaces_sdk.core.storage_types import DerivedIdentity
from octospaces_sdk.core.types import DeviceKeys
from octospaces_sdk.sync.paths import user_id_from_ed_pub


# ── Fingerprint helpers ───────────────────────────────────────────────────────


def fingerprint_from_user_id(user_id: str) -> str:
    """Format a user-id as a human-readable fingerprint, e.g. ``'ABCD · EF12 · 3456'``."""
    upper = user_id.upper()
    return " · ".join([upper[0:4], upper[4:8], upper[8:12]])


# ── BIP-39 seed words ─────────────────────────────────────────────────────────


def generate_seed_words() -> list[str]:
    """Generate a fresh 12-word BIP-39 mnemonic (128-bit entropy)."""
    try:
        from mnemonic import Mnemonic  # type: ignore[import-untyped]

        mnemo = Mnemonic("english")
        return mnemo.generate(strength=128).split()
    except ImportError:
        pass
    # Fallback: use bip_utils if available
    try:
        from bip_utils import Bip39MnemonicGenerator, Bip39WordsNum  # type: ignore[import-untyped]

        return Bip39MnemonicGenerator().FromWordsNumber(Bip39WordsNum.WORDS_NUM_12).ToStr().split()
    except ImportError:
        raise ImportError(
            "A BIP-39 library is required for generate_seed_words(). "
            "Install 'mnemonic' or 'bip-utils': pip install mnemonic"
        )


def is_valid_seed(words: list[str]) -> bool:
    """Check whether *words* is a valid 12-word BIP-39 mnemonic."""
    if len(words) != 12:
        return False
    try:
        from mnemonic import Mnemonic  # type: ignore[import-untyped]

        return Mnemonic("english").check(" ".join(words))
    except ImportError:
        pass
    try:
        from bip_utils import Bip39MnemonicValidator  # type: ignore[import-untyped]

        return Bip39MnemonicValidator().IsValid(" ".join(words))
    except ImportError:
        return True  # cannot validate without a library — trust the caller


# ── Session ───────────────────────────────────────────────────────────────────


@dataclass
class Session:
    """The in-memory session object produced by :func:`derive_session`.

    Holds all four Starfish clients and the device keys needed to talk to the
    sync server.  Mirrors the TS ``Session`` interface.
    """

    user_id: str
    name: str
    keys: DeviceKeys
    owner_ed_pub: str
    fingerprint: str

    # Starfish clients (starfish_sdk.StarfishClient)
    content_client: Any
    account_client: Any
    spaces_registry_client: Any
    spaces_keyring_client: Any

    # Capability JSON strings (raw cap-cert dicts)
    content_cap: Any
    account_cap: Any


def owner_trusted_adders(session: Session) -> list[str]:
    """The list of Ed25519 pubkeys trusted to add keyring recipients.

    Includes the owner's root edPub and the device's own edPub (if different,
    e.g. on a paired device).
    """
    adders = [session.owner_ed_pub]
    if session.keys["edPub"] != session.owner_ed_pub:
        adders.append(session.keys["edPub"])
    return adders


def _root_identity_of_session(session: Session) -> DerivedIdentity:
    return DerivedIdentity(userId=session.user_id, keys=session.keys)


# ── Session builders ──────────────────────────────────────────────────────────


async def derive_session(
    seed_words: list[str],
    name: str = "default",
) -> Session:
    """Full identity derivation from a BIP-39 seed phrase.

    Runs Argon2id (via ``starfish_identities.derive_root_identity``) and
    builds all four Starfish clients.  This is the main entry point for a
    first-time or sign-in flow.
    """
    from octospaces_sdk.sync.client import _build_clients_for_identity

    passphrase = " ".join(seed_words).strip()
    root = derive_root_identity(passphrase)

    keys: DeviceKeys = {
        "edPriv": root.key_pair.ed_priv_hex,
        "edPub": root.key_pair.ed_pub_hex,
        "kemPriv": root.kem_key_pair.kem_priv_hex,
        "kemPub": root.kem_key_pair.kem_pub_hex,
    }
    user_id = user_id_from_ed_pub(keys["edPub"])
    fingerprint = fingerprint_from_user_id(user_id)

    (
        content_client,
        account_client,
        spaces_registry_client,
        spaces_keyring_client,
        content_cap,
        account_cap,
    ) = await _build_clients_for_identity(keys, user_id)

    return Session(
        user_id=user_id,
        name=name,
        keys=keys,
        owner_ed_pub=keys["edPub"],
        fingerprint=fingerprint,
        content_client=content_client,
        account_client=account_client,
        spaces_registry_client=spaces_registry_client,
        spaces_keyring_client=spaces_keyring_client,
        content_cap=content_cap,
        account_cap=account_cap,
    )


async def build_session(derived: DerivedIdentity, name: str = "default") -> Session:
    """Build a session from an already-derived identity (no Argon2id)."""
    from octospaces_sdk.sync.client import _build_clients_for_identity

    keys = derived["keys"]
    user_id = derived["userId"]
    fingerprint = fingerprint_from_user_id(user_id)

    (
        content_client,
        account_client,
        spaces_registry_client,
        spaces_keyring_client,
        content_cap,
        account_cap,
    ) = await _build_clients_for_identity(keys, user_id)

    return Session(
        user_id=user_id,
        name=name,
        keys=keys,
        owner_ed_pub=keys["edPub"],
        fingerprint=fingerprint,
        content_client=content_client,
        account_client=account_client,
        spaces_registry_client=spaces_registry_client,
        spaces_keyring_client=spaces_keyring_client,
        content_cap=content_cap,
        account_cap=account_cap,
    )
