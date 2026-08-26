"""Getting readable text out of a TOR, and saying so when it cannot.

WHERE THE FILES ARE. In the `tenders` bucket in Supabase Storage, at
`<user_id>/<rfp_id>/<uuid>.pdf`, with a row in `rfp_documents` naming them. The
console uploads; this reads. Downloads use the service key over the storage
REST API, which is the only credential that can read a private bucket without a
user session.

THE FAILURE THAT MATTERS IS THE SILENT ONE. A scanned TOR -- a photocopy saved
as PDF -- yields a page count, a file size, and no text at all. PyMuPDF reports
that as an empty string, and an empty string flows onward into an analysis that
finds no deliverables, no criteria and no qualifications, and reports a tender
with nothing in it. So `extract` classifies the outcome rather than returning a
string: `text` for a real extraction, `scanned` when there are pages but no
words, `empty` when there is nothing at all. The scheduler routes `scanned`
files to the console's existing OCR path instead of pretending.
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

#: Below this many characters per page, a page is a picture of text rather than
#: text. Chosen from the shape of real documents: a genuine tender page runs to
#: well over a thousand characters, and a scanned one to a handful of stray
#: marks the parser mistakes for glyphs.
MIN_CHARS_PER_PAGE = 120

#: Enough for a long TOR with annexes; past this the analyser is reading
#: appendices of standard clauses that tell it nothing new.
MAX_CHARS = 400_000


@dataclass
class Extraction:
    """What came out of a document, and how much to trust it."""

    #: 'text', 'scanned', 'empty' or 'failed'.
    status: str
    text: str = ""
    pages: int = 0
    #: Present only when status is 'failed'.
    problem: str | None = None
    #: Headings found, in order -- a cheap table of contents for the console.
    outline: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.status == "text" and bool(self.text.strip())

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "text": self.text,
            "pages": self.pages,
            "problem": self.problem,
            "outline": self.outline,
        }


def extract(data: bytes, *, file_name: str = "") -> Extraction:
    """Read a PDF's text, preserving the line structure the analyser needs.

    Blocks in reading order rather than raw character order: a two-column
    tender page extracted character-by-character interleaves the columns into
    prose that parses as neither, and every heading-based extractor downstream
    then finds nothing.
    """
    if not data:
        return Extraction(status="empty", problem="The file is zero bytes.")

    if not data[:5].startswith(b"%PDF"):
        # Not a PDF. Text and markdown are common enough as attachments to be
        # worth handling rather than refusing.
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return Extraction(status="failed", problem=f"{file_name or 'The file'} is not a PDF and is not readable text.")
        return Extraction(status="text" if text.strip() else "empty", text=_tidy(text)[:MAX_CHARS], pages=1)

    # `pymupdf` is the current module name and `fitz` the legacy alias, which
    # still works and prints a deprecation warning on every import. Trying the
    # new name first keeps the log clean now and keeps this working when the
    # alias is removed.
    try:
        import pymupdf as fitz  # noqa: PLC0415 -- imported here so the rest works without it
    except ImportError:
        try:
            import fitz  # noqa: PLC0415
        except ImportError:
            return Extraction(
                status="failed",
                problem="PyMuPDF is not installed. pip install -r ai_tender_intelligence/requirements.txt",
            )

    try:
        with fitz.open(stream=io.BytesIO(data), filetype="pdf") as document:
            if document.needs_pass:
                return Extraction(status="failed", problem="The PDF is password-protected.")

            parts: list[str] = []
            outline: list[str] = []
            for page in document:
                blocks = page.get_text("blocks")
                # Sort by vertical then horizontal position: this is what keeps
                # a two-column layout readable.
                blocks.sort(key=lambda block: (round(block[1], 1), round(block[0], 1)))
                for block in blocks:
                    chunk = str(block[4]).strip()
                    if chunk:
                        parts.append(chunk)
            pages = document.page_count
            try:
                outline = [str(item[1]).strip() for item in document.get_toc() if str(item[1]).strip()][:60]
            except Exception:  # noqa: BLE001 -- a malformed outline is not a failure
                outline = []
    except Exception as cause:  # noqa: BLE001
        return Extraction(status="failed", problem=f"Could not read {file_name or 'the PDF'}: {cause}")

    text = _tidy("\n\n".join(parts))[:MAX_CHARS]

    if not text.strip():
        return Extraction(status="empty" if pages == 0 else "scanned", pages=pages, outline=outline)
    if pages and len(text) / pages < MIN_CHARS_PER_PAGE:
        # Some text, but far too little for the page count: a scan with a cover
        # sheet, or a document whose body is images. Reported as scanned so the
        # caller sends it for OCR rather than analysing three lines of header.
        return Extraction(status="scanned", text=text, pages=pages, outline=outline)

    return Extraction(status="text", text=text, pages=pages, outline=outline)


def _tidy(text: str) -> str:
    """Normalise whitespace without destroying paragraph structure.

    Paragraphs are what the section splitter reads; collapsing every newline
    would make the whole document one line and every heading invisible.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Page furniture: a line that is only a number is a page number, and it
    # arrives between every pair of paragraphs.
    text = re.sub(r"\n\s*\d{1,3}\s*\n", "\n", text)
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def classify(file_name: str, text: str = "") -> str:
    """What kind of document this is, for the `kind` column.

    Name first, because whoever saved it usually said. Content second, for the
    files named `document (3).pdf`.
    """
    # Separators normalised to spaces before matching. `\b` does not fire
    # between an underscore and a letter -- both are word characters -- so
    # `\btor\b` missed CARKAP_TOR.pdf, and underscore-separated names are the
    # common case rather than the exception.
    name = re.sub(r"[_\-.]+", " ", file_name.lower())
    rules: list[tuple[str, str]] = [
        (r"\b(tor|terms of reference)\b", "tor"),
        (r"\b(rfp|request for proposals?|itb|invitation to bid|rfq)\b", "rfp"),
        (r"\b(evaluation|scoring|criteria)\b", "evaluation"),
        (r"\b(annex|appendix|attachment|schedule)\b", "annex"),
    ]
    for pattern, kind in rules:
        if re.search(pattern, name):
            return kind

    head = text[:4000].lower()
    if re.search(r"\bterms of reference\b", head):
        return "tor"
    if re.search(r"\brequest for proposals?\b|\binvitation to bid\b", head):
        return "rfp"
    if re.search(r"\bevaluation criteria\b", head):
        return "evaluation"
    return "other"


