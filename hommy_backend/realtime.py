from __future__ import annotations

import json
import os
from typing import Any

import requests

from .auth import AuthContext, safety_identifier
from .engine import HommyEngine
from .tools import TOOL_SPECS
from .settings import openai_api_key


class RealtimeError(RuntimeError):
    pass


def session_config(context: AuthContext) -> dict[str, Any]:
    voice = os.getenv("HOMMY_REALTIME_VOICE", "marin").strip()
    model = os.getenv("HOMMY_REALTIME_MODEL", "gpt-realtime-2.1").strip()
    return {
        "type": "realtime",
        "model": model,
        "instructions": HommyEngine.instructions(context) + "\nEstás en modo voz. Responde conversacionalmente y con frases naturales.",
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
        "tools": TOOL_SPECS,
        "tool_choice": "auto",
    }


def create_call(sdp: str, context: AuthContext) -> str:
    api_key = openai_api_key()
    if not api_key:
        raise RealtimeError("La voz de Hommy no está configurada.")
    if not str(sdp or "").strip():
        raise RealtimeError("No se recibió una oferta WebRTC válida.")

    files = {
        "sdp": (None, sdp),
        "session": (None, json.dumps(session_config(context), ensure_ascii=False)),
    }
    try:
        response = requests.post(
            "https://api.openai.com/v1/realtime/calls",
            headers={
                "Authorization": f"Bearer {api_key}",
                "OpenAI-Safety-Identifier": safety_identifier(context),
            },
            files=files,
            timeout=25,
        )
    except requests.RequestException as exc:
        raise RealtimeError("No fue posible iniciar la conversación por voz.") from exc

    if not response.ok:
        raise RealtimeError(f"OpenAI Realtime rechazó la conexión ({response.status_code}).")
    return response.text
