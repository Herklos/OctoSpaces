"""KV adapter — injectable key/value store.

Mirrors the injection pattern of ``packages/ts/octospaces-sdk/src/core/adapters.ts``
while replacing the web-specific localStorage / AsyncStorage adapters with
Python-native alternatives.

Usage::

    from octospaces_sdk.core.adapters import configure_kv, MemoryKvAdapter

    configure_kv(MemoryKvAdapter())   # call once at boot
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol


class KvAdapter(Protocol):
    """Minimal key/value store interface — mirrors the TS ``KvAdapter``."""

    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str) -> None: ...
    async def remove(self, key: str) -> None: ...


# Module-level singleton — set via configure_kv()
_kv: KvAdapter | None = None


def configure_kv(adapter: KvAdapter) -> None:
    """Install the KV store. Call once before any SDK API that persists data."""
    global _kv
    _kv = adapter


async def kv_get(key: str) -> str | None:
    if _kv is None:
        raise RuntimeError("KV adapter not configured — call configure_kv() first.")
    return await _kv.get(key)


async def kv_set(key: str, value: str) -> None:
    if _kv is None:
        raise RuntimeError("KV adapter not configured — call configure_kv() first.")
    await _kv.set(key, value)


async def kv_remove(key: str) -> None:
    if _kv is None:
        raise RuntimeError("KV adapter not configured — call configure_kv() first.")
    await _kv.remove(key)


# ── Built-in adapters ─────────────────────────────────────────────────────────


class MemoryKvAdapter:
    """In-process dict-backed KV — suitable for testing and server contexts."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    async def set(self, key: str, value: str) -> None:
        self._store[key] = value

    async def remove(self, key: str) -> None:
        self._store.pop(key, None)


class FileKvAdapter:
    """JSON-file-backed KV — persists across process restarts."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def _load(self) -> dict[str, str]:
        if not self._path.exists():
            return {}
        try:
            return json.loads(self._path.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    def _save(self, data: dict[str, str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(data))

    async def get(self, key: str) -> str | None:
        return self._load().get(key)

    async def set(self, key: str, value: str) -> None:
        data = self._load()
        data[key] = value
        self._save(data)

    async def remove(self, key: str) -> None:
        data = self._load()
        data.pop(key, None)
        self._save(data)
