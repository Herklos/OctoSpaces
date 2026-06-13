"""Pytest configuration — resolve test-vector files relative to repo root."""
from __future__ import annotations

import pathlib

# Root of the octospaces monorepo (4 levels up from this file)
REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
VECTORS_DIR = REPO_ROOT / "tests" / "test-vectors"


def load_vector(name: str) -> dict:
    """Load a JSON vector file by basename (e.g. 'objects-tree.json')."""
    import json
    return json.loads((VECTORS_DIR / name).read_text())