# ------------------------------------------------------------------- storage


def download(file_path: str) -> bytes:
    """Pull one object out of the private `tenders` bucket.

    Over the storage REST API with the service key rather than through a client
    library: it is one authenticated GET, and a dependency that exists to build
    that URL is a dependency to keep updated for no gain.
    """
    from .config import settings

    config = settings()
    if not config.supabase_url or not config.supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to read tender documents from storage."
        )

    import httpx  # noqa: PLC0415

    url = f"{config.supabase_url.rstrip('/')}/storage/v1/object/{config.storage_bucket}/{file_path.lstrip('/')}"
    response = httpx.get(
        url,
        headers={
            "Authorization": f"Bearer {config.supabase_service_key}",
            "apikey": config.supabase_service_key,
        },
        timeout=60.0,
        follow_redirects=True,
    )
    if response.status_code == 404:
        raise FileNotFoundError(f"No object at {config.storage_bucket}/{file_path}")
    response.raise_for_status()
    return response.content


def summarise(extraction: Extraction, *, limit: int = 700) -> str:
    """A short description of the document, for `rfp_documents.ai_summary`.

    Extractive, not generative. It quotes the document's own opening and lists
    the sections it found, which is a description of the file rather than a
    claim about its contents -- and this row is read next to the file itself,
    where an invented gloss would be a liability.
    """
    if extraction.status == "scanned":
        return f"{extraction.pages}-page scanned document -- no machine-readable text. Needs OCR before it can be analysed."
    if extraction.status == "empty":
        return "The document contains no readable text."
    if extraction.status == "failed":
        return extraction.problem or "The document could not be read."

    from .nlp_engine import split_sections

    sections = [name for name, block in split_sections(extraction.text).items() if name != "preamble" and block.strip()]
    opening = re.sub(r"\s+", " ", extraction.text[:limit]).strip()

    parts = [f"{extraction.pages} page{'s' if extraction.pages != 1 else ''}."]
    if sections:
        parts.append("Sections found: " + ", ".join(sections) + ".")
    if opening:
        parts.append("Opens: " + opening + ("…" if len(extraction.text) > limit else ""))
    return " ".join(parts)
