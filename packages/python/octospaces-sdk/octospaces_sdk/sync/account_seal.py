"""Account-level sealed blobs — seal small secrets to a KEM key.

Mirrors ``packages/ts/octospaces-sdk/src/sync/account-seal.ts``.

⚠ DIVERGENCE FROM KEYRING SEAL:
  The keyring's built-in ``seal`` method encodes the outer ``ct`` as **base64**.
  This module uses **hex** (``bytes_to_hex(iv‖ct)``) to match the format that
  the TS SDK writes into ``_spaces`` docs.  Both use ``SEAL_EPOCH = 0``.

  Python equivalents:
    ``sealToSelf``      → :func:`seal_to_self`
    ``unsealFromSelf``  → :func:`unseal_from_self`
    ``sealToRecipient`` → :func:`seal_to_recipient`
    ``unsealFromRecipient`` → :func:`unseal_from_recipient`
"""

from __future__ import annotations

import os
import time
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # type: ignore[import-untyped]

from starfish_keyring.keyring import wrap_for_recipient, unwrap_from_entry  # type: ignore[import-untyped]

from octospaces_sdk.core.types import DeviceKeys, SealedBlob
from octospaces_sdk.sync.identity import Session

_SEAL_EPOCH = 0
_IV_BYTES = 12
_CEK_BYTES = 32


def _aes_gcm_encrypt(cek: bytes, iv: bytes, plaintext: bytes) -> bytes:
    """AES-256-GCM encrypt; returns ciphertext+tag (16 bytes tag appended)."""
    return AESGCM(cek).encrypt(iv, plaintext, None)


def _aes_gcm_decrypt(cek: bytes, iv: bytes, ct_and_tag: bytes) -> bytes:
    return AESGCM(cek).decrypt(iv, ct_and_tag, None)


def _entry_to_dict(entry: Any) -> dict[str, Any]:
    """Convert a WrappedKeyEntry (dataclass) to a plain dict for SealedBlob.entry."""
    if hasattr(entry, "to_dict"):
        return entry.to_dict()
    return entry  # already a dict


def _entry_from_dict(d: Any) -> Any:
    """Convert a plain dict back to a WrappedKeyEntry for unwrap_from_entry."""
    from starfish_keyring.keyring import WrappedKeyEntry  # type: ignore[import-untyped]

    if isinstance(d, dict):
        return WrappedKeyEntry.from_dict(d)
    return d  # already a WrappedKeyEntry


def seal_to_self(
    session: Session,
    plaintext: str,
    *,
    _cek: bytes | None = None,
    _iv: bytes | None = None,
    _added_at: int | None = None,
) -> SealedBlob:
    """Seal *plaintext* to the session's own KEM key.

    *_cek*, *_iv*, and *_added_at* are injection points for deterministic testing.
    """
    cek = _cek if _cek is not None else os.urandom(_CEK_BYTES)
    iv = _iv if _iv is not None else os.urandom(_IV_BYTES)
    added_at = _added_at if _added_at is not None else int(time.time())

    entry = wrap_for_recipient(
        cek,
        session.keys["kemPub"],
        adder_ed_priv_hex=session.keys["edPriv"],
        adder_ed_pub_hex=session.keys["edPub"],
        added_at=added_at,
        epoch=_SEAL_EPOCH,
        iv=iv,
    )

    ct_and_tag = _aes_gcm_encrypt(cek, iv, plaintext.encode())
    packed_hex = (iv + ct_and_tag).hex()

    return SealedBlob(entry=_entry_to_dict(entry), ct=packed_hex)


async def unseal_from_self(session: Session, blob: SealedBlob) -> str:
    """Unseal a blob sealed to this session's own KEM key."""
    entry = _entry_from_dict(blob["entry"])
    cek = unwrap_from_entry(entry, session.keys["kemPriv"])
    packed = bytes.fromhex(blob["ct"])
    iv, ct_and_tag = packed[:_IV_BYTES], packed[_IV_BYTES:]
    return _aes_gcm_decrypt(cek, iv, ct_and_tag).decode()


def seal_to_recipient(
    session: Session,
    recipient_kem_pub: str,
    plaintext: str,
    *,
    _cek: bytes | None = None,
    _iv: bytes | None = None,
    _added_at: int | None = None,
) -> SealedBlob:
    """Seal *plaintext* for a specific recipient's KEM public key."""
    cek = _cek if _cek is not None else os.urandom(_CEK_BYTES)
    iv = _iv if _iv is not None else os.urandom(_IV_BYTES)
    added_at = _added_at if _added_at is not None else int(time.time())

    entry = wrap_for_recipient(
        cek,
        recipient_kem_pub,
        adder_ed_priv_hex=session.keys["edPriv"],
        adder_ed_pub_hex=session.keys["edPub"],
        added_at=added_at,
        epoch=_SEAL_EPOCH,
        iv=iv,
    )

    ct_and_tag = _aes_gcm_encrypt(cek, iv, plaintext.encode())
    packed_hex = (iv + ct_and_tag).hex()

    return SealedBlob(entry=_entry_to_dict(entry), ct=packed_hex)


async def unseal_from_recipient(session: Session, blob: SealedBlob) -> str:
    """Unseal a blob sealed to this session (as recipient)."""
    return await unseal_from_self(session, blob)
