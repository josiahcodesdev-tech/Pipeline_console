"""The HTTP face of the intelligence layer.

WHAT THIS IS FOR, AND WHAT IT IS NOT. It is for running an analysis on demand --
from a terminal, from a deploy hook, from an operator who has just fixed a
capability term and wants to see the effect. It is not the path the console
reads through: the browser gets its analyses from Postgres with the Supabase
client it already holds, so a page load never depends on this process being up.
That is why `cors_origins` is empty by default and why nothing here is required
for the console to work.

AUTHENTICATION. A shared token in `AI_API_TOKEN`, checked on every route that
does anything. Not because a bearer token is good security, but because this
process holds a service-role database connection and a token is the difference
between "reachable only from localhost" and "reachable and harmless". Set it
before binding to anything but 127.0.0.1; the service refuses to start
otherwise.

    uvicorn ai_tender_intelligence.api:app --port 8099
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db, nlp_engine, pdf_processor, scheduler
from .config import MODEL_VERSION, settings

log = logging.getLogger(__name__)


# ------------------------------------------------------------------- schemas


class AnalyseRequest(BaseModel):
    tender_id: str = Field(..., description="The rfps.id of the tender to analyse")


class AnalyseResponse(BaseModel):
    """The contract the spec asked for, plus what it takes to act on it."""

    summary: str
    score: int
    matched_capabilities: list[dict[str, Any]]
    risks: list[str]
    recommendation: str
    # Beyond the requested shape, because a score without these is a number
    # nobody can act on or argue with.
    win_probability: int
    priority: str
    themes: list[str]
    requirements: list[str]
    missing_information: list[str]
    similar_bids: list[dict[str, Any]]
    consultants: list[dict[str, Any]]
    reasons: list[str]
    source_kind: str
    model_version: str


class DocumentResponse(BaseModel):
    text: str
    summary: str
    requirements: list[str]
    # The spec's shape says nothing about failure, and a scanned TOR returns an
    # empty string through it. These make "no text" distinguishable from "no
    # readable text", which is the difference between a bad upload and a file
    # that needs OCR.
    status: str
    pages: int
    kind: str
    problem: str | None = None


# ----------------------------------------------------------------------- app

app = FastAPI(
    title="Vantage Africa tender intelligence",
    version=MODEL_VERSION,
    summary="Reads tenders, scores them against the capability statement, and learns from decided bids.",
)

if settings().cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings().cors_origins,
        allow_methods=["POST", "GET"],
        allow_headers=["authorization", "content-type"],
    )


def require_token(authorization: str = Header(default="")) -> None:
    """Reject anything without the shared token.

    `compare_digest` rather than `==`: the comparison is on a secret, and the
    early-exit of a normal string compare leaks its length and prefix to anyone
    willing to time enough requests.
    """
    import os

    expected = os.environ.get("AI_API_TOKEN", "")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="AI_API_TOKEN is not set on this service, so every request is refused.",
        )
    supplied = authorization.removeprefix("Bearer ").strip()
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Bad or missing token.")


@app.get("/health")
def health() -> dict[str, Any]:
    """Whether this can do its job, in enough detail to fix it when it cannot.

    Unauthenticated on purpose -- it is what a container's readiness probe
    calls, and it reports capability rather than data.
    """
    connected, detail = db.healthy()
    return {
        "ok": connected,
        "database": detail,
        "model_version": MODEL_VERSION,
        "optional_models": nlp_engine.capabilities(),
    }


@app.post("/analyse-tender", response_model=AnalyseResponse, dependencies=[Depends(require_token)])
def analyse_tender_endpoint(request: AnalyseRequest) -> AnalyseResponse:
    """Analyse one tender and store the result.

    Stores as well as returns, deliberately. An analysis the caller sees and the
    console does not is two systems with different opinions about the same
    tender, which is worse than either answer alone.
    """
    try:
        intelligence = scheduler.analyse_rfp(request.tender_id)
    except LookupError as cause:
        raise HTTPException(status_code=404, detail=str(cause)) from cause
    except Exception as cause:  # noqa: BLE001
        log.exception("Analysis failed for %s", request.tender_id)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {cause}") from cause

    return AnalyseResponse(
        summary=intelligence.summary,
        score=intelligence.score,
        matched_capabilities=intelligence.matched_capabilities,
        risks=intelligence.risks,
        recommendation=intelligence.recommendation,
        win_probability=intelligence.win_probability,
        priority=intelligence.priority,
        themes=intelligence.themes,
        requirements=intelligence.requirements,
        missing_information=intelligence.missing_information,
        similar_bids=intelligence.similar_bids,
        consultants=intelligence.consultants,
        reasons=intelligence.reasons,
        source_kind=intelligence.source_kind,
        model_version=MODEL_VERSION,
    )


@app.post("/extract-rfp-document", response_model=DocumentResponse, dependencies=[Depends(require_token)])
async def extract_rfp_document(pdf_file: UploadFile = File(...)) -> DocumentResponse:
    """Read a PDF that is not in the database yet.

    For checking a TOR before it is attached to anything. Nothing is stored:
    files that belong to a tender are uploaded through the console, which knows
    whose tender it is and files it under the right owner.
    """
    data = await pdf_file.read()
    extraction = pdf_processor.extract(data, file_name=pdf_file.filename or "")

    requirements: list[str] = []
    if extraction.usable:
        reading = nlp_engine.analyse(title=pdf_file.filename or "", documents=[extraction.text])
        requirements = [*reading.deliverables[:8], *reading.required_expertise[:6]][:12]

    return DocumentResponse(
        text=extraction.text,
        summary=pdf_processor.summarise(extraction),
        requirements=requirements,
        status=extraction.status,
        pages=extraction.pages,
        kind=pdf_processor.classify(pdf_file.filename or "", extraction.text),
        problem=extraction.problem,
    )


@app.post("/run", dependencies=[Depends(require_token)])
def run_pass(limit: int | None = None) -> dict[str, Any]:
    """One scheduler pass, on demand.

    What you call after editing capability_profile.json, or once by hand
    instead of running the loop at all -- some installations would rather drive
    this from their own cron than keep a process alive.
    """
    return scheduler.run_once(limit).as_dict()


@app.post("/record-lessons", dependencies=[Depends(require_token)])
def record_lessons() -> dict[str, Any]:
    """Backfill the learning model from every bid already decided."""
    recorded, failures = scheduler.record_lessons()
    return {"lessons_recorded": recorded, "failures": failures}
