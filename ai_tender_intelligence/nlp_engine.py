"""Reading a tender: what it is about, what it asks for, what it leaves out.

WHAT THIS DOES AND WHAT IT REFUSES TO DO. It extracts facts the tender states
and reports the absence of the ones it does not. It never fills a gap with what
is typical -- an unstated budget is an unstated budget, and a service that
quietly answers "probably around USD 50,000" produces a bid nobody can defend.
Every extractor here returns None or an empty list rather than a plausible
value, and `missing_information` exists so those absences are shown rather than
skipped past.

WHY IT DEGRADES INSTEAD OF FAILING. spaCy needs a model downloaded separately;
sentence-transformers pulls ~90MB on first use. Both make this better and
neither is required: the deterministic layer -- phrase lists, section headings,
date patterns -- carries the extraction on its own, and the models add entity
recognition and semantic similarity on top. A service that will not start
without a download is a service nobody runs, so a missing model is reported in
`capabilities()` and worked around, not raised.
"""

from __future__ import annotations

import functools
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any, Iterable

log = logging.getLogger(__name__)


# --------------------------------------------------------------- optional deps


@functools.lru_cache(maxsize=1)
def _spacy_pipeline():
    """The spaCy pipeline, or None when the model is not installed.

    Cached because loading it costs a second or two and the scheduler analyses
    tenders in batches. Failure is logged once, at info: an operator who chose
    not to install the model does not need a warning on every tender.
    """
    from .config import settings

    try:
        import spacy  # noqa: PLC0415 -- optional, and slow to import
    except ImportError:
        log.info("spaCy is not installed; entity extraction is off")
        return None
    try:
        return spacy.load(settings().spacy_model, disable=["lemmatizer"])
    except OSError:
        log.info(
            "spaCy model %s is not downloaded; entity extraction is off. "
            "Install it with: python -m spacy download %s",
            settings().spacy_model,
            settings().spacy_model,
        )
        return None


@functools.lru_cache(maxsize=1)
def _embedder():
    """The sentence-transformer, or None when unavailable or switched off."""
    from .config import settings

    if not settings().use_embeddings:
        return None
    try:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415
    except ImportError:
        log.info("sentence-transformers is not installed; similarity is lexical only")
        return None
    try:
        return SentenceTransformer(settings().embedding_model)
    except Exception as cause:  # noqa: BLE001 -- a download failure, a disk full
        log.info("Could not load %s (%s); similarity is lexical only", settings().embedding_model, cause)
        return None


def capabilities() -> dict[str, bool]:
    """What this installation can actually do. Reported by the API's /health."""
    return {"spacy": _spacy_pipeline() is not None, "embeddings": _embedder() is not None}


# ------------------------------------------------------------------ the result


@dataclass
class TenderReading:
    """Everything the engine could establish, and what it could not.

    Fields are empty rather than guessed. `missing_information` names the
    absences worth acting on, which is the field a bid manager reads first.
    """

    sector: str | None = None
    service_areas: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    required_expertise: list[str] = field(default_factory=list)
    location: str | None = None
    donor: str | None = None
    client: str | None = None
    deadline: date | None = None
    evaluation_criteria: list[dict[str, Any]] = field(default_factory=list)
    deliverables: list[str] = field(default_factory=list)
    required_consultants: list[str] = field(default_factory=list)
    expected_outputs: list[str] = field(default_factory=list)
    duration_days: int | None = None
    budget: str | None = None
    missing_information: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["deadline"] = self.deadline.isoformat() if self.deadline else None
        return data


# ------------------------------------------------------------------- sections
#
# Tenders are written to a house style that barely varies across donors: a
# numbered heading, then the thing. Reading by heading beats reading by sentence
# because it tells you which list you are in -- deliverables and evaluation
# criteria look identical as bare bullets and mean entirely different things.

