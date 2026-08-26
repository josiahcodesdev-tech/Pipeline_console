"""Learning which tenders were worth bidding, from the ones already decided.

THE HONEST LIMIT, STATED FIRST. This is a firm with tens of decided bids, not
thousands. That is not enough data to train a classifier that generalises, and
anything presenting itself as one would be a confident number resting on
fifteen examples. So this is a nearest-neighbour model with an explicit
cold-start floor: it says which past bids a new tender resembles, whether those
were won or lost, and how sure it is -- and when there is too little history it
says so instead of producing a probability.

`confidence` is therefore as important as `win_probability`, and the console
shows both. A 78% win probability from two similar bids is a coin toss with a
decimal point on it.

WHAT IT LEARNS FROM. `bid_learning` rows, written when a tender reaches Won or
Lost. Each holds the patterns as at the decision -- keywords, capabilities,
donor, sector, country, value band -- because `rfps` moves on afterwards and a
training row that silently relabels itself is worse than no training row.

HOW IT SCORES. Similarity to past outcomes, in two layers:

  1. Feature overlap -- shared capabilities, same donor, same sector, same
     country. Cheap, explainable, and available on day one.
  2. Embedding cosine, when sentence-transformers is installed. Catches "MEL
     framework development" resembling "baseline assessment and indicator
     design" where no shared keyword does.

Layer two refines layer one; it never replaces it. A model whose answer changes
depending on whether an optional download completed is a model nobody can
reason about.
"""

from __future__ import annotations

import functools
import logging

from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

log = logging.getLogger(__name__)

#: Below this many decided bids, the model reports insufficient history rather
#: than a probability. Five is not a statistical threshold -- it is the point
#: below which nobody should be shown a percentage at all.
MIN_HISTORY = 5

#: Neighbours considered. Small on purpose: with a few dozen decided bids, a
#: larger k just averages in tenders that resemble nothing.
NEIGHBOURS = 7


@dataclass
class PastBid:
    """One decided tender, as the model sees it."""

    rfp_id: str
    title: str
    outcome: str
    capabilities: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    donor: str | None = None
    sector: str | None = None
    country: str | None = None
    value_band: str | None = None

    @property
    def won(self) -> bool:
        return self.outcome == "Won"

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "PastBid":
        patterns = row.get("learned_patterns") or {}
        return cls(
            rfp_id=str(row.get("rfp_id") or ""),
            title=str(row.get("title") or patterns.get("title") or ""),
            outcome=str(row.get("outcome") or ""),
            capabilities=list(patterns.get("capabilities") or []),
            keywords=list(patterns.get("keywords") or []),
            donor=patterns.get("donor"),
            sector=patterns.get("sector"),
            country=patterns.get("country"),
            value_band=patterns.get("value_band"),
        )


@dataclass
class Neighbour:
    """A past bid that resembles the one being scored."""

    bid: PastBid
    similarity: float
    shared: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "rfp_id": self.bid.rfp_id,
            "title": self.bid.title,
            "outcome": self.bid.outcome,
            "similarity": round(self.similarity * 100),
            "shared": self.shared[:5],
        }


@dataclass
class Opportunity:
    """The model's answer, with everything needed to argue with it."""

    win_probability: int
    confidence: str
    recommendation: str
    reasons: list[str] = field(default_factory=list)
    similar_bids: list[Neighbour] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "win_probability": self.win_probability,
            "confidence": self.confidence,
            "recommendation": self.recommendation,
            "reasons": self.reasons,
            "similar_bids": [item.as_dict() for item in self.similar_bids],
        }


# ------------------------------------------------------------------ features


def value_band(value: float | None) -> str | None:
    """Contract value as a band, because the exact figure never repeats.

    Bands let "a bid like this one" mean something across tenders whose values
    differ by a few thousand, which is the only way value can inform a model
    this size.
    """
    if value is None:
        return None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    thresholds = [(25_000, "under 25k"), (100_000, "25k-100k"), (500_000, "100k-500k"), (2_000_000, "500k-2m")]
    for ceiling, label in thresholds:
        if amount < ceiling:
            return label
    return "over 2m"


def patterns_from(
    *,
    title: str,
    capabilities: Sequence[str],
    keywords: Sequence[str],
    donor: str | None,
    sector: str | None,
    country: str | None,
    value: float | None,
) -> dict[str, Any]:
    """The record written to `bid_learning` when a bid is decided.

    Captured at the moment of decision rather than derived later, so a change to
    the capability profile next year does not retroactively rewrite what this
    bid taught.
    """
    return {
        "title": title,
        "capabilities": list(capabilities),
        "keywords": list(keywords)[:30],
        "donor": donor,
        "sector": sector,
        "country": country,
        "value_band": value_band(value),
    }


