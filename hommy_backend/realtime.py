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
    voice = os.getenv("HOMMY_REALTIME_VOICE", "cedar").strip()
    model = os.getenv("HOMMY_REALTIME_MODEL", "gpt-realtime-2.1").strip()
    voice_instructions = """
Estás en modo voz.
- Habla con una voz masculina, cálida, segura y profesional, con ritmo tranquilo y español colombiano natural. Evita sonar como locutor o robot.
- Responde de forma breve y conversacional; normalmente 1 a 3 frases antes de esperar al usuario.
- Todos los campos terminados en _cop son PESOS COLOMBIANOS completos. Lee 2900000 como "dos millones novecientos mil pesos", 1350000 como "un millón trescientos cincuenta mil pesos" y 675000 como "seiscientos setenta y cinco mil pesos". Nunca reduzcas millones a miles ni omitas ceros.
- Si recibes también una cifra formateada como $2.900.000, interprétala como dos millones novecientos mil pesos colombianos.
- Si el usuario pregunta por el saldo, deuda o abonos de la venta u OP que acabas de mencionar, identifica esa OP en el contexto y usa consultar_historial_pagos antes de responder. No digas que no tienes el saldo sin consultar la herramienta.
- No te adelantes por una pausa corta. Espera a que el usuario realmente termine la idea.
""".strip()
    return {
        "type": "realtime",
        "model": model,
        "instructions": HommyEngine.instructions(context) + "\n\n" + voice_instructions,
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "noise_reduction": {"type": "near_field"},
                "transcription": {
                    "model": "gpt-4o-mini-transcribe",
                    "language": "es",
                    "prompt": (
                        "Conversación operativa de HomeEasy en español colombiano. "
                        "Vocabulario posible: HomeEasy, Hommy, OP, orden de pedido, "
                        "Sheer Elegance, Onda Serena, Vertesse, cotización, abono, "
                        "saldo, COP y pesos colombianos."
                    ),
                },
                "turn_detection": {
                    "type": "semantic_vad",
                    "eagerness": "low",
                    "create_response": True,
                    "interrupt_response": True,
                },
            },
            "output": {"voice": voice},
        },
        "reasoning": {"effort": "low"},
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