_SECTION_PATTERNS: dict[str, str] = {
    "background": r"background|introduction|context|about the (assignment|project)",
    "objectives": r"objectives?|purpose of the assignment|purpose",
    "scope": r"scope of work|scope|tasks|methodology|activities",
    "deliverables": r"deliverables?|expected outputs?|outputs?|expected deliverables",
    "qualifications": r"qualifications?|required (experience|expertise)|competenc|profile of the|consultant profile|team composition|key (personnel|experts?)",
    "evaluation": r"evaluation criteria|evaluation|selection criteria|award criteria|scoring",
    "submission": r"submission|how to apply|proposal submission|application",
    "duration": r"duration|timeframe|timeline|period of (performance|engagement)",
    "budget": r"budget|financial|fee|remuneration|payment",
}

# A heading is a short line. Numbered, bold, title-cased or all three -- the
# markdown the ingest step produces keeps the ** and the numbering, and both are
# stripped here rather than in nine separate patterns.
_HEADING = re.compile(r"^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*(?:\d+[.)]\s*)*([A-Za-z][^\n]{2,80}?)\s*:?\s*(?:\*\*)?\s*$")


def _clean(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("*", " ").replace("#", " ")).strip(" :-–—\t")


def split_sections(text: str) -> dict[str, str]:
    """Group the document under the headings this engine knows about.

    Everything before the first recognised heading lands under `preamble`,
    because the opening paragraphs of a tender are usually the background and
    are worth reading even when nobody labelled them.
    """
    sections: dict[str, list[str]] = {"preamble": []}
    current = "preamble"

    for raw in text.splitlines():
        line = raw.rstrip()
        heading = _HEADING.match(line)
        matched = None
        if heading and len(_clean(heading.group(1))) <= 80:
            label = _clean(heading.group(1)).lower()
            for name, pattern in _SECTION_PATTERNS.items():
                if re.search(pattern, label, re.I):
                    matched = name
                    break
        if matched:
            current = matched
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)

    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


# ---------------------------------------------------------------------- lists

_BULLET = re.compile(r"^\s*(?:[-*•–—]|\d+[.)]|[a-z][.)])\s+(.{3,300})$", re.I)


def bullets(block: str, limit: int = 25) -> list[str]:
    """The bulleted items in a block, in order, de-duplicated.

    Falls back to sentence splitting when a section is written as prose, which
    a third of them are -- a deliverables paragraph is still a list of
    deliverables, it just has commas where the bullets should be.
    """
    found: list[str] = []
    for raw in block.splitlines():
        match = _BULLET.match(raw)
        if not match:
            continue
        item = _clean(match.group(1))
        if item and item.lower() not in {existing.lower() for existing in found}:
            found.append(item)

    if not found and block.strip():
        for sentence in re.split(r"(?<=[.;])\s+", _clean(block)):
            item = sentence.strip()
            if 12 <= len(item) <= 300:
                found.append(item)

    return found[:limit]


# ---------------------------------------------------------------------- dates

_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_DATE_PATTERNS = [
    re.compile(rf"(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTHS})\.?,?\s+(\d{{4}})", re.I),
    re.compile(rf"({_MONTHS})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})", re.I),
    re.compile(r"(\d{4})-(\d{2})-(\d{2})"),
    re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})"),
]
_MONTH_INDEX = {name: number for number, name in enumerate(_MONTHS.split("|"), start=1)}


def find_deadline(text: str) -> date | None:
    """The submission deadline, where the document names one as such.

    Anchored on the words around it rather than on being the first date in the
    file. A tender is full of dates -- the publication date, the project start,
    the inception report -- and taking the first one produces a deadline that is
    confidently wrong, which is worse than none at all.
    """
    window = re.compile(
        r"(?:closing|deadline|submission|submit(?:ted)?|due|not later than|no later than|expires?)"
        r"[^.\n]{0,80}",
        re.I,
    )
    for chunk in window.findall(text):
        parsed = _first_date(chunk)
        if parsed:
            return parsed
    return None


