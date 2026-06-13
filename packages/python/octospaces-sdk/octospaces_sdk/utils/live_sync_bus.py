"""In-process live-sync dispatch bus.

Mirrors ``packages/ts/octospaces-sdk/src/utils/live-sync-bus.ts``.

Couples SSE doc-change events to registered pull callbacks and SSE-status
listeners.  In Python server contexts this typically runs inside an async
event loop; in CLI/test contexts ``dispatch_doc_change`` is called manually.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

# doc_path → set of async-or-sync callbacks
_pull_listeners: dict[str, set[Callable[[], Any]]] = {}
_sse_status_listeners: set[Callable[[bool], Any]] = set()


def register_pull(doc_path: str, fn: Callable[[], Any]) -> Callable[[], None]:
    """Register *fn* to be called whenever *doc_path* changes.

    Returns an unregister callable.
    """
    _pull_listeners.setdefault(doc_path, set()).add(fn)

    def unregister() -> None:
        listeners = _pull_listeners.get(doc_path)
        if listeners:
            listeners.discard(fn)

    return unregister


def dispatch_doc_change(doc_path: str) -> bool:
    """Fire all pull listeners registered for *doc_path*.

    Returns ``True`` if any listener was called.
    """
    listeners = _pull_listeners.get(doc_path)
    if not listeners:
        return False
    for fn in list(listeners):
        result = fn()
        if asyncio.iscoroutine(result):
            # Fire-and-forget in the running loop if one exists
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(result)
            except RuntimeError:
                pass
    return True


def emit_sse_status(up: bool) -> None:
    """Broadcast an SSE connectivity change to all listeners."""
    for cb in list(_sse_status_listeners):
        cb(up)


def on_sse_status(cb: Callable[[bool], Any]) -> Callable[[], None]:
    """Register a callback that fires on SSE up/down events.

    Returns an unregister callable.
    """
    _sse_status_listeners.add(cb)

    def unregister() -> None:
        _sse_status_listeners.discard(cb)

    return unregister


def clear_live_sync_bus() -> None:
    """Clear all listeners (use in tests or on account switch)."""
    _pull_listeners.clear()
    _sse_status_listeners.clear()
