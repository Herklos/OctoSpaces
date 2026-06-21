# octospaces-sdk (Python)

Python port of `@drakkar.software/octospaces-sdk` — the headless OctoSpaces core.

Provides identity derivation, space registry, object tree management, invite flows, and sync plumbing, backed by the same `starfish-*` Python packages that power the satellite crypto stack.

## Install

```sh
pip install octospaces-sdk
```

Or via uv:

```sh
uv add octospaces-sdk
```

## Quick start

```python
import asyncio
from octospaces_sdk import (
    configure_octo_spaces, OctoSpacesConfig,
    configure_kv, MemoryKvAdapter,
    derive_session,
    create_space, read_spaces,
)

async def main():
    # 1. Configure the SDK
    configure_octo_spaces(OctoSpacesConfig(
        sync_base="https://your-sync-server.example.com",
        sync_namespace="yourns",
    ))
    configure_kv(MemoryKvAdapter())

    # 2. Derive a session from a seed phrase
    session = await derive_session("word1 word2 ... word12", name="my-laptop")

    # 3. Create a space
    space = await create_space(session, "My Space")
    print(space)  # Space(id=..., name='My Space', ...)

asyncio.run(main())
```

## Configuration

```python
from octospaces_sdk import configure_octo_spaces, OctoSpacesConfig

configure_octo_spaces(OctoSpacesConfig(
    sync_base="https://sync.example.com",   # required
    sync_namespace="ns",                    # optional namespace prefix
    shared_spaces_namespace="shared",       # optional shared spaces namespace
))
```

## KV Adapter

The SDK stores credentials and caches in a pluggable KV store:

```python
from octospaces_sdk import configure_kv, MemoryKvAdapter, FileKvAdapter

configure_kv(MemoryKvAdapter())                   # in-memory (testing)
configure_kv(FileKvAdapter("/tmp/octo.json"))     # JSON file (development)
# Implement KvAdapter Protocol for production (Redis, SQLite, etc.)
```

## Parity notes

This package mirrors `@drakkar.software/octospaces-sdk` v0.4.3. Known divergences:

| Feature | TypeScript | Python |
|---|---|---|
| `slugify` (accented chars) | Strips non-ASCII (é → '') | Normalises NFD first (é → e) |
| `userId` derivation | `sha256(edPub)[0:16].hex()` via WebCrypto (async) | Same algorithm (sync via `hashlib`) |
| Account-seal `ct` encoding | hex (`iv‖ciphertext`) | hex (`iv‖ciphertext`) — same ✓ |
| Web/RN shims | `platform/*`, AsyncStorage, passkeys | Not ported — use `KvAdapter` instead |

## Cross-language test vectors

Shared JSON fixtures live at `octospaces/tests/test-vectors/` and are consumed by both this package (pytest) and the TypeScript SDK (vitest). See `tests/test-vectors/_generators/README.md` for regeneration instructions.

## Development

Requires the `satellite` monorepo checked out as a sibling (for editable starfish deps):

```sh
# ├── octospaces/
# └── satellite/       ← sibling checkout
cd packages/python/octospaces-sdk
uv sync --dev
uv run pytest -v
```