def _first_date(chunk: str) -> date | None:
    for pattern in _DATE_PATTERNS:
        match = pattern.search(chunk)
        if not match:
            continue
        groups = match.groups()
        try:
            if pattern is _DATE_PATTERNS[0]:
                return date(int(groups[2]), _MONTH_INDEX[groups[1].lower()], int(groups[0]))
            if pattern is _DATE_PATTERNS[1]:
                return date(int(groups[2]), _MONTH_INDEX[groups[0].lower()], int(groups[1]))
            if pattern is _DATE_PATTERNS[2]:
                return date(int(groups[0]), int(groups[1]), int(groups[2]))
            # Ambiguous by construction. Tenders in this pipeline are European
            # and UN-sourced, where 05/09/2026 is September, so day-first is the
            # right guess -- and it is a guess, which is why an ISO date above
            # is preferred whenever the document offers one.
            return date(int(groups[2]), int(groups[1]), int(groups[0]))
        except (ValueError, KeyError):
            continue
    return None


# -------------------------------------------------------------------- numbers

_DURATION = re.compile(
    r"(\d{1,3})\s*(?:\(\w+\)\s*)?(working\s+days?|days?|weeks?|months?)"
    r"(?:[^.\n]{0,40}?(?:duration|assignment|consultancy|contract|engagement|period))?",
    re.I,
)
_MONEY = re.compile(
    r"(?:(USD|EUR|GBP|KES|US\$|\$|€|£)\s?([\d,]{3,15}(?:\.\d{2})?))"
    r"|(?:([\d,]{4,15})\s?(USD|EUR|GBP|KES))",
    re.I,
)


def find_duration_days(text: str) -> int | None:
    """Assignment length in days, only where the document states days.

    Weeks and months are deliberately not converted. "Three months" is a
    calendar window, "15 working days" is level of effort, and a service that
    turns the first into 90 has invented a number the tender never gave -- which
    then reaches a fee calculation as though somebody had checked it.
    """
    for match in _DURATION.finditer(text):
        amount, unit = int(match.group(1)), match.group(2).lower()
        if "day" in unit and 1 <= amount <= 400:
            return amount
    return None


def find_budget(text: str) -> str | None:
    """A stated budget or ceiling, verbatim, or None."""
    window = re.compile(r"(?:budget|ceiling|maximum|fee|contract value|estimated cost)[^.\n]{0,90}", re.I)
    for chunk in window.findall(text):
        money = _MONEY.search(chunk)
        if money:
            return _clean(chunk)[:180]
    return None


# ------------------------------------------------------------------- criteria

_CRITERION = re.compile(r"^(.{4,140}?)[\s.–—-]{0,6}\(?(\d{1,3})\s?(?:%|points?|marks?|pts)\)?\s*$", re.I)


def find_evaluation_criteria(block: str) -> list[dict[str, Any]]:
    """Scored criteria with their weights, where the tender publishes them.

    This is the most valuable thing in a tender and the most often skimmed. A
    70/30 technical-to-financial split says where the proposal's effort belongs;
    a 20% line for "experience with similar assignments" says which past work
    has to be named. Weights are kept as numbers so the console can sort by them.
    """
    criteria: list[dict[str, Any]] = []
    for item in bullets(block, limit=30):
        match = _CRITERION.match(item)
        if match:
            criteria.append({"criterion": _clean(match.group(1)), "weight": int(match.group(2))})
        elif len(item) > 8:
            criteria.append({"criterion": item, "weight": None})
    return criteria


# -------------------------------------------------------------------- people

_ROLE = re.compile(
    r"\b((?:international|national|lead|senior|junior|principal|key)\s+"
    r"(?:consultant|expert|specialist|adviser|advisor|evaluator|researcher|analyst)"
    r"|team\s+leader|project\s+manager|(?:m&e|mel|meal)\s+(?:specialist|expert|officer)"
    r"|(?:data|research|training|evaluation|gender|statistics?)\s+(?:specialist|expert|analyst|officer))\b",
    re.I,
)


