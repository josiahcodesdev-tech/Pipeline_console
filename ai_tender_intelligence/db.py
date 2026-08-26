"""The database, reached directly and written to narrowly.

WHY SQLALCHEMY CORE AND NOT THE ORM. This service owns three tables and reads
five it does not own. Mapping the five would mean a second, drifting definition
of a schema whose only authority is supabase/migrations/ -- and the first time
somebody adds a column there, the ORM model is wrong and nothing says so. Core
with reflection reads what is actually there.

WHAT THIS IS ALLOWED TO WRITE. `ai_analysis`, `bid_learning`, and the
`extracted_text` / `ai_summary` columns of `rfp_documents`. Nothing else, ever.
`rfps` in particular is written by people through the console and by the sync
every morning; a third writer on those rows is how a deadline somebody typed
gets overwritten by a machine. The tables this service owns have no write policy
for authenticated users at all, which is the same rule stated from the other
side.

CONNECTION. Session pooler, not the direct 5432 host: Supabase's direct host is
IPv6-only on most tiers and refuses connections from container networks with a
message about the host being unreachable, which reads as a firewall problem for
about an hour before anybody checks.
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

log = logging.getLogger(__name__)

_engine: Engine | None = None


def engine() -> Engine:
    """The connection pool, built once.

    `pool_pre_ping` because the pooler drops idle connections and the scheduler
    is idle by design between runs -- without it the first query after a quiet
    fifteen minutes fails with a closed connection, once, and then works.
    """
    global _engine  # noqa: PLW0603 -- one pool per process is the point
    if _engine is None:
        from .config import settings

        _engine = create_engine(
            settings().database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            connect_args={"connect_timeout": 15},
        )
    return _engine


@contextmanager
def connection() -> Iterator[Any]:
    """A transaction that commits on success and rolls back on anything else."""
    with engine().begin() as conn:
        yield conn


def healthy() -> tuple[bool, str]:
    """Whether the database answers, for /health. Never raises."""
    try:
        with engine().connect() as conn:
            conn.execute(text("select 1"))
        return True, "connected"
    except SQLAlchemyError as cause:
        return False, str(cause.__cause__ or cause)[:200]


# --------------------------------------------------------------------- reads

#: The columns of `rfps` this service reads. Named rather than `select *` so a
#: new column in the console cannot silently change what the analyser sees.
_RFP_COLUMNS = """
  r.id, r.user_id, r.title, r.org, r.segment, r.status, r.deadline, r.value,
  r.link, r.notes, r.source, r.service_areas, r.fit_score, r.opportunity_type,
  r.notice_text, r.tender_text, r.tender_file_name, r.analysis, r.analysis_json,
  r.created_at, r.updated_at
"""


def fetch_rfp(rfp_id: str) -> dict[str, Any] | None:
    with engine().connect() as conn:
        row = conn.execute(
            text(f"select {_RFP_COLUMNS} from public.rfps r where r.id = :id"), {"id": rfp_id}
        ).mappings().first()
    return dict(row) if row else None


def fetch_rfps_needing_analysis(limit: int = 25) -> list[dict[str, Any]]:
    """Tenders with no analysis, or one older than the tender itself.

    The second half is what makes this idempotent *and* responsive: attaching a
    TOR bumps `rfps.updated_at`, so the tender falls back into this query and is
    re-read against the document that was not there the first time. Without it,
    the analysis of a tender would be frozen at whatever was known the day it
    was synced.
    """
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select {_RFP_COLUMNS}
                from public.rfps r
                left join lateral (
                  select a.created_at, a.model_version
                  from public.ai_analysis a
                  where a.rfp_id = r.id
                  order by a.created_at desc
                  limit 1
                ) latest on true
                where latest.created_at is null
                   or latest.created_at < r.updated_at
                   or latest.model_version is distinct from :model_version
                order by
                  case when r.deadline is null then 1 else 0 end,
                  r.deadline asc,
                  r.updated_at desc
                limit :limit
                """
            ),
            {"limit": limit, "model_version": _model_version()},
        ).mappings().all()
    return [dict(row) for row in rows]


