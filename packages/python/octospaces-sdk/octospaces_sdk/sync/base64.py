"""Standard base64 helpers.

Mirrors ``packages/ts/octospaces-sdk/src/sync/base64.ts``.

The TS SDK's ``starfishBase64`` is a chunked standard-base64 codec (to avoid
stack overflow on large blobs in JS).  In Python, ``base64.b64encode`` is
always correct regardless of size, so this module is a thin wrapper.
"""

from __future__ import annotations

import base64


def encode(data: bytes) -> str:
    """Encode *data* as standard base64 (padded, ``+/``)."""
    return base64.b64encode(data).decode()


def decode(s: str) -> bytes:
    """Decode a standard base64 string."""
    return base64.b64decode(s)
