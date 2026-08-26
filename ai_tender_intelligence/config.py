"""Settings, and the one place that knows where anything lives.

Everything here comes from the environment. Nothing is hard-coded and nothing
is committed: the database URL is a credential, the Supabase service key is a
credential, and this repository is not where either belongs.

    cp ai_tender_intelligence/.env.example ai_tender_intelligence/.env

Then fill it in from the Supabase dashboard: Settings -> Database for the
connection string, Settings -> API for the service key.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent

# Bumped whenever scoring changes in a way that makes old scores incomparable.
#
# It is written onto every ai_analysis row, and that is the whole point of
# keeping the rows: a score means nothing on its own, and "the score fell" is a
# different fact from "the model changed". Raise the minor number for a tuned
# weight or a new term; raise the major for a change of method.
MODEL_VERSION = "1.1.0"


def _load_dotenv() -> None:
    """Read `.env` next to this package, without a dependency to do it.

    python-dotenv would be one more thing to install for nine lines of parsing,
    and this runs before anything else can fail informatively. Values already
    in the environment win, so a container's real configuration is never
    overwritten by a file somebody left lying around.
    """
    path = PACKAGE_DIR / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv()


class ConfigError(RuntimeError):
    """A setting that has no sensible default and was not supplied."""


@dataclass(frozen=True)
class Settings:
    """Everything the service needs to run, resolved once."""

    # ---------------------------------------------------------------- database
    #
    # The session-pooler URI, not the direct one. Supabase's direct 5432 host is
    # IPv6-only on the free tiers and refuses connections from most CI and
    # container networks with a message about the host being unreachable, which
    # reads as a firewall problem and is not one.
    database_url: str

    # -------------------------------------------------------------- storage
    # Only needed to read TOR files back out of the `tenders` bucket. Analysis
    # of already-extracted text works without either of these.
    supabase_url: str = ""
    supabase_service_key: str = ""
    storage_bucket: str = "tenders"

    # ------------------------------------------------------------------ nlp
    # Both are optional and both are heavy. See nlp_engine.py: the engine
    # degrades to deterministic matching rather than refusing to start, because
    # a service that will not boot without a 500MB download is a service nobody
    # runs.
    spacy_model: str = "en_core_web_sm"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    use_embeddings: bool = True

    # -------------------------------------------------------------- scoring
    #
    # A capability match at or above `pursue_at` is worth pursuing; below
    # `decline_below` it is worth declining. Between them the answer is
    # "consider", which is the honest answer more often than either extreme.
    #
    # THE NUMBERS ARE READ OFF THE SCALE, NOT PICKED. A perfect fit is the two
    # heaviest services together (MEL and training, 10 + 10 of an 18-point
    # ceiling), so one flagship service matched squarely scores about 56 -- and
    # a threshold of 60 would rank the firm's own core work as "consider". These
    # were 60/25 until a test on a pure MEL tender showed exactly that.
    #
    #   ~56   one flagship service, squarely
    #   ~67   several services, one of them fully
    #   100   MEL and training together
    pursue_at: int = 50
    decline_below: int = 25

    # ------------------------------------------------------------- scheduler
    interval_seconds: int = 900
    batch_size: int = 25

    # ------------------------------------------------------------------- api
    host: str = "127.0.0.1"
    port: int = 8099
    # Empty means no browser may call this directly, which is the default and
    # the intent: the console reads analyses out of Postgres, not out of here.
    cors_origins: list[str] = field(default_factory=list)


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


@lru_cache(maxsize=1)
def settings() -> Settings:
    url = os.environ.get("AI_DATABASE_URL", "").strip() or os.environ.get(
        "SUPABASE_DB_URL", ""
    ).strip()
    if not url:
        raise ConfigError(
            "AI_DATABASE_URL is not set. Copy ai_tender_intelligence/.env.example "
            "to .env and fill in the Supabase session-pooler connection string "
            "(Settings -> Database -> Connection string -> Session pooler)."
        )

    # SQLAlchemy wants an explicit driver; Supabase hands out bare `postgres://`
    # and `postgresql://`. Normalising here means the value pasted from the
    # dashboard works without anybody having to know that.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]

    origins = [
        origin.strip()
        for origin in os.environ.get("AI_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]

    return Settings(
        database_url=url,
        supabase_url=os.environ.get("SUPABASE_URL", "").strip(),
        supabase_service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
        storage_bucket=os.environ.get("AI_STORAGE_BUCKET", "tenders").strip() or "tenders",
        spacy_model=os.environ.get("AI_SPACY_MODEL", "en_core_web_sm").strip(),
        embedding_model=os.environ.get(
            "AI_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        ).strip(),
        use_embeddings=_flag("AI_USE_EMBEDDINGS", True),
        pursue_at=_int("AI_PURSUE_AT", 50),
        decline_below=_int("AI_DECLINE_BELOW", 25),
        interval_seconds=_int("AI_INTERVAL_SECONDS", 900),
        batch_size=_int("AI_BATCH_SIZE", 25),
        host=os.environ.get("AI_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=_int("AI_PORT", 8099),
        cors_origins=origins,
    )


CAPABILITY_PROFILE_PATH = PACKAGE_DIR / "capability_profile.json"