def _model_version() -> str:
    from .config import MODEL_VERSION

    return MODEL_VERSION


def fetch_documents(rfp_id: str) -> list[dict[str, Any]]:
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, rfp_id, user_id, file_name, file_path, file_size, mime_type,
                       kind, extracted_text, ai_summary, uploaded_date, created_at
                from public.rfp_documents
                where rfp_id = :id
                order by created_at asc
                """
            ),
            {"id": rfp_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def fetch_documents_for(rfp_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Every attached file for a batch of tenders, in one round trip.

    The scheduler used to ask per tender, which is one query across the
    Atlantic for each of two thousand rows -- and in a database where no
    tender has a document yet, two thousand queries to be told nothing. One
    query, grouped here.
    """
    if not rfp_ids:
        return {}
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, rfp_id, user_id, file_name, file_path, file_size, mime_type,
                       kind, extracted_text, ai_summary, uploaded_date, created_at
                from public.rfp_documents
                where rfp_id = any(:ids)
                order by created_at asc
                """
            ),
            {"ids": rfp_ids},
        ).mappings().all()

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["rfp_id"]), []).append(dict(row))
    return grouped


def fetch_documents_needing_text(limit: int = 25) -> list[dict[str, Any]]:
    """Attached files nobody has read yet."""
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, rfp_id, file_name, file_path, mime_type
                from public.rfp_documents
                where coalesce(extracted_text, '') = '' and coalesce(file_path, '') <> ''
                order by created_at asc
                limit :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def fetch_consultants() -> list[dict[str, Any]]:
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, name, title, core_expertise, years_experience, sectors,
                       countries, qualifications, task_fit, project_experience,
                       languages, availability
                from public.consultants
                """
            )
        ).mappings().all()
    return [dict(row) for row in rows]


