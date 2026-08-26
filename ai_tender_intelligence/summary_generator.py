"""Turning a reading into the AI Opportunity Summary the console shows.

THIS WRITES NOTHING IT WAS NOT TOLD. The summary is assembled from the tender's
own words and the scores computed from them -- no language model, no generated
prose. That is a deliberate choice and not a limitation to fix later: this
paragraph sits at the top of a bid decision, and a fluent sentence that
smoothed over an unstated budget would be worse than the blunt one that says the
budget is unstated. Everything here can be traced to a field.

It is also the single place that composes the whole picture -- the NLP reading,
the capability match, the roster fit and the history model -- so there is one
answer to "what does the system think of this tender" rather than four that
disagree at the edges.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Sequence

from . import capability_matcher, nlp_engine
from .bid_learning_model import Opportunity, PastBid, score_against_history

log = logging.getLogger(__name__)


@dataclass
class Intelligence:
    """Everything the layer concluded about one tender."""

    summary: str
    score: int
    win_probability: int
    recommendation: str
    priority: str
    themes: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    matched_capabilities: list[dict[str, Any]] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    missing_information: list[str] = field(default_factory=list)
    similar_bids: list[dict[str, Any]] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    consultants: list[dict[str, Any]] = field(default_factory=list)
    reading: dict[str, Any] = field(default_factory=dict)
    source_kind: str = ""

    def as_payload(self) -> dict[str, Any]:
        """The shape `db.save_analysis` expects."""
        from .config import MODEL_VERSION

        return {
            "summary": self.summary,
            "score": self.score,
            "win_probability": self.win_probability,
            "recommendation": self.recommendation,
            "keywords": self.keywords,
            "themes": self.themes,
            "matched_capabilities": self.matched_capabilities,
            "requirements": self.requirements,
            "risks": self.risks,
            "missing_information": self.missing_information,
            "similar_bids": self.similar_bids,
            "reasons": self.reasons,
            "model_version": MODEL_VERSION,
            "source_kind": self.source_kind,
        }


def analyse_tender(
    rfp: dict[str, Any],
    *,
    documents: Sequence[dict[str, Any]] = (),
    consultants: Sequence[dict[str, Any]] = (),
    history: Sequence[PastBid] = (),
) -> Intelligence:
    """Read one tender and conclude what to do about it."""
    title = str(rfp.get("title") or "")
    document_texts = [str(doc.get("extracted_text") or "") for doc in documents if doc.get("extracted_text")]

    # Order matters: the notice says a tender exists, the TOR says what it is.
    # Both are given to the reader, longest and most specific last, so the
    # section splitter sees the TOR's headings rather than the notice's.
    notice = "\n\n".join(
        part for part in [str(rfp.get("notice_text") or ""), str(rfp.get("notes") or "")] if part.strip()
    )
    tender_text = str(rfp.get("tender_text") or "")
    body = "\n\n".join(part for part in [notice, tender_text, *document_texts] if part.strip())

    source_kind = _source_kind(notice, tender_text, document_texts)

    reading = nlp_engine.analyse(
        title=title,
        description=notice,
        documents=[tender_text, *document_texts],
        org=str(rfp.get("org") or ""),
        country="",
    )

    capability = capability_matcher.match(body, title=title)
    reading.service_areas = capability.services
    reading.themes = capability.services

    roster = capability_matcher.match_consultants(body, list(consultants))

    opportunity = score_against_history(
        title=title,
        capabilities=capability.services,
        keywords=reading.keywords,
        donor=reading.donor,
        sector=reading.sector,
        country=reading.location,
        history=list(history),
        capability_score=capability.score,
    )

    risks = _risks(reading, capability, roster, rfp)

    return Intelligence(
        summary=_summary(rfp, reading, capability, opportunity, source_kind),
        score=capability.score,
        win_probability=opportunity.win_probability,
        recommendation=opportunity.recommendation,
        priority=_priority(capability.score, opportunity),
        themes=capability.services,
        keywords=reading.keywords,
        matched_capabilities=[item.as_dict() for item in capability.matched],
        requirements=_requirements(reading),
        risks=risks,
        missing_information=reading.missing_information,
        similar_bids=[item.as_dict() for item in opportunity.similar_bids],
        reasons=[capability.reason, *opportunity.reasons],
        consultants=roster,
        reading=reading.as_dict(),
        source_kind=source_kind,
    )


def _source_kind(notice: str, tender_text: str, documents: Sequence[str]) -> str:
    """What the reading was actually built from.

    Recorded because it is the single biggest determinant of how much the rest
    of the analysis is worth, and because a reading from a two-line notice looks
    exactly as confident as one from a forty-page TOR.
    """
    has_document = bool(tender_text.strip()) or any(text.strip() for text in documents)
    has_notice = bool(notice.strip())
    if has_document and has_notice:
        return "notice+tor"
    if has_document:
        return "tor"
    return "notice" if has_notice else "title-only"


def _priority(score: int, opportunity: Opportunity) -> str:
    """The badge the console renders. Three states, deliberately."""
    if opportunity.recommendation == "Decline":
        return "LOW PRIORITY"
    if score >= 75 and opportunity.recommendation == "Pursue":
        return "HIGH PRIORITY BID"
    if score >= 50:
        return "WORTH REVIEWING"
    return "LOW PRIORITY"


def _requirements(reading: nlp_engine.TenderReading) -> list[str]:
    """The shortlist a bid manager reads first.

    Deliverables lead: they are what the contract buys. Expertise follows,
    because that is what decides whether the firm can staff it.
    """
    items: list[str] = []
    items.extend(reading.deliverables[:8])
    items.extend(item for item in reading.required_expertise[:6] if item not in items)
    return items[:12]


def _risks(
    reading: nlp_engine.TenderReading,
    capability: capability_matcher.CapabilityMatch,
    roster: list[dict[str, Any]],
    rfp: dict[str, Any],
) -> list[str]:
    """What would make this hard to win or hard to deliver.

    Each one is a fact plus its consequence. "Requires an international MEL
    specialist" is an observation; "requires an international MEL specialist and
    the roster names none" is a risk, and only the second is worth a line on a
    page somebody is skimming.
    """
    risks: list[str] = []

    if capability.excluded:
        risks.append(
            f"Reads as {capability.excluded}, which the firm does not bid -- confirm the scope before spending time on it."
        )

    international = [
        role for role in reading.required_consultants if role.lower().startswith("international")
    ]
    if international and not roster:
        risks.append(
            f"Asks for {international[0].lower()} and no one on the roster matched this scope -- a partner or an associate would be needed."
        )
    elif international:
        risks.append(f"Asks for {international[0].lower()} -- confirm availability before committing.")
    elif not roster:
        risks.append("No one on the consultant roster matched this scope -- staffing is unproven.")

    if not reading.budget:
        risks.append("Budget is not disclosed, so the fee cannot be sanity-checked before pricing.")

    if reading.duration_days and reading.duration_days <= 20 and len(reading.deliverables) >= 5:
        risks.append(
            f"{len(reading.deliverables)} deliverables in {reading.duration_days} working days -- the level of effort looks tight against the scope."
        )

    financial = [
        item for item in reading.evaluation_criteria
        if item.get("weight") and "financial" in str(item.get("criterion", "")).lower()
    ]
    if financial and financial[0]["weight"] >= 30:
        risks.append(
            f"Price carries {financial[0]['weight']}% of the score -- this will be won or lost on the fee as much as the method."
        )

    deadline = reading.deadline or rfp.get("deadline")
    if deadline is None:
        risks.append("No submission deadline could be established from the text -- confirm it on the portal.")

    return risks[:8]


def _summary(
    rfp: dict[str, Any],
    reading: nlp_engine.TenderReading,
    capability: capability_matcher.CapabilityMatch,
    opportunity: Opportunity,
    source_kind: str,
) -> str:
    """The paragraph shown at the top of the tender's AI tab.

    Assembled from established facts in a fixed order, so two tenders are
    comparable at a glance and an absence reads as an absence.
    """
    client = str(rfp.get("org") or "").strip() or "An unnamed buyer"
    title = str(rfp.get("title") or "this assignment").strip()

    lines: list[str] = []

    opening = f"{client} is seeking {title}."
    if reading.location:
        opening = opening[:-1] + f", in {reading.location}."
    lines.append(opening)

    if reading.donor and reading.donor.lower() not in client.lower():
        lines.append(f"Funded through {reading.donor}.")

    shape: list[str] = []
    if reading.duration_days:
        shape.append(f"{reading.duration_days} working days")
    if reading.deliverables:
        shape.append(f"{len(reading.deliverables)} deliverables")
    if reading.required_consultants:
        shape.append(reading.required_consultants[0].lower())
    if shape:
        lines.append("Scope: " + ", ".join(shape) + ".")

    if capability.services:
        lines.append(
            f"Matches {', '.join(capability.services[:3])} at {capability.score}%."
        )
    else:
        lines.append("Nothing in the capability statement appears in this tender.")

    if opportunity.confidence == "none":
        lines.append("There is not enough decided-bid history to estimate a win probability.")
    else:
        lines.append(
            f"Resembles past bids at {opportunity.win_probability}% ({opportunity.confidence} confidence)."
        )

    if source_kind in {"notice", "title-only"}:
        lines.append(
            "Read from the published notice only -- attach the Terms of Reference before relying on this."
        )

    return " ".join(lines)