# ---------------------------------------------------------------- similarity


def _jaccard(left: Iterable[str], right: Iterable[str]) -> tuple[float, list[str]]:
    first = {item.lower().strip() for item in left if item and item.strip()}
    second = {item.lower().strip() for item in right if item and item.strip()}
    if not first or not second:
        return 0.0, []
    shared = first & second
    return len(shared) / len(first | second), sorted(shared)


@functools.lru_cache(maxsize=1)
def _embedder():
    from .nlp_engine import _embedder as load  # noqa: PLC0415 -- shared cache

    return load()


def _embedding_similarity(text: str, others: Sequence[str]) -> list[float]:
    """Cosine similarity of `text` to each of `others`, or zeros.

    Zeros rather than an exception when the model is unavailable: this layer
    refines the feature overlap and is not allowed to decide anything on its
    own, so its absence must be survivable.
    """
    model = _embedder()
    if model is None or not others:
        return [0.0] * len(others)
    try:
        vectors = model.encode([text, *others], normalize_embeddings=True)
    except Exception as cause:  # noqa: BLE001
        log.info("Embedding failed (%s); similarity is feature overlap only", cause)
        return [0.0] * len(others)
    head, rest = vectors[0], vectors[1:]
    return [float(sum(a * b for a, b in zip(head, row))) for row in rest]


def score_against_history(
    *,
    title: str,
    capabilities: Sequence[str],
    keywords: Sequence[str],
    donor: str | None,
    sector: str | None,
    country: str | None,
    history: Sequence[PastBid],
    capability_score: int,
) -> Opportunity:
    """How much this tender looks like the ones already won.

    `capability_score` is passed in rather than recomputed: the two answers are
    different questions -- "can we do this?" and "have we won things like it?" --
    and the recommendation needs both. A perfect capability match with a history
    of losing that exact kind of bid is worth knowing before somebody spends a
    week on it.
    """
    decided = [bid for bid in history if bid.outcome in {"Won", "Lost"}]

    if len(decided) < MIN_HISTORY:
        return _cold_start(capability_score, len(decided))

    texts = [f"{bid.title} {' '.join(bid.capabilities)} {' '.join(bid.keywords[:15])}" for bid in decided]
    semantic = _embedding_similarity(f"{title} {' '.join(capabilities)} {' '.join(keywords[:15])}", texts)

    neighbours: list[Neighbour] = []
    for bid, semantic_score in zip(decided, semantic):
        capability_overlap, shared_capabilities = _jaccard(capabilities, bid.capabilities)
        keyword_overlap, shared_keywords = _jaccard(keywords[:25], bid.keywords[:25])

        shared: list[str] = list(shared_capabilities)
        feature = 0.55 * capability_overlap + 0.25 * keyword_overlap
        if donor and bid.donor and donor.lower() == bid.donor.lower():
            feature += 0.10
            shared.append(f"donor: {donor}")
        if sector and bid.sector and sector.lower() == bid.sector.lower():
            feature += 0.06
            shared.append(f"sector: {sector}")
        if country and bid.country and country.lower() == bid.country.lower():
            feature += 0.04
            shared.append(f"country: {country}")

        # The embedding refines rather than replaces: at most a quarter of the
        # final similarity, so an unavailable model shifts the ranking a little
        # and never inverts it.
        combined = min(1.0, 0.75 * min(1.0, feature) + 0.25 * max(0.0, semantic_score))
        if combined > 0.05:
            neighbours.append(Neighbour(bid=bid, similarity=combined, shared=shared + shared_keywords[:3]))

    neighbours.sort(key=lambda item: -item.similarity)
    top = neighbours[:NEIGHBOURS]

    if not top:
        return Opportunity(
            win_probability=0,
            confidence="low",
            recommendation=_recommend(0, capability_score, "low"),
            reasons=[
                f"This resembles none of the {len(decided)} decided bids on record.",
                "The capability score below is the only evidence there is here.",
            ],
        )

    # Similarity-weighted vote, so a bid that closely resembles this one counts
    # for more than three that barely do.
    weight = sum(item.similarity for item in top)
    won_weight = sum(item.similarity for item in top if item.bid.won)
    raw = (won_weight / weight) if weight else 0.0

    # Shrunk towards the base rate by how little evidence there is. With two
    # neighbours the answer is mostly the firm's overall win rate; with seven it
    # is mostly the neighbours. This is what stops "1 similar bid, and we won
    # it" from reading as 100%.
    base = sum(1 for bid in decided if bid.won) / len(decided)
    strength = min(1.0, weight / (NEIGHBOURS * 0.5))
    probability = int(round(100 * (strength * raw + (1 - strength) * base)))

    confidence = "high" if len(top) >= 5 and weight >= 2.5 else "medium" if len(top) >= 3 else "low"

    return Opportunity(
        win_probability=probability,
        confidence=confidence,
        recommendation=_recommend(probability, capability_score, confidence, top),
        reasons=_reasons(top, probability, base, confidence, donor),
        similar_bids=top,
    )


