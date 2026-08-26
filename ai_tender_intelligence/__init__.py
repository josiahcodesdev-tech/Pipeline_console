"""Vantage Africa tender intelligence.

An analysis layer that reads every tender the console holds, scores it against
the firm's capability statement, learns from bids already decided, and writes
what it concludes back to the same Postgres database the console reads.

It adds to that system and replaces nothing. See README.md.
"""

from .config import MODEL_VERSION

__all__ = ["MODEL_VERSION"]
__version__ = MODEL_VERSION
