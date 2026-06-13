# Test Vector Generators

Deterministic Python scripts that produce the shared JSON fixtures in `tests/test-vectors/`.

## Usage

Run from the **octospaces repo root** (any Python ≥ 3.9 works — no external deps):

```sh
python3 tests/test-vectors/_generators/objects_tree.py
python3 tests/test-vectors/_generators/search_match.py
python3 tests/test-vectors/_generators/paths_and_ids.py
python3 tests/test-vectors/_generators/invite_links.py
```

Or regenerate everything at once:

```sh
for f in tests/test-vectors/_generators/*.py; do python3 "$f"; done
```

## Determinism guarantee

After regeneration, `git diff tests/test-vectors/*.json` should be empty — the
generators are fully deterministic (no `random`, no `time`). If a diff appears
it means an implementation changed; either update the implementation to match
or update the tests to reflect the intentional change.

## Files

| Generator | JSON output | What it covers |
|---|---|---|
| `objects_tree.py` | `objects-tree.json` | `build_tree`, `next_order`, `breadcrumbs`, `subtree_ids`, `add_object`, `patch_object` |
| `search_match.py` | `search-match.json` | `fold`, `is_word_start`, `match_title` (4 tiers), `rank_results` |
| `paths_and_ids.py` | `paths-scopes.json`, `user-id.json`, `room-slug.json`, `base64url.json` | path builders, cap scopes, userId derivation, room_slug (ASCII only), base64url roundtrip |
| `invite_links.py` | `invite-links.json` | `encode/decode_space_invite_link`, `encode/decode_node_invite_link` |

## Non-ASCII divergences

`room_slug` with accented characters (é, ü, etc.) differs between TS and Python:
- **Python** performs NFD normalisation before ASCII-stripping (so `é → e`, `ü → u`).
- **TS** does a simple lowercase + non-alnum strip (so `é → ''`, `ü → ''`).

Only ASCII inputs are included in the shared vector. Non-ASCII behaviour is
tested language-specifically in each package's own unit tests.

Similarly `fold("🐙notes").length` differs: Python counts codepoints (6),
JavaScript counts UTF-16 code units (7). The vector uses `"length_preserved": true`
to assert the *property* (output length == input length) in each language's terms.
