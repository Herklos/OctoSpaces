"""Persistence / vault types.

Mirrors ``packages/ts/octospaces-sdk/src/core/storage-types.ts``.

Web-only concepts (passkeys, localStorage) are omitted; the host injects a
``KvAdapter`` via ``configure_kv`` (see ``adapters.py``).
"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

from .types import DeviceKeys


class DerivedIdentity(TypedDict):
    userId: str
    keys: DeviceKeys


class PersistedSession(TypedDict, total=False):
    seed: list[str]
    name: str  # required
    derived: DerivedIdentity
    bootstrapOrigin: dict[str, Any]
    capCert: dict[str, Any]


class Vault(TypedDict):
    accounts: list[PersistedSession]
    activeId: str


UnlockMethod = Literal["pin", "passkey"]


# VaultLoad discriminated union
class VaultLoadNone(TypedDict):
    kind: Literal["none"]


class VaultLoadReady(TypedDict):
    kind: Literal["ready"]
    vault: Vault


class VaultLoadLocked(TypedDict):
    kind: Literal["locked"]
    methods: list[UnlockMethod]


class VaultLoadError(TypedDict):
    kind: Literal["error"]
    error: Any


VaultLoad = VaultLoadNone | VaultLoadReady | VaultLoadLocked | VaultLoadError
