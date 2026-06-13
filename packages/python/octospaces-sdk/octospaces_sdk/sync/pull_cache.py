"""Offline pull cache — persists pulled docs in the KV store.

Mirrors ``packages/ts/octospaces-sdk/src/sync/pull-cache.ts``.
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional

from octospaces_sdk.core.adapters import kv_get, kv_remove, kv_set

PULL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000  # 30 days
_PREFIX = "octospaces.pullcache."


async def cache_pull(path: str, doc: Any) -> None:
    entry = {"doc": doc, "ts": int(time.time() * 1000)}
    await kv_set(f"{_PREFIX}{path}", json.dumps(entry))


async def load_cached_pull(path: str) -> Optional[Any]:
    raw = await kv_get(f"{_PREFIX}{path}")
    if raw is None:
        return None
    try:
        entry = json.loads(raw)
    except json.JSONDecodeError:
        return None
    age = int(time.time() * 1000) - entry.get("ts", 0)
    if age > PULL_CACHE_MAX_AGE_MS:
        await kv_remove(f"{_PREFIX}{path}")
        return None
    return entry["doc"]
