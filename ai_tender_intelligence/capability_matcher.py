"""Scoring a tender against what Vantage Africa actually sells.

THE PROFILE IS A FILE, NOT CODE. capability_profile.json holds the services,
their weights and the phrases that signal each. It was generated once from the
map already scoring every synced notice in the console, so the two agree on day
one; from here it is meant to be edited. Adding a term is a text change anybody
can make and review, which is the point -- a capability statement changes, and a
scoring model that needs a developer to follow it will not.

WEIGHTED, NOT COUNTED. Services do not contribute equally. A tender wanting MEL
and training is the core of this business; one wanting only proposal-writing
support is real work at the edge of it. The weights say so, and the denominator
is `_perfect_fit` rather than the sum of every weight -- matching the two
heaviest services scores 100%, because a tender does not have to want
everything the firm does to be a perfect fit for it.

SCORING IS DETERMINISTIC AND EXPLAINS ITSELF. Every score comes with the terms
that produced it. A score nobody can interrogate is a score nobody will trust
the second time it disagrees with them, and the terms are what let somebody fix
the profile instead of ignoring the number.
"""

from __future__ import annotations

import functools
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


#: Depth below which a service is a coincidence rather than a requirement.
#:
#: A service matching one or two of its forty terms is a tender that happens to
#: use a word, not a tender asking for the service. Set at a quarter because
#: that is roughly where a real requirement starts naming its own vocabulary --
#: an M&E assignment says baseline, indicator and framework, not just
#: "evaluation" once in a sentence about the fee.
MIN_DEPTH = 25

#: How much harder depth counts than breadth. Squared: a service matched half
#: as squarely contributes a quarter as much.
DEPTH_CURVE = 2.0

#: Highest score work the firm does not do may reach.
#:
#: Deliberately below `decline_below` (25), so an excluded tender always reads
#: Decline however many of the firm's words happen to appear in it. Kept as a
#: named constant because the relationship between the two numbers is the whole
#: point, and a bare 30 next to a threshold of 25 is how it broke.
EXCLUDED_CEILING = 20


def _expected_terms(length: int) -> int:
    """How many distinct terms a genuine match should show, given the text.

    THE MOST IMPORTANT FUNCTION HERE, AND THE ONE THAT WAS WRONG. Depth was
    measured against a fixed expectation of eight distinct terms, which was
    calibrated on a 4,400-character Terms of Reference. Run against the real
    pipeline -- 2,256 tenders, not one of which had a document attached -- it
    scored every single one below 12% and recommended declining all of them.
    "Monitoring and Evaluation (M&E) Specialist" matched three MEL terms and
    scored 8%.

    The error was treating term count as evidence of relevance when it is
    mostly evidence of length. A forty-character title cannot contain eight
    distinct terms however squarely it is about the work, so the expectation
    has to scale with what there is to match against.

    At the short end this converges on how the console's own `fit_score` has
    always behaved -- one clear term in a title is the whole tender -- while
    a full ToR still has to show real breadth to score.
    """
    if length < 300:      # a title, and nothing else
        return 1
    if length < 1_200:    # a published notice
        return 2
    if length < 6_000:    # a short ToR
        return 6
    return 8              # a full tender document


@dataclass
class ServiceMatch:
    """One capability the tender wants, and the evidence for saying so."""

    service: str
    weight: int
    #: 0-100 within this service alone -- how squarely the tender sits in it.
    score: int
    matched_terms: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "service": self.service,
            "weight": self.weight,
            "score": self.score,
            "matched_terms": self.matched_terms[:8],
        }


@dataclass
class CapabilityMatch:
    """The whole reading: a score, what matched, and why in one sentence."""

    score: int
    matched: list[ServiceMatch] = field(default_factory=list)
    reason: str = ""
    excluded: str | None = None

    @property
    def services(self) -> list[str]:
        """The services this tender genuinely wants.

        Filtered to those that actually scored, so a theme list and a training
        signal both mean "the tender asks for this" rather than "the word
        appeared". `matched` keeps the shallow ones: they are evidence worth
        showing on the page, just not worth naming as a theme.
        """
        return [match.service for match in self.matched if match.score >= MIN_DEPTH]

    def as_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "matched_capabilities": [match.as_dict() for match in self.matched],
            "reason": self.reason,
            "excluded": self.excluded,
        }


