"""Offline profile cache.

Mirrors ``packages/ts/octospaces-sdk/src/sync/profile-cache.ts``.
"""

from __future__ import annotations

import json
from typing import Optional

from octospaces_sdk.core.adapters import kv_get, kv_set
from octospaces_sdk.core.types import PublicProfile

_PREFIX = "octospaces.profile."


async def cache_profile(user_id: str, profile: PublicProfile) -> None:
    await kv_set(f"{_PREFIX}{user_id}", json.dumps(profile))


async def load_cached_profile(user_id: str) -> Optional[PublicProfile]:
    raw = await kv_get(f"{_PREFIX}{user_id}")
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None
