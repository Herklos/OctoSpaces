"""Cross-language conformance tests for utils/search_match.py.

Consumes tests/test-vectors/search-match.json.
"""
from __future__ import annotations

import pytest

from octospaces_sdk.utils.search_match import fold, is_word_start, match_title, rank_results

from .conftest import load_vector

V = load_vector("search-match.json")


# ── fold ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", V["fold"])
def test_fold(case):
    result = fold(case["input"])
    if "expected" in case:
        assert result == case["expected"], f"fold({case['input']!r}): got {result!r}"
    if case.get("length_preserved"):
        assert len(result) == len(case["input"]), (
            f"fold({case['input']!r}) length {len(result)}, want {len(case['input'])}"
        )


# ── isWordStart ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", V["isWordStart"])
def test_is_word_start(case):
    result = is_word_start(case["folded"], case["i"])
    assert result == case["expected"]


# ── matchTitle ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", V["matchTitle"])
def test_match_title(case):
    result = match_title(case["query"], case["title"])
    # Null-expected cases have "expected": null explicitly in the vector
    if "expected" in case and case["expected"] is None:
        assert result is None, f"matchTitle({case['query']!r}, {case['title']!r}) should be None"
        return
    # All other cases expect a match
    assert result is not None, (
        f"matchTitle({case['query']!r}, {case['title']!r}) should not be None"
    )
    if "min_score" in case:
        assert result.score >= case["min_score"], f"score {result.score} < min {case['min_score']}"
    if "max_score" in case:
        assert result.score < case["max_score"], f"score {result.score} >= max {case['max_score']}"
    if "expected_ranges" in case:
        ranges_dicts = [{"start": r.start, "end": r.end} for r in result.ranges]
        assert ranges_dicts == case["expected_ranges"]
    if "expected_range_start" in case:
        assert result.ranges[0].start == case["expected_range_start"]


# ── rankResults ───────────────────────────────────────────────────────────────


def test_rank_results_top_id():
    case = V["rankResults"][0]
    ranked = rank_results(case["query"], case["items"])
    assert len(ranked) > 0
    assert ranked[0].item["id"] == case["expected_top_id"]


def test_rank_results_matches():
    case = V["rankResults"][1]
    ranked = rank_results(case["query"], case["items"])
    matched_ids = {r.item["id"] for r in ranked}
    for expected_id in case["expected_match_ids"]:
        assert expected_id in matched_ids, f"Expected id {expected_id!r} in ranked results"
