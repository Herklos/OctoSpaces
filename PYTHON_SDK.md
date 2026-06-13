# Python `octospaces-sdk` — Design & Migration Plan

## Context

`@drakkar.software/octospaces-sdk` (TS, v0.4.3) is the headless "spaces core" — identity, registry, objects, sync plumbing — and is currently TypeScript-only. We want the same SDK usable from Python.

This is far cheaper than it looks because **the hard layer already exists in Python**. The SDK's crypto/transport peer deps (`@drakkar.software/starfish-{protocol,keyring,identities,sharing,client}`) are published from the `satellite` monorepo, which ships a **byte-for-byte conformant Python port** of that whole stack (`satellite/packages/python/*`, on PyPI as `starfish-protocol` / `starfish-keyring` / `starfish-identities` / `starfish-sharing` / `starfish-sdk`, currently `3.0.0a25`). Those packages already provide Argon2id root-identity derivation, device keys, keyring wrap/unwrap + encryptor, cap-cert minting/signing, request signing, member-cap minting, and `stable_stringify`. The drakkar_sync server they talk to is also Python (`Infra/sync/server/drakkar_sync`).

So the Python `octospaces-sdk` is a **thin orchestration port over existing Python packages**, exactly mirroring how the TS SDK orchestrates the TS starfish packages. Cross-language correctness is guaranteed the same way satellite already guarantees it: **shared JSON test vectors** consumed by both a TS (vitest) and a Python (pytest) suite.