def find_required_consultants(text: str) -> list[str]:
    """Roles the tender names, normalised for case and de-duplicated."""
    seen: dict[str, str] = {}
    for match in _ROLE.finditer(text):
        role = re.sub(r"\s+", " ", match.group(1)).strip().title()
        seen.setdefault(role.lower(), role)
    return list(seen.values())[:12]


_QUALIFICATION = re.compile(
    r"\b(master'?s?|bachelor'?s?|phd|doctorate|postgraduate|degree|diploma"
    r"|minimum of \d+ years?|at least \d+ years?|\d+\+? years?"
    r"|fluen\w+ in \w+|certifi\w+|accredit\w+|registration)\b",
    re.I,
)


def find_required_expertise(sections: dict[str, str], text: str) -> list[str]:
    """What a bidder must be or hold, from the qualifications section first."""
    block = sections.get("qualifications") or ""
    items = [item for item in bullets(block, limit=20) if len(item) > 8]
    if items:
        return items[:12]

    # No qualifications heading, so fall back to the sentences that read like
    # requirements anywhere in the document.
    found: list[str] = []
    for sentence in re.split(r"(?<=[.;])\s+", text):
        item = _clean(sentence)
        if 15 <= len(item) <= 260 and _QUALIFICATION.search(item):
            found.append(item)
        if len(found) >= 12:
            break
    return found


# ------------------------------------------------------------------- entities

_DONORS = [
    "World Bank", "African Development Bank", "AfDB", "UNDP", "UNICEF", "UNFPA",
    "UN Women", "UNESCO", "UNIDO", "WFP", "WHO", "FAO", "IOM", "UNHCR",
    "European Union", "USAID", "FCDO", "DFID", "GIZ", "SIDA", "NORAD", "DANIDA",
    "Global Fund", "Gavi", "Bill & Melinda Gates Foundation", "Ford Foundation",
    "Mastercard Foundation", "Rockefeller Foundation", "IFAD", "IFC", "JICA",
    "KOICA", "Irish Aid", "Global Affairs Canada", "SDC", "Enabel", "AFD",
]

_SECTORS = {
    "Health": ["health", "hiv", "tuberculosis", " tb ", "malaria", "nutrition", "immunisation", "immunization", "reproductive"],
    "Education": ["education", "school", "curriculum", "teacher", "learner", "literacy", "tvet"],
    "Governance / Development": ["governance", "public sector", "institutional", "civil society", "policy", "public financial management", "devolution", "county government", "ministry"],
    "Agriculture & Food Security": ["agricultur", "food security", "livestock", "smallholder", "irrigation", "value chain"],
    "Climate & Environment": ["climate", "environment", "biodiversity", "conservation", "resilience", "renewable"],
    "Water & Sanitation": ["wash", "water supply", "sanitation", "hygiene"],
    "Economic Development": ["livelihood", "enterprise", "msme", "financial inclusion", "employment", "economic growth", "trade"],
    "Humanitarian": ["humanitarian", "refugee", "displac", "emergency response"],
    "Gender & Inclusion": ["gender", "women empowerment", "disability", "inclusion", "protection"],
}


