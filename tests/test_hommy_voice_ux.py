import importlib
import os
import sys
import unittest
from contextlib import contextmanager
from typing import Literal, get_args, get_origin, get_type_hints
from unittest.mock import Mock, patch

from hommy_backend.auth import AuthContext
from hommy_backend.realtime import create_call, session_config
from hommy_backend.tools import execute_tool


@contextmanager
def actual_openai_sdk():
    """Temporarily bypass the legacy test stub without depending on import order."""
    current = sys.modules.get("openai")
    if current is None or hasattr(current, "__path__"):
        yield
        return

    saved = {
        name: module
        for name, module in tuple(sys.modules.items())
        if name == "openai" or name.startswith("openai.")
    }
    for name in saved:
        sys.modules.pop(name, None)
    try:
        importlib.import_module("openai")
        yield
    finally:
        for name in tuple(sys.modules):
            if name == "openai" or name.startswith("openai."):
                sys.modules.pop(name, None)
        sys.modules.update(saved)


class StubData:
    def recent_sales(self, limit=5, *, require_fresh=False):
        return [{
            "numero": "38",
            "fecha": "14/08/2026",
            "cedula": "123",
            "nombre": "Cristhian Guzmán Mellizo",
            "descripcion": "Combo Portobello + 4 verticales adicionales",
            "total": "$2.900.000",
            "abono_inicial": "$1.450.000",
            "saldo": "$1.450.000",
            "estado": "ACTIVO",
            "url_pdf": "https://example.com/op38.pdf",
            "abonos_extra": [],
        }][:limit]


