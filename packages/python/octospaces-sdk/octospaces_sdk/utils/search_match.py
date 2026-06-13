"""Pure title matcher + ranker for Quick Find / Search.

Mirrors ``packages/ts/octospaces-sdk/src/utils/search-match.ts`` exactly,
including the exact tier base constants and penalty formulas, so the two
implementations produce identical scores and match ranges.

Relevance is tiered, strongest first:

1. PREFIX      — the title starts with the query ("not" → "Notes").
2. WORD        — some word starts with the query ("pa" → "New page").
3. SUBSTRING   — the query appears mid-word ("page" → "Homepage").
4. FUZZY       — the query is a subsequence ("rdm" → "Roadmap").

Within a tier, earlier and tighter matches in shorter titles score higher.
Tier gaps (1000) exceed the max intra-tier penalty (≤900), so a fuzzy hit
can never outrank a real substring.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Any, TypeVar

# ── Tier bases (must match TS exactly) ────────────────────────────────────────

_TIER_PREFIX = 4000
_TIER_WORD = 3000
_TIER_SUBSTRING = 2000
_TIER_FUZZY = 1000


# ── Result types ──────────────────────────────────────────────────────────────


@dataclass
class MatchRange:
    """Half-open [start, end) span into the original title."""

    start: int
    end: int


@dataclass
class TitleMatch:
    score: int
    ranges: list[MatchRange]


T = TypeVar("T")


@dataclass
class RankedResult:
    item: Any
    score: int
    ranges: list[MatchRange]


# ── Core functions ─────────────────────────────────────────────────────────────


def fold(s: str) -> str:
    """Lowercase + strip diacritics WITHOUT changing length.

    Each Unicode code point maps to exactly one folded unit (NFD base char,
    first lowercase unit).  This PRESERVES STRING LENGTH so the returned
    ranges index straight into the ORIGINAL title.

    Mirrors the TS ``fold`` function which iterates UTF-16 units.  For BMP
    characters (code point < 0x10000) Python ``str`` and JS ``string`` have the
    same unit boundary, so the outputs are identical.
    """
    out: list[str] = []
    for ch in s:
        # NFD decompose → take the base character (first code point)
        nfd = unicodedata.normalize("NFD", ch)
        base = nfd[0]
        lower = base.lower()
        # Some locale-specific lowercasings expand (e.g. 'İ' → 'i̇'); keep unit 0
        out.append(lower[0] if len(lower) > 1 else lower)
    return "".join(out)


def is_word_start(folded: str, i: int) -> bool:
    """A word starts where the previous folded char is not alphanumeric."""
    if i == 0:
        return True
    return not (folded[i - 1].isalpha() or folded[i - 1].isdigit() or folded[i - 1] == "_") or not folded[i - 1].isascii() or not (folded[i - 1] >= "a" and folded[i - 1] <= "z" or folded[i - 1] >= "0" and folded[i - 1] <= "9")


# Simpler and matching TS: /[a-z0-9]/.test(folded[i-1])
def _is_alnum(c: str) -> bool:
    return ("a" <= c <= "z") or ("0" <= c <= "9")


def is_word_start(folded: str, i: int) -> bool:  # noqa: F811
    """Matches TS ``isWordStart``: a word starts where prev folded char is not [a-z0-9]."""
    if i == 0:
        return True
    return not _is_alnum(folded[i - 1])


def _start_penalty(i: int) -> int:
    return min(i * 8, 600)


def _length_penalty(title_len: int, query_len: int) -> int:
    return min(max(title_len - query_len, 0), 100)


def match_title(query: str, title: str) -> TitleMatch | None:
    """Match one title against a query.

    Returns ``None`` for an empty query or a miss.
    """
    q = fold(query.strip())
    if not q:
        return None
    t = fold(title)

    first = -1
    word_at = -1
    pos = t.find(q)
    while pos != -1:
        if first == -1:
            first = pos
        if is_word_start(t, pos):
            word_at = pos
            break
        pos = t.find(q, pos + 1)

    if first == 0:
        return TitleMatch(
            score=_TIER_PREFIX - _length_penalty(len(t), len(q)),
            ranges=[MatchRange(0, len(q))],
        )
    if word_at != -1:
        return TitleMatch(
            score=_TIER_WORD - _start_penalty(word_at) - _length_penalty(len(t), len(q)),
            ranges=[MatchRange(word_at, word_at + len(q))],
        )
    if first != -1:
        return TitleMatch(
            score=_TIER_SUBSTRING - _start_penalty(first) - _length_penalty(len(t), len(q)),
            ranges=[MatchRange(first, first + len(q))],
        )

    # Fuzzy subsequence (greedy left-to-right). Whitespace in the query is
    # skipped so "new pg" can still reach "New page". Adjacent hits merge into
    # one range so the highlight reads as runs, not confetti.
    import re as _re

    chars = _re.sub(r"\s+", "", q)
    if not chars:
        return None

    ranges: list[MatchRange] = []
    from_pos = 0
    for ch in chars:
        at = t.find(ch, from_pos)
        if at == -1:
            return None
        if ranges and ranges[-1].end == at:
            ranges[-1].end = at + 1
        else:
            ranges.append(MatchRange(at, at + 1))
        from_pos = at + 1

    first_hit = ranges[0].start
    spread = ranges[-1].end - first_hit - len(chars)
    score = (
        _TIER_FUZZY
        - min(spread * 8, 600)
        - min(first_hit * 2, 200)
        - _length_penalty(len(t), len(chars))
    )
    return TitleMatch(score=score, ranges=ranges)


def rank_results(
    query: str,
    items: list[Any],
    limit: int = 50,
) -> list[RankedResult]:
    """Rank a candidate list against a query.

    Each item must have ``title: str`` and ``updated_at: int`` (or ``updatedAt``).
    Sorts by score DESC then ``updatedAt`` DESC; caps at *limit*.
    """
    out: list[RankedResult] = []
    for item in items:
        title = item.get("title", "") if isinstance(item, dict) else getattr(item, "title", "")
        m = match_title(query, title)
        if m:
            out.append(RankedResult(item=item, score=m.score, ranges=m.ranges))

    def sort_key(r: RankedResult) -> tuple[int, int]:
        item = r.item
        if isinstance(item, dict):
            ts = item.get("updatedAt", item.get("updated_at", 0))
        else:
            ts = getattr(item, "updatedAt", getattr(item, "updated_at", 0))
        return (-r.score, -ts)

    out.sort(key=sort_key)
    return out[:limit]