def find_donor(text: str, org: str = "", sections: dict[str, str] | None = None) -> str | None:
    """The funder, by weight of evidence rather than by list order.

    TWO RULES, BOTH LEARNED THE EXPENSIVE WAY on a World Vision tender funded by
    the Global Fund, which this confidently reported as European Union.

    1. The qualifications section is excluded. Tenders routinely ask for
       "experience working with Global Fund, USAID, European Union, UN agencies
       and bilateral donors" -- a list of every major funder, none of which is
       funding this. Reading donors out of it means the answer depends on
       whichever name happens to come first in `_DONORS`.

    2. Most-mentioned wins, not first-in-list. The real funder is named in the
       background and again in the contract terms; an incidental one is named
       once.
    """
    body = text[:30000]
    if sections:
        # Everything except the section that lists donors as a requirement.
        excluded = sections.get("qualifications") or ""
        if excluded:
            body = body.replace(excluded, " ")

    haystack = f"{org}\n{body}"
    counts: list[tuple[int, int, str]] = []
    for index, donor in enumerate(_DONORS):
        hits = len(re.findall(rf"\b{re.escape(donor)}\b", haystack, re.I))
        if hits:
            # Negative index as the tie-break keeps the list's own order stable
            # when two donors are mentioned equally often.
            counts.append((hits, -index, donor))

    if not counts:
        return None
    return max(counts)[2]


def find_sector(text: str) -> str | None:
    """The dominant sector, by weight of evidence rather than first mention."""
    lowered = text.lower()
    scores = {
        sector: sum(lowered.count(term) for term in terms)
        for sector, terms in _SECTORS.items()
    }
    best = max(scores, key=lambda name: scores[name]) if scores else None
    return best if best and scores[best] > 0 else None


_COUNTRIES = [
    "Kenya", "Uganda", "Tanzania", "Rwanda", "Burundi", "Ethiopia", "Somalia",
    "South Sudan", "Sudan", "Nigeria", "Ghana", "Sierra Leone", "Liberia",
    "Zambia", "Zimbabwe", "Malawi", "Mozambique", "Botswana", "Namibia",
    "South Africa", "Lesotho", "Eswatini", "Democratic Republic of the Congo",
    "Cameroon", "Senegal", "Mali", "Niger", "Burkina Faso", "Chad", "Egypt",
    "Morocco", "Tunisia", "Tajikistan", "Afghanistan", "Bangladesh", "Nepal",
    "Pakistan", "Yemen", "Jordan", "Lebanon", "Iraq", "Syria",
]


def find_location(text: str, fallback: str = "") -> str | None:
    """Where the work happens.

    The country list is checked before spaCy's GPE entities, because a model
    that has not been downloaded should not change the answer -- and because the
    entity recogniser reliably finds the country in "lessons from Rwanda" as
    well as the one in "duty station: Rwanda", with nothing to tell them apart.
    """
    haystack = text[:20000]
    hits = [country for country in _COUNTRIES if re.search(rf"\b{re.escape(country)}\b", haystack, re.I)]
    if hits:
        duty = re.search(r"(?:duty station|location|country|based in|place of (?:work|performance))\D{0,40}([A-Z][A-Za-z ]{3,30})", haystack)
        if duty:
            named = duty.group(1).strip()
            for country in hits:
                if country.lower() in named.lower():
                    return country
        return hits[0]

    pipeline = _spacy_pipeline()
    if pipeline:
        doc = pipeline(haystack[:5000])
        places = [entity.text.strip() for entity in doc.ents if entity.label_ == "GPE"]
        if places:
            return places[0]

    return fallback.strip() or None


# ------------------------------------------------------------------- keywords


def keywords(text: str, limit: int = 25) -> list[str]:
    """The terms that distinguish this tender from tenders in general.

    TF-IDF against the document's own paragraphs: a term that appears in every
    paragraph is the subject and a term that appears in a few is the detail, and
    it is the detail that makes one MEL assignment different from another. Falls
    back to frequency when the document is too short to have paragraphs worth
    comparing, which is most published notices.
    """
    paragraphs = [block for block in re.split(r"\n\s*\n", text) if len(block.strip()) > 60]

    if len(paragraphs) >= 4:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: PLC0415

            vectoriser = TfidfVectorizer(
                stop_words="english", ngram_range=(1, 3), max_features=4000, min_df=1
            )
            matrix = vectoriser.fit_transform(paragraphs)
            names = vectoriser.get_feature_names_out()
            scores = matrix.sum(axis=0).A1
            ranked = sorted(zip(names, scores), key=lambda pair: pair[1], reverse=True)
            picked = [term for term, _ in ranked if not term.isdigit()][:limit]
            if picked:
                return picked
        except ImportError:
            log.info("scikit-learn is not installed; keywords fall back to frequency")
        except ValueError:
            # An empty vocabulary after stop-word removal. Rare, and not worth
            # failing an analysis over.
            pass

    counts: dict[str, int] = {}
    for word in re.findall(r"[a-z][a-z-]{3,}", text.lower()):
        if word in _STOPWORDS:
            continue
        counts[word] = counts.get(word, 0) + 1
    return [word for word, _ in sorted(counts.items(), key=lambda pair: -pair[1])[:limit]]


