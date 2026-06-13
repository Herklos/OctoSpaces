"""Base64URL encode/decode helpers.

Mirrors ``packages/ts/octospaces-sdk/src/sync/base64url.ts``.

Used for invite-link URL fragments: standard base64 with ``+→-``, ``/→_``,
and no ``=`` padding.
"""

from __future__ import annotations

import base64
import json
from typing import Any


def to_base64_url(obj: Any) -> str:
    """JSON-encode *obj* then base64url-encode the result (no padding)."""
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def from_base64_url(b64url: str) -> str:
    """Decode a base64url string back to a JSON string."""
    # Re-add padding
    padded = b64url + "=" * (-(len(b64url)) % 4)
    return base64.urlsafe_b64decode(padded).decode()


def from_base64_url_json(b64url: str) -> Any:
    """Decode a base64url string and JSON-parse the result."""
    return json.loads(from_base64_url(b64url))