def fetch_history() -> list[dict[str, Any]]:
    """Every decided bid the model can learn from, with its tender's title."""
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                select b.rfp_id, b.outcome, b.learned_patterns, b.recorded_at, r.title
                from public.bid_learning b
                join public.rfps r on r.id = b.rfp_id
                order by b.recorded_at desc
                """
            )
        ).mappings().all()
    return [dict(row) for row in rows]


def fetch_decided_rfps_without_lessons(limit: int = 200) -> list[dict[str, Any]]:
    """Won and Lost tenders that have taught the model nothing yet.

    The backfill path. A console that has been tracking bids for a year already
    holds the history this model needs; it just never wrote it down in a form
    the model reads.
    """
    with engine().connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select {_RFP_COLUMNS}
                from public.rfps r
                where r.status in ('Won', 'Lost')
                  and not exists (
                    select 1 from public.bid_learning b
                    where b.rfp_id = r.id and b.outcome = r.status
                  )
                order by r.status_updated_on desc nulls last
                limit :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def latest_analysis(rfp_id: str) -> dict[str, Any] | None:
    with engine().connect() as conn:
        row = conn.execute(
            text(
                """
                select * from public.ai_analysis
                where rfp_id = :id order by created_at desc limit 1
                """
            ),
            {"id": rfp_id},
        ).mappings().first()
    return dict(row) if row else None


# -------------------------------------------------------------------- writes


def _js(value: Any) -> str:
    """JSON for a jsonb parameter.

    Serialised here rather than handed over as a Python object: psycopg would
    adapt a dict to a Postgres composite type, not to jsonb, and the error that
    produces names neither.
    """
    return json.dumps(value, default=str)


def save_analysis(rfp_id: str, payload: dict[str, Any]) -> str:
    """Insert one analysis. Always an insert -- see the migration for why."""
    with connection() as conn:
        row = conn.execute(
            text(_INSERT_ANALYSIS + " returning id"), _analysis_params(rfp_id, payload)
        ).first()
    return str(row[0])


#: The insert, shared by the single and batch paths so they cannot diverge.
_INSERT_ANALYSIS = """
insert into public.ai_analysis (
  rfp_id, summary, score, win_probability, recommendation,
  keywords, themes, matched_capabilities, requirements, risks,
  missing_information, similar_bids, reasons,
  model_version, source_kind
) values (
  :rfp_id, :summary, :score, :win_probability, :recommendation,
  cast(:keywords as jsonb), cast(:themes as jsonb),
  cast(:matched_capabilities as jsonb), cast(:requirements as jsonb),
  cast(:risks as jsonb), cast(:missing_information as jsonb),
  cast(:similar_bids as jsonb), cast(:reasons as jsonb),
  :model_version, :source_kind
)
"""


def _analysis_params(rfp_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "rfp_id": rfp_id,
        "summary": payload.get("summary", ""),
        "score": int(payload.get("score", 0)),
        "win_probability": int(payload.get("win_probability", 0)),
        "recommendation": payload.get("recommendation", ""),
        "keywords": _js(payload.get("keywords", [])),
        "themes": _js(payload.get("themes", [])),
        "matched_capabilities": _js(payload.get("matched_capabilities", [])),
        "requirements": _js(payload.get("requirements", [])),
        "risks": _js(payload.get("risks", [])),
        "missing_information": _js(payload.get("missing_information", [])),
        "similar_bids": _js(payload.get("similar_bids", [])),
        "reasons": _js(payload.get("reasons", [])),
        "model_version": payload.get("model_version", ""),
        "source_kind": payload.get("source_kind", ""),
    }


def save_analyses(rows: list[tuple[str, dict[str, Any]]]) -> int:
    """Insert a whole batch in one statement.

    One round trip instead of one per tender. On a first run over two thousand
    tenders against a database an ocean away, that is the difference between
    fifty minutes and five -- the analysis itself is pure CPU and takes
    milliseconds; the waiting was all network.

    One transaction, so a batch is all-or-nothing. That is the right granularity
    here: the scheduler re-selects anything without a current analysis, so a
    rolled-back batch is simply picked up again rather than half-written.
    """
    if not rows:
        return 0
    with connection() as conn:
        conn.execute(
            text(_INSERT_ANALYSIS),
            [_analysis_params(rfp_id, payload) for rfp_id, payload in rows],
        )
    return len(rows)


def save_lesson(rfp_id: str, outcome: str, patterns: dict[str, Any], note: str = "") -> None:
    """Record what a decided bid taught, once.

    `on conflict do update` rather than `do nothing`: re-running the learner
    after the capability profile changes should refresh what the bid taught,
    and the unique constraint is there to stop one tender getting ten votes, not
    to freeze the first answer forever.
    """
    with connection() as conn:
        conn.execute(
            text(
                """
                insert into public.bid_learning (rfp_id, outcome, learned_patterns, note)
                values (:rfp_id, :outcome, cast(:patterns as jsonb), :note)
                on conflict (rfp_id, outcome) do update
                  set learned_patterns = excluded.learned_patterns,
                      note = case when excluded.note <> '' then excluded.note else public.bid_learning.note end
                """
            ),
            {"rfp_id": rfp_id, "outcome": outcome, "patterns": _js(patterns), "note": note},
        )


def save_document_text(document_id: str, extracted_text: str, ai_summary: str) -> None:
    """Write back what a file turned out to contain."""
    with connection() as conn:
        conn.execute(
            text(
                """
                update public.rfp_documents
                set extracted_text = :extracted_text, ai_summary = :ai_summary
                where id = :id
                """
            ),
            {"id": document_id, "extracted_text": extracted_text, "ai_summary": ai_summary},
        )


def now() -> datetime:
    return datetime.now(timezone.utc)
