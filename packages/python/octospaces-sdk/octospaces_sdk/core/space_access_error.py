"""SpaceAccessError — raised when a space or node is unreachable.

Mirrors ``packages/ts/octospaces-sdk/src/core/space-access-error.ts``.
"""


class SpaceAccessError(Exception):
    """Raised when the caller has no valid credential to reach a space or node."""
