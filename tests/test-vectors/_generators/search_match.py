"""Generate search-match.json — pure search/fold/rank logic vector.

Run from the octospaces repo root:
    python3 tests/test-vectors/_generators/search_match.py

Writes to:
    tests/test-vectors/search-match.json
"""

from __future__ import annotations

import json
import pathlib
import unicodedata


# ── Mirrors fold() in utils/search_match.py ──────────────────────────────────


def fold(s: str) -> str:
    """NFD-first-unit + lowercase-first-unit, preserves string length."""
    result: list[str] = []
    i = 0
    while i < len(s):
        cp = ord(s[i])
        # High surrogate — treat pair as one unit
        if 0xD800 <= cp <= 0xDBFF and i + 1 < len(s) and 0xDC00 <= ord(s[i + 1]) <= 0xDFFF:
            result.append(s[i])
            result.append(s[i + 1])
            i += 2
            continue
        nfd = unicodedata.normalize("NFD", s[i])
        first = nfd[0].lower()
        result.append(first)
        i += 1
    return "".join(result)


def main() -> None:
    fold_cases = [
        {"input": "Hello World", "expected": "hello world"},
        {"input": "café", "expected": "cafe", "note": "diacritic stripped"},
        {"input": "mañana", "expected": "manana"},
        {"input": "crêpe", "expected": "crepe", "note": "length preserved"},
        {"input": "NOTES", "expected": "notes"},
        # Emoji/surrogate note: Python len("🐙notes")=6 (codepoints), JS "🐙notes".length=7 (UTF-16).
        # The property 'fold(s).length == s.length' holds in BOTH languages.
        # We assert the property holds via 'length_preserved': true — each consumer
        # should assert fold(input).length == input.length in its own terms.
        {"input": "🐙notes", "length_preserved": True, "note": "surrogate pair — length preserved in both languages (property check only)"},
    ]

    # Verify fold cases are correct
    for c in fold_cases:
        inp = c["input"]
        result = fold(inp)
        if "expected" in c:
            assert result == c["expected"], f"fold({inp!r}) = {result!r}, want {c['expected']!r}"
        if "expected_length" in c:
            assert len(result) == c["expected_length"], f"fold({inp!r}) length {len(result)}, want {c['expected_length']}"

    word_start_cases = [
        {"folded": "hello", "i": 0, "expected": True, "note": "position 0 always word start"},
        {"folded": "hello world", "i": 6, "expected": True, "note": "after space"},
        {"folded": "hello", "i": 2, "expected": False, "note": "mid-word"},
        {"folded": "hello-world", "i": 6, "expected": True, "note": "after dash"},
        {"folded": "hello.world", "i": 6, "expected": True, "note": "after dot"},
    ]

    match_title_cases = [
        {"query": "", "title": "Notes", "expected": None, "note": "empty query"},
        {"query": "xyz", "title": "Notes", "expected": None, "note": "miss"},
        {
            "query": "not", "title": "Notes",
            "min_score": 3900, "expected_ranges": [{"start": 0, "end": 3}],
            "tier": "PREFIX",
        },
        {
            "query": "pa", "title": "New page",
            "min_score": 2900, "max_score": 4000,
            "expected_range_start": 4,
            "tier": "WORD",
        },
        {
            "query": "page", "title": "Homepage",
            "min_score": 1900, "max_score": 3000,
            "tier": "SUBSTRING",
        },
        {
            "query": "rdm", "title": "Roadmap",
            "min_score": 900, "max_score": 2000,
            "tier": "FUZZY",
        },
        {"query": "NOTE", "title": "notes", "expected_match": True, "note": "case-insensitive"},
        {"query": "note", "title": "NOTES", "expected_match": True, "note": "case-insensitive"},
        {"query": "no", "title": "Notes", "tier": "PREFIX", "note": "prefix tier"},
    ]

    rank_cases = [
        {
            "query": "note",
            "items": [
                {"id": "1", "title": "Notebook"},
                {"id": "2", "title": "New Notes"},
                {"id": "3", "title": "Random"},
                {"id": "4", "title": "keynote"},
            ],
            "expected_top_id": "1",
            "note": "Notebook has prefix match; New Notes is WORD; keynote is SUBSTRING",
        },
        {
            "query": "pg",
            "items": [
                {"id": "1", "title": "Page"},
                {"id": "2", "title": "Programming"},
                {"id": "3", "title": "Unrelated"},
            ],
            "expected_match_ids": ["1", "2"],
            "note": "'pg' matches Page (PREFIX) and Programming (FUZZY)",
        },
    ]

    vectors = {
        "description": (
            "Cross-language vector for search-match utilities. "
            "fold (NFD-first-unit + lowercase), isWordStart, matchTitle tiers, rankResults. "
            "Both TS and Python must reproduce these outputs."
        ),
        "constants": {
            "PREFIX_SCORE_BASE": 4000,
            "WORD_SCORE_BASE": 3000,
            "SUBSTRING_SCORE_BASE": 2000,
            "FUZZY_SCORE_BASE": 1000,
        },
        "fold": fold_cases,
        "isWordStart": word_start_cases,
        "matchTitle": match_title_cases,
        "rankResults": rank_cases,
    }

    out_path = pathlib.Path(__file__).resolve().parents[1] / "search-match.json"
    out_path.write_text(json.dumps(vectors, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
