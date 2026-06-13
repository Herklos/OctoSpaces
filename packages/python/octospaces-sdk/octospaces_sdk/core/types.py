"""Domain types for the OctoSpaces SDK.

Mirrors ``packages/ts/octospaces-sdk/src/core/types.ts``.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict


# ── Primitive type aliases ────────────────────────────────────────────────────

ID = str
PresenceStatus = Literal["online", "away", "dnd", "offline"]
VerificationLevel = Literal["verified", "pending", "unverified", "none"]

# spaceId → member cap JSON string
CapMap = dict[str, str]

# key = spaceId or "{spaceId}:{nodeId}" → SealedBlob dict
PubAccessMap = dict[str, Any]

DmMap = dict[str, str]
ArchivedDms = dict[str, Literal[True]]

MuteValue = bool | int  # True or a Unix-ms timestamp until which muted


class MutePrefs(TypedDict):
    rooms: dict[str, MuteValue]
    spaces: dict[str, MuteValue]


ReadValue = int  # Unix-ms timestamp of last read


class ReadPrefs(TypedDict):
    rooms: dict[str, ReadValue]


ObjectType = str
ObjectContentKind = Literal["merge", "append", "none"]
NodeAccess = Literal["public", "space", "invite"]


# ── Core domain objects ───────────────────────────────────────────────────────


class Space(TypedDict, total=False):
    id: str         # required
    name: str       # required
    short: str      # required
    image: str
    members: int    # required
    unread: int


class SpaceRequired(TypedDict):
    id: str
    name: str
    short: str
    members: int


class ObjectNode(TypedDict, total=False):
    id: str          # required
    type: str        # required
    parentId: Optional[str]  # required (may be None)
    order: int       # required
    title: str       # required
    emoji: str
    updatedAt: int   # required (Unix ms)
    archived: bool
    contentKind: ObjectContentKind
    access: NodeAccess
    enc: bool
    meta: dict[str, Any]


class ObjectsIndex(TypedDict):
    v: Literal[1, 2]
    objects: list[ObjectNode]
    updatedAt: int


# ── Storage / identity types ──────────────────────────────────────────────────


class DeviceKeys(TypedDict):
    edPriv: str
    edPub: str
    kemPriv: str
    kemPub: str


class PublicProfile(TypedDict, total=False):
    pseudo: Optional[str]
    avatar: Optional[str]
    edPub: Optional[str]
    kemPub: Optional[str]


# ── Sealed blob (account-seal) ────────────────────────────────────────────────


class SealedBlob(TypedDict):
    """A small secret sealed to a KEM key.

    ``entry`` holds the KEM-wrapped CEK (``WrappedKeyEntry`` shape from
    starfish-keyring); ``ct`` is **hex-encoded** ``iv || AES-GCM-ciphertext``
    (16 bytes IV + ciphertext + 16-byte GCM tag).

    ⚠ The outer ``ct`` field uses **hex** — not the keyring's standard base64.
    This is an octospaces-specific encoding so sealed ``_spaces`` blobs can be
    stored as a plain JSON string without nested base64.
    """

    entry: dict[str, Any]  # WrappedKeyEntry
    ct: str                # hex(iv‖ciphertext‖tag)
