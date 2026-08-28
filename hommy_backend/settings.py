from __future__ import annotations

import os


def openai_api_key() -> str:
    """Read OpenAI credentials without ever embedding them in source.

    Environment variables are preferred. A Render Secret File named config.py remains
    supported during migration from the legacy Hommy deployment.
    """
    value = os.getenv("OPENAI_API_KEY", "").strip()
    if value:
        return value
    try:
        from config import OPENAI_API_KEY as legacy_key  # type: ignore
    except Exception:
        return ""
    return str(legacy_key or "").strip()