def _cold_start(capability_score: int, decided: int) -> Opportunity:
    """No probability, and the reason why, when the history is too thin.

    A number here would be the firm's own base rate wearing a percentage sign,
    and it would be read as a prediction. Saying "not enough history" is the
    only honest output, and it names what would change that.
    """
    from .config import settings

    # Graded on capability alone rather than flattened to "Consider".
    #
    # With no decided bids on record -- which is where every installation starts
    # -- this branch answers for every tender in the pipeline. Returning the
    # same word for a 90% match and a 41% one throws away the only signal that
    # actually exists, and the reasons below already say what it rests on.
    if capability_score >= settings().pursue_at:
        recommendation = "Pursue"
    elif capability_score >= settings().decline_below:
        recommendation = "Consider"
    else:
        recommendation = "Decline"

    return Opportunity(
        win_probability=0,
        confidence="none",
        recommendation=recommendation,
        reasons=[
            f"Only {decided} decided bid{'s' if decided != 1 else ''} on record -- "
            f"at least {MIN_HISTORY} are needed before a win probability means anything.",
            "This recommendation rests on the capability match alone.",
            "Recording the outcome of past bids is what makes this number real.",
        ],
    )


#: Similarity above which a single past bid is worth heeding on its own.
#:
#: Not enough to compute a probability from -- that still needs MIN_HISTORY --
#: but enough that a near-identical loss should stop the model saying "Pursue".
NEAR_IDENTICAL = 0.7


def _recommend(
    probability: int,
    capability_score: int,
    confidence: str,
    top: Sequence[Neighbour] = (),
) -> str:
    """Advice, in one word the console renders as a badge.

    Capability leads. Whether the firm can do the work is a fact about the
    tender; whether it has won things like it is a fact about a small sample,
    and the fact should outrank the sample.

    THE EXCEPTION IS A NEAR-IDENTICAL LOSS. The low-confidence branch used to
    ignore the history entirely, which is right for a probability drawn from
    four vague resemblances and badly wrong for one drawn from a bid 75% like
    this one that the firm lost. A test recommended "Pursue" on exactly that,
    which is advice worth a wasted week. So a close loss with no closer win
    downgrades Pursue to Consider -- it does not invent a probability, it just
    declines to sound certain.
    """
    from .config import settings

    nearest = max(top, key=lambda item: item.similarity, default=None)
    close_loss = (
        nearest is not None
        and not nearest.bid.won
        and nearest.similarity >= NEAR_IDENTICAL
    )

    if capability_score < settings().decline_below:
        return "Decline"

    if confidence in {"none", "low"}:
        if capability_score >= settings().pursue_at:
            return "Consider" if close_loss else "Pursue"
        return "Consider"

    if capability_score >= settings().pursue_at and probability >= 50:
        return "Consider" if close_loss else "Pursue"
    if capability_score < settings().pursue_at and probability < 40:
        return "Decline"
    return "Consider"


def _reasons(
    top: list[Neighbour],
    probability: int,
    base: float,
    confidence: str,
    donor: str | None,
) -> list[str]:
    """Why, in sentences somebody can check against the record."""
    wins = [item for item in top if item.bid.won]
    losses = [item for item in top if not item.bid.won]
    reasons: list[str] = []

    if wins:
        titles = "; ".join(item.bid.title[:60] for item in wins[:3])
        reasons.append(f"Resembles {len(wins)} won bid{'s' if len(wins) != 1 else ''}: {titles}.")
    if losses:
        titles = "; ".join(item.bid.title[:60] for item in losses[:2])
        reasons.append(f"Also resembles {len(losses)} lost bid{'s' if len(losses) != 1 else ''}: {titles}.")

    if donor and any(item.bid.donor and item.bid.donor.lower() == donor.lower() for item in top):
        won_here = sum(1 for item in top if item.bid.won and item.bid.donor and item.bid.donor.lower() == donor.lower())
        reasons.append(f"Same funder as {won_here} past win{'s' if won_here != 1 else ''} ({donor}).")

    reasons.append(
        f"Firm's overall win rate on decided bids is {round(base * 100)}%; "
        f"this scores {probability}% with {confidence} confidence."
    )
    return reasons
