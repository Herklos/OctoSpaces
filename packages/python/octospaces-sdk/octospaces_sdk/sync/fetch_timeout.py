"""Timeout-wrapped HTTP helpers.

Mirrors ``packages/ts/octospaces-sdk/src/sync/fetch-timeout.ts``.
"""

from __future__ import annotations

import httpx

CONNECT_TIMEOUT_MS = 12_000


def make_http_client(timeout_ms: int = CONNECT_TIMEOUT_MS) -> httpx.AsyncClient:
    """Return an ``httpx.AsyncClient`` with the given connect timeout."""
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout_ms / 1000))