### Key decisions
1. **Scope:** Functional parity, built in phases.
2. **Layout:** Restructure the octospaces monorepo to satellite's convention — `packages/ts/*` + `packages/python/*`.
3. **Shared tests:** Shared JSON vectors (satellite's pattern) at `octospaces/tests/test-vectors/`, consumed by both vitest and pytest.

### Reference implementations
- Cross-language vector mechanism: `satellite/tests/test-vectors/` + generators + consumers.
- Python tooling conventions: `satellite/packages/python/*/pyproject.toml` (setuptools + uv + pytest).
- Auth-header building: `Infra/sync/tests/utils/caps.py` (`cap_auth_headers`, `device_cap`, `member_cap`).
- Canonical wire schema: `Infra/sync/server/drakkar_sync/apps/octospaces/collections.py` + `apps/octovault/collections.py`.

---

## Phase 0 — Monorepo restructure (satellite layout)

Blast radius is small: in-repo consumers resolve the SDK by package name (`@drakkar.software/octospaces-sdk`), not path.

1. `git mv packages/octospaces-sdk packages/ts/octospaces-sdk`
2. `git mv packages/octospaces-ui packages/ts/octospaces-ui`
3. Edit `pnpm-workspace.yaml` globs → `packages/ts/*` and `apps/*`.
4. Create `packages/python/` (uv-managed, out of pnpm workspace).
5. Update `README.md` table link to `./packages/ts/octospaces-sdk`.
6. `pnpm install` to regenerate lockfile.

Verify: `pnpm -r build && pnpm -r test` green.

---

## Phase 1 — Python package skeleton

`packages/python/octospaces-sdk/` with:
- `pyproject.toml`: setuptools backend, dist `octospaces-sdk`, import `octospaces_sdk`, `requires-python=">=3.11"`, version `0.4.3`.
- Runtime deps: `starfish-protocol`, `starfish-keyring`, `starfish-identities`, `starfish-sharing`, `starfish-sdk` (all `>=3.0.0a25`), `cryptography>=41.0`, `argon2-cffi>=25.1.0`, `httpx>=0.25`.
- Dev deps: `pytest>=7`, `pytest-asyncio>=0.21`; `asyncio_mode="auto"`.
- `[tool.uv.sources]`: editable path deps to local satellite checkout for dev; falls back to PyPI in CI.

Module layout mirrors TS `src/`:
```
octospaces_sdk/
  __init__.py
  core/      ids.py  types.py  config.py  adapters.py  storage_types.py  space_access_error.py
  objects/   objects.py
  spaces/    registry.py  members.py  nodes.py  object_index.py
  sync/      paths.py  identity.py  client.py  account_seal.py  space_access.py
             space_access_store.py  pairing.py  base64.py  base64url.py
             pull_cache.py  profile_cache.py  fetch_timeout.py
  utils/     search_match.py  invite_preview.py  live_sync_bus.py
```

Web/RN host shims replaced by `core/adapters.py`: a `KvAdapter` Protocol + in-memory + file-backed implementations, injected via `configure_kv`.

---

## Phase 2 — Portable/deterministic core + first vectors

Pure modules (no crypto, no I/O) + JSON vectors at `tests/test-vectors/`:

| TS source | Python target | Vector file |
|---|---|---|
| `objects/objects.ts` | `objects/objects.py` | `objects-tree.json` |
| `utils/search-match.ts` | `utils/search_match.py` | `search-match.json` |
| `core/ids.ts` (`room_slug`) | `core/ids.py` | `room-slug.json` |
| `sync/paths.ts` (all path builders + scopes) | `sync/paths.py` | `paths-scopes.json` |
| `sync/base64*.ts` | `sync/base64.py`, `sync/base64url.py` | `base64url.json` |
| `utils/invite-preview.ts` | `utils/invite_preview.py` | `invite-preview.json` |
| invite link encode/decode in `members.ts`/`nodes.ts` | `spaces/members.py`, `spaces/nodes.py` | `invite-links.json` |
| `core/types.ts` | `core/types.py` (dataclasses/TypedDict) | — |

Key fidelity notes:
- `user_id_from_ed_pub = sha256(ed_pub_bytes)[:16].hex()` — exact crypto vector.
- `fold` preserves string length for match-range indexing; replicate NFD-first-unit + lowercase-first-unit.
- Invite-link fragments: assert by decode-and-compare (not byte-equal) due to JS vs Python key order.

---

## Phase 3 — Crypto / identity / transport layer

Orchestration over the Python starfish packages:

- `sync/identity.py` — `Session`, `derive_session`, `generate_seed_words`, `is_valid_seed`. Backed by `starfish_identities`.
- `sync/account_seal.py` — `seal_to_self/recipient`, `unseal_*`. ⚠ Outer `ct` is **hex** (`bytes_to_hex(iv‖ct)`), not keyring's base64 — octospaces-specific divergence that must interop with synced `_spaces` blobs.
- `sync/client.py` — `make_client`, `open_encryptor`, `owner_ensure_keyring`, profile R/W, `build_auth_headers` (`Authorization: Cap` + `X-Starfish-{Sig,Ts,Nonce}`). Transport via `starfish_sdk.StarfishClient`.
- `spaces/members.py`, `spaces/nodes.py` — invite/link flows, keyring recipient adds via `starfish_keyring` + `starfish_sharing`.
- `spaces/registry.py`, `spaces/object_index.py` — RMW with 3 retries on `ConflictError`, `create_space`.
- `sync/space_access.py`, `sync/space_access_store.py` — per-node resolver + cache.
- `sync/pairing.py` — PIN-sealed rendezvous via `starfish_identities`.

Wire: pull `{data,hash,timestamp}`, push body `{data,baseHash}` → `{hash,timestamp}`, batch `{collections:{…}}`.

---

## Phase 4 — Shared cross-language test harness (satellite pattern)

`octospaces/tests/test-vectors/` + `_generators/`:
- Deterministic Python generators: every key/nonce/IV derived from fixed seed → byte-for-byte reproducible.
- Python consumers: `packages/python/octospaces-sdk/tests/test_*.py`, resolve JSON via `pathlib` relative to repo root.
- TS consumers: `packages/ts/octospaces-sdk/src/**/*.vectors.test.ts`, import same JSON.
- Determinism: pure logic asserts exact values; crypto with randomness uses injected nonces/IVs + round-trip.

---

## Phase 5 — CI + docs

- `.github/workflows/ci.yml`: `typescript` job (`pnpm -r test`) + `python` job (uv, matrix 3.11/3.12/3.13, `uv run pytest`), both consuming `tests/test-vectors/`.
- `packages/python/octospaces-sdk/README.md`: install, `configure_kv`, `derive_session`, parity notes + divergences.
- Update root `README.md`.

---

## Critical files

**Create:**
- `packages/python/octospaces-sdk/pyproject.toml`, `uv.lock`, `octospaces_sdk/**`, `tests/test_*.py`
- `tests/test-vectors/*.json` + `_generators/*.py`
- `packages/ts/octospaces-sdk/src/**/*.vectors.test.ts`
- `.github/workflows/ci.yml`

**Move (Phase 0):** `packages/octospaces-sdk` → `packages/ts/octospaces-sdk`; `packages/octospaces-ui` → `packages/ts/octospaces-ui`.

**Edit:** `pnpm-workspace.yaml`, root `README.md`, `pnpm-lock.yaml` (regen).

---

## Verification

1. `pnpm -r build && pnpm -r test` green after Phase 0.
2. Re-running generators leaves `tests/test-vectors/*.json` unchanged.
3. `pnpm --filter @drakkar.software/octospaces-sdk test` green including vector tests.
4. `cd packages/python/octospaces-sdk && uv run pytest -v` green.
5. `user_id_from_ed_pub` of a fixed public key produces the same hex in both TS and Python.
6. CI both jobs pass on a PR.

Phasing: Phase 0→2 yields a usable, fully-conformance-tested pure core. Phases 3–5 add crypto/transport and CI.
