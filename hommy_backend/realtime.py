from __future__ import annotations

import os
from typing import Any

from openai import OpenAI

from .auth import AuthContext
from .engine import HommyEngine
from .settings import openai_api_key
from .tools import tools_for_context


class RealtimeError(RuntimeError):
    pass


def realtime_tools(context: AuthContext) -> list[dict[str, Any]]:
    """Realtime accepts the documented function-tool subset, filtered by HomeEasy permissions."""
    allowed = ("type", "name", "description", "parameters")
    return [
        {key: tool[key] for key in allowed if key in tool}
        for tool in tools_for_context(context)
    ]


def session_config(context: AuthContext) -> dict[str, Any]:
    voice = os.getenv("HOMMY_REALTIME_VOICE", "marin").strip()
    model = os.getenv("HOMMY_REALTIME_MODEL", "gpt-realtime-2.1").strip()
    return {
        "type": "realtime",
        "model": model,
        "instructions": HommyEngine.instructions(context)
        + "\nEstás en modo voz. Responde conversacionalmente y con frases naturales.",
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "turn_detection": {
                    "type": "server_vad",
                    "create_response": True,
                    "interrupt_response": True,
                }
            },
            "output": {"voice": voice},
        },
        "tools": realtime_tools(context),
        "tool_choice": "auto",
        "parallel_tool_calls": False,
    }


def create_call(sdp: str, context: AuthContext) -> str:
    api_key = openai_api_key()
    if not api_key:
        raise RealtimeError("La voz de Hommy no está configurada.")
    if not str(sdp or "").strip():
        raise RealtimeError("No se recibió una oferta WebRTC válida.")

    try:
        response = OpenAI(api_key=api_key).realtime.calls.create(
            sdp=sdp,
            session=session_config(context),
            timeout=25,
        )
    except Exception as exc:
        raise RealtimeError("No fue posible iniciar la conversación por voz.") from exc
    return response.text
