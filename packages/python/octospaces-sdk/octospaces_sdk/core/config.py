"""SDK configuration.

Mirrors ``packages/ts/octospaces-sdk/src/core/config.ts``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class OctoSpacesConfig:
    sync_base: str
    sync_namespace: Optional[str] = None
    shared_spaces_namespace: Optional[str] = None
    events_url: Optional[str] = None
    web_base: Optional[str] = None
    on_server_reachable: Optional[Callable[[], None]] = None


_config: OctoSpacesConfig | None = None

_RESERVED = {"namespace", "syncBase", "syncNamespace"}


def configure_octo_spaces(config: OctoSpacesConfig) -> None:
    """Call once at boot before any sync or identity API."""
    global _config
    _config = config


def _require_config() -> OctoSpacesConfig:
    if _config is None:
        raise RuntimeError(
            "OctoSpaces not configured — call configure_octo_spaces() first."
        )
    return _config


def get_sync_base() -> str:
    return _require_config().sync_base


def get_sync_namespace() -> Optional[str]:
    return _require_config().sync_namespace


def get_sync_prefix() -> str:
    ns = _require_config().sync_namespace
    return f"/v1/{ns}" if ns else ""


def get_shared_spaces_namespace() -> Optional[str]:
    return _require_config().shared_spaces_namespace


def get_events_url() -> Optional[str]:
    return _require_config().events_url


def get_web_base() -> Optional[str]:
    return _require_config().web_base


def get_on_server_reachable() -> Optional[Callable[[], None]]:
    return _require_config().on_server_reachable
