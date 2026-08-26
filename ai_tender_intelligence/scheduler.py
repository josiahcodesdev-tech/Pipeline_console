"""The jobs, and the loop that runs them.

WHY A POLLING LOOP AND NOT A CRON DAEMON. The triggers this has to respond to --
a tender imported, a TOR uploaded, a bid marked Won -- are all database state
changes, and the database is the only thing that sees all of them. A webhook
from the console would miss the 05:00 sync; a cron entry would miss everything
between its ticks just the same. Polling for "tenders whose analysis is older
than the tender" catches all four triggers with one query and needs nothing
wired up on the other side.

The queries are written so a run does nothing when there is nothing to do: the
common case is one indexed lookup returning no rows, every fifteen minutes.

IDEMPOTENT BY CONSTRUCTION. `fetch_rfps_needing_analysis` returns a tender only
when it has no analysis, or one older than its last edit, or one from a
different model version. Running the loop twice in a row analyses nothing the
second time; changing MODEL_VERSION re-analyses everything, which is exactly
what a model change should do.

    python -m ai_tender_intelligence.scheduler          # run forever
    python -m ai_tender_intelligence.scheduler --once   # one pass and exit
    python -m ai_tender_intelligence.scheduler --backfill
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from dataclasses import dataclass
from typing import Any

from . import db, pdf_processor
from .bid_learning_model import PastBid, patterns_from
from .summary_generator import Intelligence, analyse_tender

log = logging.getLogger(__name__)


@dataclass
class RunReport:
    """What one pass did. Returned by the API so a manual run is legible."""

    documents_read: int = 0
    tenders_analysed: int = 0
    lessons_recorded: int = 0
    failures: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.failures is None:
            self.failures = []

    def as_dict(self) -> dict[str, Any]:
        return {
            "documents_read": self.documents_read,
            "tenders_analysed": self.tenders_analysed,
            "lessons_recorded": self.lessons_recorded,
            "failures": self.failures,
        }


# --------------------------------------------------------------- one tender


def analyse_rfp(rfp_id: str) -> Intelligence:
    """Analyse one tender and store the result.

    Loads the history on every call rather than caching it. The history is
    small -- tens of rows -- and a cache would mean the first analysis after a
    bid is marked Won still scores against a world where it never happened.
    """
    rfp = db.fetch_rfp(rfp_id)
    if rfp is None:
        raise LookupError(f"No tender with id {rfp_id}")

    intelligence = analyse_tender(
        rfp,
        documents=db.fetch_documents(rfp_id),
        consultants=db.fetch_consultants(),
        history=[PastBid.from_row(row) for row in db.fetch_history()],
    )
    db.save_analysis(rfp_id, intelligence.as_payload())
    return intelligence


# ------------------------------------------------------------------- passes


def read_pending_documents(limit: int = 25) -> tuple[int, list[str]]:
    """Extract text from attached files nobody has read.

    Runs before analysis in every pass, deliberately: a TOR uploaded five
    minutes ago should reach the analyser in the same run that notices it,
    rather than being read now and used in fifteen minutes.
    """
    read = 0
    failures: list[str] = []

    for document in db.fetch_documents_needing_text(limit):
        name = document.get("file_name") or document["file_path"]
        try:
            data = pdf_processor.download(str(document["file_path"]))
        except Exception as cause:  # noqa: BLE001 -- one bad file must not stop the pass
            failures.append(f"{name}: could not download ({cause})")
            continue

        extraction = pdf_processor.extract(data, file_name=str(name))
        summary = pdf_processor.summarise(extraction)

        if not extraction.usable:
            # Stored anyway. `ai_summary` then says why there is no text, which
            # is the difference between a document nobody has read and one that
            # cannot be read -- and only the second needs OCR.
            db.save_document_text(str(document["id"]), extraction.text, summary)
            failures.append(f"{name}: {extraction.status}")
            continue

        db.save_document_text(str(document["id"]), extraction.text, summary)
        read += 1

    return read, failures


def analyse_pending(limit: int = 25) -> tuple[int, list[str]]:
    """Analyse every tender whose reading is missing or stale."""
    analysed = 0
    failures: list[str] = []

    pending = db.fetch_rfps_needing_analysis(limit)
    if not pending:
        return 0, failures

    # Loaded once for the batch. The roster and the history are the same for
    # every tender in it, and the documents come back grouped from one query --
    # asking per tender is a round trip each, across whatever distance separates
    # this process from the database.
    consultants = db.fetch_consultants()
    history = [PastBid.from_row(row) for row in db.fetch_history()]
    documents = db.fetch_documents_for([str(rfp["id"]) for rfp in pending])

    # Collected, then written once. The analysis itself is milliseconds of CPU;
    # a round trip per row is what made a first run over two thousand tenders
    # take the better part of an hour.
    written: list[tuple[str, dict[str, Any]]] = []

    for rfp in pending:
        try:
            intelligence = analyse_tender(
                rfp,
                documents=documents.get(str(rfp["id"]), []),
                consultants=consultants,
                history=history,
            )
            written.append((str(rfp["id"]), intelligence.as_payload()))
        except Exception as cause:  # noqa: BLE001
            # One unreadable tender must not cost the batch. It is simply not
            # in `written`, so the next pass selects it again.
            log.exception("Analysis failed for %s", rfp.get("id"))
            failures.append(f"{str(rfp.get('title'))[:60]}: {cause}")

    analysed = db.save_analyses(written)
    return analysed, failures


def record_lessons(limit: int = 200) -> tuple[int, list[str]]:
    """Teach the model from bids that have been decided.

    Also the backfill: a console tracking bids for a year already holds this
    history, it has just never been written down in a form the model reads. The
    query returns only tenders with no lesson for their current outcome, so
    this is safe to run every pass and does nothing once it has caught up.
    """
    recorded = 0
    failures: list[str] = []

    for rfp in db.fetch_decided_rfps_without_lessons(limit):
        rfp_id = str(rfp["id"])
        try:
            # The patterns are taken from the stored analysis where there is
            # one, so the lesson records what the model believed at the time
            # rather than what it believes today. Re-deriving them would make
            # every past bid agree with the current profile, which is how a
            # model learns nothing from being wrong.
            analysis = db.latest_analysis(rfp_id)
            if analysis:
                capabilities = [
                    str(item.get("service"))
                    for item in (analysis.get("matched_capabilities") or [])
                    if item.get("service")
                ]
                keywords = list(analysis.get("keywords") or [])
                reading: dict[str, Any] = {}
            else:
                intelligence = analyse_tender(rfp, documents=db.fetch_documents(rfp_id))
                capabilities = intelligence.themes
                keywords = intelligence.keywords
                reading = intelligence.reading

            db.save_lesson(
                rfp_id,
                str(rfp["status"]),
                patterns_from(
                    title=str(rfp.get("title") or ""),
                    capabilities=capabilities,
                    keywords=keywords,
                    donor=reading.get("donor"),
                    sector=reading.get("sector"),
                    country=reading.get("location"),
                    value=rfp.get("value"),
                ),
            )
            recorded += 1
        except Exception as cause:  # noqa: BLE001
            log.exception("Could not record the lesson for %s", rfp_id)
            failures.append(f"{str(rfp.get('title'))[:60]}: {cause}")

    return recorded, failures


def run_once(limit: int | None = None) -> RunReport:
    """One full pass: read files, learn from decisions, analyse tenders.

    In that order and it matters. Documents first so a TOR uploaded since the
    last pass is available to this one; lessons second so a bid marked Won this
    morning informs the analyses that follow it in the same run.
    """
    from .config import settings

    batch = limit or settings().batch_size
    report = RunReport()

    read, failures = read_pending_documents(batch)
    report.documents_read = read
    report.failures.extend(failures)

    recorded, failures = record_lessons()
    report.lessons_recorded = recorded
    report.failures.extend(failures)

    analysed, failures = analyse_pending(batch)
    report.tenders_analysed = analysed
    report.failures.extend(failures)

    return report


# --------------------------------------------------------------------- loop

_stop = False


def _handle_signal(signum: int, _frame: Any) -> None:
    global _stop  # noqa: PLW0603
    _stop = True
    log.info("Signal %s received; finishing the current pass and stopping.", signum)


def serve_forever() -> None:
    """Poll until told to stop.

    A failed pass logs and waits rather than exiting. This runs unattended, and
    a service that dies on the first transient connection error is a service
    that is down every time the database restarts.
    """
    from .config import settings

    interval = settings().interval_seconds
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    log.info("Tender intelligence loop started; every %ss.", interval)
    while not _stop:
        started = time.monotonic()
        try:
            report = run_once()
            if report.documents_read or report.tenders_analysed or report.lessons_recorded:
                log.info(
                    "Read %s document(s), recorded %s lesson(s), analysed %s tender(s).",
                    report.documents_read,
                    report.lessons_recorded,
                    report.tenders_analysed,
                )
            for failure in report.failures:
                log.warning("  %s", failure)
        except Exception:  # noqa: BLE001
            log.exception("Pass failed; retrying after the interval.")

        elapsed = time.monotonic() - started
        # Slept in slices so a stop signal is answered in a second rather than
        # at the end of a fifteen-minute wait.
        remaining = max(1.0, interval - elapsed)
        while remaining > 0 and not _stop:
            time.sleep(min(1.0, remaining))
            remaining -= 1.0

    log.info("Stopped.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vantage Africa tender intelligence jobs")
    parser.add_argument("--once", action="store_true", help="run a single pass and exit")
    parser.add_argument("--backfill", action="store_true", help="record lessons from every decided bid, then exit")
    parser.add_argument("--rfp", help="analyse one tender by id, then exit")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    healthy, detail = db.healthy()
    if not healthy:
        log.error("Cannot reach the database: %s", detail)
        return 2

    if args.rfp:
        intelligence = analyse_rfp(args.rfp)
        log.info("%s -- %s%%, %s", intelligence.priority, intelligence.score, intelligence.recommendation)
        log.info("%s", intelligence.summary)
        return 0

    if args.backfill:
        recorded, failures = record_lessons()
        log.info("Recorded %s lesson(s).", recorded)
        for failure in failures:
            log.warning("  %s", failure)
        return 0

    if args.once:
        report = run_once()
        log.info("%s", report.as_dict())
        return 0

    serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
