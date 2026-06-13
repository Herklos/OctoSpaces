"""ID and slug helpers.

Mirrors ``packages/ts/octospaces-sdk/src/core/ids.ts``.
"""

from __future__ import annotations

import os
import re
import unicodedata


def random_id() -> str:
    """16 cryptographically-random bytes as a 32-character lowercase hex string.

    The random component means round-trip equality across languages is not
    possible for this function — use fixed-input vectors for ``room_slug``
    instead.
    """
    return os.urandom(16).hex()


def room_slug(name: str) -> str:
    """Derive a URL-clean ``[a-z0-9-]`` slug from *name*, max 40 chars.

    Mirrors the TS ``roomSlug`` function exactly:

    1. NFD-normalize and strip non-ASCII.
    2. Lowercase.
    3. Replace runs of non-alphanumeric chars with a single ``-``.
    4. Strip leading/trailing ``-``.
    5. Truncate to 40 chars (strip trailing ``-`` again after truncation).
    6. Fallback to ``'room'`` if the result is empty.
    """
    # NFD → strip combining marks → drop non-ASCII
    nfd = unicodedata.normalize("NFD", name)
    ascii_only = "".join(c for c in nfd if ord(c) < 128)
    lowered = ascii_only.lower()
    # replace runs of non-alnum with a single hyphen
    slugified = re.sub(r"[^a-z0-9]+", "-", lowered)
    # strip leading/trailing hyphens
    stripped = slugified.strip("-")
    # truncate to 40
    truncated = stripped[:40].rstrip("-")
    return truncated or "room"