_STOPWORDS = {
    "shall", "will", "must", "should", "the", "and", "for", "with", "that",
    "this", "from", "have", "been", "such", "which", "their", "other", "also",
    "any", "all", "may", "these", "those", "than", "then", "there", "where",
    "consultant", "consultancy", "proposal", "tender", "assignment", "including",
}


# ----------------------------------------------------------------- the engine


def analyse(
    *,
    title: str,
    description: str = "",
    documents: Iterable[str] = (),
    org: str = "",
    country: str = "",
) -> TenderReading:
    """Read a tender and report what it says.

    `documents` is the extracted text of any TOR or RFP attached to it. Those
    come after the notice on purpose: a notice announces that a tender exists
    and a TOR says what it is, so where both are present the TOR is the longer
    and more specific half of the same document and the section splitter should
    see it whole.
    """
    text = "\n\n".join(part for part in [title, description, *documents] if part and part.strip())
    if not text.strip():
        return TenderReading(missing_information=["Nothing to read: this tender has no notice text and no attached document."])

    sections = split_sections(text)
    reading = TenderReading()

    reading.keywords = keywords(text)
    reading.sector = find_sector(text)
    reading.donor = find_donor(text, org, sections)
    reading.client = org.strip() or None
    reading.location = find_location(text, country)
    reading.deadline = find_deadline(text)
    reading.duration_days = find_duration_days(text)
    reading.budget = find_budget(text)

    reading.deliverables = bullets(sections.get("deliverables", ""), limit=15)
    reading.expected_outputs = reading.deliverables[:]
    reading.evaluation_criteria = find_evaluation_criteria(sections.get("evaluation", ""))
    reading.required_expertise = find_required_expertise(sections, text)
    reading.required_consultants = find_required_consultants(text)

    # Themes and service areas are the capability matcher's answer, not this
    # engine's. Filled in by summary_generator so there is exactly one place
    # that decides what this firm calls a thing.

    reading.missing_information = _absences(reading, sections)
    return reading


def _absences(reading: TenderReading, sections: dict[str, str]) -> list[str]:
    """What the tender does not say, phrased as something to go and find out.

    Deliberately specific about consequence. "Budget not disclosed" is a fact;
    "budget not disclosed -- the fee basis cannot be checked before pricing" is
    the reason somebody should care, and it is the difference between a list
    that gets read and a list that gets scrolled past.
    """
    gaps: list[str] = []
    if not reading.deadline:
        gaps.append("No submission deadline found -- confirm it from the portal before planning the bid.")
    if not reading.budget:
        gaps.append("No budget or ceiling is disclosed -- the fee basis cannot be checked before pricing.")
    if not reading.evaluation_criteria:
        gaps.append("No evaluation criteria are published -- there is no way to tell where the proposal's effort should go.")
    if not reading.deliverables:
        gaps.append("No deliverables section was found -- the scope may be in an attachment that has not been read.")
    if not reading.duration_days:
        gaps.append("Assignment length is not stated in days -- level of effort is a guess until it is.")
    if not sections.get("qualifications"):
        gaps.append("No qualifications section was found -- eligibility cannot be checked against the roster.")
    return gaps