@functools.lru_cache(maxsize=1)
def profile() -> dict[str, Any]:
    """The capability profile, read once.

    A missing or malformed file is fatal and says so plainly. The alternative --
    defaulting to an empty profile -- would score every tender at zero and look
    exactly like a firm that matches nothing, which is a failure somebody would
    spend a day chasing.
    """
    from .config import CAPABILITY_PROFILE_PATH

    try:
        data = json.loads(CAPABILITY_PROFILE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as cause:
        raise RuntimeError(f"capability_profile.json is missing from {CAPABILITY_PROFILE_PATH.parent}") from cause
    except json.JSONDecodeError as cause:
        raise RuntimeError(f"capability_profile.json is not valid JSON: {cause}") from cause

    if not data.get("services"):
        raise RuntimeError("capability_profile.json has no `services` -- nothing to score against.")
    return data


def _perfect_fit() -> int:
    data = profile()
    fallback = max((service["weight"] for service in data["services"].values()), default=1) * 2
    return int(data.get("_perfect_fit") or fallback)


# Work this firm does not do, checked before anything else.
#
# These beat any consultancy keyword because the overlap is real and always runs
# the wrong way: "supply and installation of monitoring equipment" contains
# "monitoring", and "construction supervision consultant" contains "consultant".
# Both would otherwise score as MEL work.
_EXCLUSIONS: list[tuple[str, str]] = [
    (r"\b(civil works|construction (of|works|supervision)|road (works|construction)|building works)\b", "civil works"),
    (r"\b(supply (and|&) (installation|delivery)|procurement of (goods|equipment|vehicles)|equipment supply)\b", "goods supply"),
    (r"\b(borehole|drilling|electrical installation|plumbing|fencing|renovation works)\b", "works contract"),
    # "Installation and User Training on Laboratory Equipment" is a delivery
    # contract with a handover session attached, and it matched Training on the
    # word "training" alone. The training here is the vendor's, not a
    # capacity-development assignment.
    (r"\b(installation|commissioning|delivery)\s+(and|&)\s+(user\s+|operator\s+)?training\b", "goods supply"),
    (r"\b(user|operator|end.user)\s+training\s+(on|for)\s+(the\s+)?(equipment|machine|system|software licen)", "goods supply"),
    (r"\b(security guard|cleaning services|catering services|fumigation|landscaping)\b", "facilities services"),
    (r"\b(insurance broker|audit of financial statements|statutory audit)\b", "regulated financial service"),
]


def excluded_as(text: str) -> str | None:
    """What kind of work this is, when it is work the firm does not do."""
    lowered = text.lower()
    for pattern, label in _EXCLUSIONS:
        if re.search(pattern, lowered):
            return label
    return None


def _count(term: str, haystack: str) -> int:
    """Occurrences of a profile term.

    Terms with a trailing space or a bracket -- "mel ", "(mel)" -- are matched
    literally, because that punctuation is doing the work of a word boundary
    that `\\b` cannot: `\\bm&e\\b` does not match "m&e," in most engines, and
    "mel" without the space matches "melbourne" and "development".
    """
    if term != term.strip() or not term.replace("&", "").replace("+", "").replace("-", "").strip().isalnum():
        return haystack.count(term)
    return len(re.findall(rf"\b{re.escape(term)}\b", haystack))


def match(text: str, *, title: str = "") -> CapabilityMatch:
    """Score one tender against the profile.

    The title counts three times. It is the one line the buyer wrote to say what
    the assignment is, and a tender titled "Development of a MEL Framework" is
    about MEL however many times the annexes mention procurement.
    """
    haystack = f"{(title + ' ') * 3}\n{text}".lower()
    if not haystack.strip():
        return CapabilityMatch(score=0, reason="There is no text to score.")

    exclusion = excluded_as(haystack)
    expected = _expected_terms(len(haystack))

    matches: list[ServiceMatch] = []
    for service, spec in profile()["services"].items():
        hits = [(term, _count(term.lower(), haystack)) for term in spec["terms"]]
        found = [(term, count) for term, count in hits if count > 0]
        if not found:
            continue

        # Distinct terms, not total mentions. A tender saying "evaluation"
        # forty times is one signal repeated; one saying evaluation, baseline,
        # indicator and logframe is four independent ones, and the second is the
        # better evidence that this is genuinely MEL work.
        #
        # Measured against what this much text could reasonably show, never
        # against a fixed number -- see _expected_terms.
        distinct = len(found)
        depth = min(100, int(round(100 * distinct / max(1, min(expected, len(spec["terms"]))))))
        matches.append(
            ServiceMatch(
                service=service,
                weight=int(spec["weight"]),
                score=depth,
                matched_terms=[term.strip() for term, _ in sorted(found, key=lambda pair: -pair[1])],
            )
        )

    matches.sort(key=lambda item: (item.weight * item.score, item.weight), reverse=True)

    # Each service contributes its weight scaled by how squarely the tender sits
    # in it. Two rules govern that scaling, and both exist because the first
    # version of this scored a resource-mobilisation tender at 100%:
    #
    # 1. Below MIN_DEPTH a service contributes nothing. One stray "evaluation"
    #    in a fundraising tender is not an M&E requirement, and counting it as a
    #    twelfth of one is how five incidental mentions add up to a perfect fit.
    # 2. The scaling is super-linear, so depth is worth more than breadth. A
    #    tender squarely in one heavy service should outrank one brushing five,
    #    because the first is work this firm does and the second is a tender
    #    that happens to use its vocabulary.
    earned = sum(
        item.weight * (item.score / 100) ** DEPTH_CURVE
        for item in matches
        if item.score >= MIN_DEPTH
    )
    score = min(100, int(round(100 * earned / _perfect_fit())))

    if exclusion:
        # Capped, not zeroed. "Construction supervision" with an M&E component
        # is genuinely a partial fit, and a hard zero would hide it entirely
        # rather than sending it down the ranking where somebody can still look.
        #
        # The cap must sit BELOW `decline_below`, or the recommendation
        # contradicts the exclusion. It was 30 against a threshold of 25, which
        # made a road-construction tender read "Consider" the moment the
        # scoring got more generous.
        score = min(score, EXCLUDED_CEILING)

    return CapabilityMatch(
        score=score,
        matched=matches,
        reason=_reason(matches, score, exclusion),
        excluded=exclusion,
    )


def _reason(matches: list[ServiceMatch], score: int, exclusion: str | None) -> str:
    """One sentence naming what decided the score.

    Written from the evidence rather than from the number, so it stays true when
    the weights are tuned.
    """
    if exclusion:
        top = matches[0].service if matches else "nothing in the statement"
        return (
            f"Reads as {exclusion}, which this firm does not bid. "
            f"Scored down despite signals for {top}."
        )
    strong = [item for item in matches if item.score >= MIN_DEPTH]
    if not strong:
        if matches:
            # Words appeared, but never enough of any one service's vocabulary
            # to be a requirement. Worth saying which, so somebody can judge
            # whether the profile is missing a term.
            brushed = ", ".join(item.service for item in matches[:3])
            return f"Only passing mentions of {brushed} -- nothing this tender actually asks for."
        return "Nothing in the capability statement appears in this tender."

    named = ", ".join(item.service for item in strong[:3])
    terms = ", ".join(dict.fromkeys(term for item in strong[:2] for term in item.matched_terms[:3]))
    verdict = "Squarely in scope" if score >= 60 else "Partly in scope" if score >= 25 else "Marginal"
    return f"{verdict}: matches {named}. Signals include {terms}."


def match_consultants(
    text: str,
    consultants: list[dict[str, Any]],
    *,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Who on the roster fits this assignment.

    `task_fit` is weighted highest for the same reason the drafter weights it:
    it is written in the language of the work rather than of the person, which
    is what a tender is written in too.
    """
    haystack = text.lower()
    if not haystack.strip():
        return []

    weights = {
        "task_fit": 3,
        "core_expertise": 3,
        "sectors": 2,
        "title": 2,
        "project_experience": 1,
        "countries": 1,
    }

    ranked: list[dict[str, Any]] = []
    for person in consultants:
        score = 0
        evidence: list[str] = []
        for field_name, weight in weights.items():
            value = str(person.get(field_name) or "").lower()
            for token in {part.strip() for part in re.split(r"[,;/|]", value) if len(part.strip()) > 3}:
                if token in haystack:
                    score += weight
                    evidence.append(token)
        if score:
            ranked.append(
                {
                    "id": person.get("id"),
                    "name": person.get("name"),
                    "title": person.get("title"),
                    "score": score,
                    "matched_on": list(dict.fromkeys(evidence))[:6],
                }
            )

    ranked.sort(key=lambda item: -item["score"])
    return ranked[:limit]