class HommyVoiceUxTests(unittest.TestCase):
    def setUp(self):
        self.context = AuthContext(
            "u1",
            "Alejandro Herrera",
            "a@example.com",
            "ADMIN",
            frozenset({"app.access", "ventas.read", "reportes.read", "caja.read"}),
        )

    def test_recent_sales_expose_full_cop_numbers_and_structured_cards(self):
        result = execute_tool("obtener_ultimas_ventas", {"cantidad": 5}, self.context, StubData())
        self.assertTrue(result["ok"])
        sale = result["data"][0]
        self.assertEqual(sale["total_cop"], 2_900_000)
        self.assertEqual(sale["abono_inicial_cop"], 1_450_000)
        self.assertEqual(sale["saldo_cop"], 1_450_000)
        order_cards = [card for card in result["ui"] if card.get("type") == "order"]
        self.assertEqual(len(order_cards), 1)
        self.assertIn("OP 38", order_cards[0]["title"])
        self.assertEqual(order_cards[0]["amount"], 2_900_000)
        document = order_cards[0]["document"]
        self.assertEqual(document["title"], "Ver OP")
        self.assertEqual(document["url"], "https://example.com/op38.pdf")

    def test_realtime_defaults_to_cedar_and_semantic_vad(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HOMMY_REALTIME_MODEL", None)
            os.environ.pop("HOMMY_REALTIME_VOICE", None)
            config = session_config(self.context)

        self.assertEqual(config["model"], "gpt-realtime-2.1")
        self.assertEqual(config["audio"]["output"]["voice"], "cedar")
        self.assertEqual(config["reasoning"], {"effort": "low"})
        vad = config["audio"]["input"]["turn_detection"]
        self.assertEqual(vad["type"], "semantic_vad")
        self.assertEqual(vad["eagerness"], "low")
        self.assertTrue(vad["create_response"])
        self.assertTrue(vad["interrupt_response"])
        self.assertNotIn("threshold", vad)
        self.assertNotIn("prefix_padding_ms", vad)
        self.assertNotIn("silence_duration_ms", vad)
        self.assertIn("PESOS COLOMBIANOS", config["instructions"])
        self.assertIn("consultar_historial_pagos", config["instructions"])

    def test_realtime_uses_near_field_and_spanish_domain_transcription(self):
        audio_input = session_config(self.context)["audio"]["input"]
        self.assertEqual(audio_input["noise_reduction"], {"type": "near_field"})
        transcription = audio_input["transcription"]
        self.assertEqual(transcription["model"], "gpt-4o-mini-transcribe")
        self.assertEqual(transcription["language"], "es")
        prompt = transcription["prompt"]
        expected_terms = (
            "HomeEasy",
            "Hommy",
            "OP",
            "Sheer Elegance",
            "COP",
            "pesos colombianos",
        )
        for term in expected_terms:
            self.assertIn(term, prompt)

    def test_realtime_payload_matches_installed_openai_sdk_contract(self):
        config = session_config(self.context)
        with actual_openai_sdk():
            import httpx
            from openai import OpenAI
            from openai.types.realtime.audio_transcription_param import (
                AudioTranscriptionParam,
            )
            from openai.types.realtime.noise_reduction_type import NoiseReductionType
            from openai.types.realtime.realtime_audio_config_input_param import (
                RealtimeAudioConfigInputParam,
            )
            from openai.types.realtime.realtime_audio_config_output_param import (
                RealtimeAudioConfigOutputParam,
            )
            from openai.types.realtime.realtime_audio_config_param import (
                RealtimeAudioConfigParam,
            )
            from openai.types.realtime.realtime_audio_input_turn_detection_param import (
                SemanticVad,
            )
            from openai.types.realtime.realtime_reasoning_effort import (
                RealtimeReasoningEffort,
            )
            from openai.types.realtime.realtime_reasoning_param import (
                RealtimeReasoningParam,
            )
            from openai.types.realtime.realtime_session_create_request_param import (
                RealtimeSessionCreateRequestParam,
            )

            def literal_values(annotation):
                values = set()
                if get_origin(annotation) is Literal:
                    values.update(get_args(annotation))
                for member in get_args(annotation):
                    values.update(literal_values(member))
                return values

            session_fields = get_type_hints(RealtimeSessionCreateRequestParam)
            audio_fields = get_type_hints(RealtimeAudioConfigParam)
            input_fields = get_type_hints(RealtimeAudioConfigInputParam)
            output_fields = get_type_hints(RealtimeAudioConfigOutputParam)
            transcription_fields = get_type_hints(AudioTranscriptionParam)
            semantic_vad_fields = get_type_hints(SemanticVad)
            reasoning_fields = get_type_hints(RealtimeReasoningParam)

            assert set(config) <= set(session_fields)
            assert set(config["audio"]) <= set(audio_fields)
            assert set(config["audio"]["input"]) <= set(input_fields)
            assert set(config["audio"]["output"]) <= set(output_fields)
            assert set(config["audio"]["input"]["transcription"]) <= set(
                transcription_fields
            )
            assert set(config["audio"]["input"]["turn_detection"]) <= set(
                semantic_vad_fields
            )
            assert set(config["reasoning"]) <= set(reasoning_fields)

            assert "gpt-realtime-2.1" in literal_values(session_fields["model"])
            assert "gpt-4o-mini-transcribe" in literal_values(
                transcription_fields["model"]
            )
            assert "cedar" in literal_values(output_fields["voice"])
            assert "semantic_vad" in literal_values(semantic_vad_fields["type"])
            assert "low" in literal_values(semantic_vad_fields["eagerness"])
            assert "near_field" in get_args(NoiseReductionType)
            assert "low" in get_args(RealtimeReasoningEffort)

            transport = httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    text="answer-sdp",
                    headers={"content-type": "application/sdp"},
                )
            )
            client = OpenAI(
                api_key="unit-test-key",
                http_client=httpx.Client(transport=transport),
            )
            response = client.realtime.calls.create(sdp="offer-sdp", session=config)
            self.assertEqual(response.text, "answer-sdp")

    def test_create_call_forwards_the_supported_session_payload(self):
        client = Mock()
        client.realtime.calls.create.return_value.text = "answer-sdp"
        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "unit-test-key"}, clear=False),
            patch("hommy_backend.realtime.OpenAI", return_value=client) as openai_client,
        ):
            result = create_call("offer-sdp", self.context)

        self.assertEqual(result, "answer-sdp")
        openai_client.assert_called_once_with(api_key="unit-test-key")
        call = client.realtime.calls.create.call_args
        self.assertEqual(call.kwargs["sdp"], "offer-sdp")
        self.assertEqual(call.kwargs["timeout"], 25)
        self.assertEqual(call.kwargs["session"]["model"], "gpt-realtime-2.1")
        self.assertEqual(
            call.kwargs["session"]["audio"]["input"]["turn_detection"]["type"],
            "semantic_vad",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
