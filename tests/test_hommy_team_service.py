"""Hommy team service: offline security and response contract regressions."""
from __future__ import annotations

import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import servidor
from hommy_backend.team import (
    TeamServiceError, SCHEMA, interpret_team, require_service_token,
    validated_payload, validate_model_answer,
)

KEY = "team-service-" + "x" * 52


def payload(question="Hommy, cómo vamos con la cortina Onda Serena?"):
    return {
        "version": 1,
        "purpose": "HOME_EASY_TEAM_READ_ONLY",
        "question": question,
        "history": [{"question": "Qué sabemos?", "answer": "Solo una oportunidad abierta."}],
        "facts": {
            "source": "ANALYZED_MEMORY_ONLY",
            "available": True,
            "manualPending": 0,
            "knownClients": 1,
            "openOpportunities": 1,
            "opportunities": [
                {
                    "product": "Onda Serena", "rooms": ["sala"],
                    "nextAction": "REQUEST_QUOTE_DETAILS", "hasQuoteReference": False,
                },
            ],
            "truncated": False,
            "caveats": ["La memoria analizada no es la lista completa de chats, ventas ni agenda de visitas."],
        },
        "style": {
            "locale": "es-CO",
            "tone": "natural_whatsapp",
            "shortSentences": True,
            "constraints": [
                "No inventar citas, envíos, precios, medidas ni descuentos.",
                "Si el usuario pide una acción sobre clientes, devolver REVIEW_REQUIRED.",
                "No devolver números de teléfono, credenciales o texto de conversaciones.",
                "Usar los hechos de facts solamente; avisar cuando falten datos.",
                "Responder como colega de HomeEasy, no como reporte burocrático.",
            ],
        },
    }


class FakeResponses:
    def __init__(self, output=None, status="completed"):
        self.calls = []
        self.output = output or {
            "kind": "ANSWER",
            "text": "Sobre esa cortina veo una oportunidad abierta. Todavía faltan datos para cotizar.",
        }
        self.status = status

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(status=self.status, output_text=json.dumps(self.output))


class FakeClient:
    def __init__(self, **kwargs):
        self.responses = FakeResponses(**kwargs)


class TeamOnlyContractTests(unittest.TestCase):
    def setUp(self):
        servidor.rate_limiter.clear()
        self.client = servidor.app.test_client()

    def auth_headers(self, token=KEY):
        return {"Authorization": "Bearer " + token, "Content-Type": "application/json"}

    def test_disabled_by_default_even_with_secret(self):
        with patch.dict(os.environ, {
            "HOMMY_TEAM_AI_SERVICE_TOKEN": KEY,
            "HOMMY_TEAM_SERVICE_ENABLED": "false",
        }):
            response = self.client.post(
                "/api/hommy/team/interpret", json=payload(), headers=self.auth_headers()
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"]["code"], "TEAM_SERVICE_DISABLED")

    def test_requires_dedicated_secret_not_a_homeeasy_session(self):
        with patch.dict(os.environ, {
            "HOMMY_TEAM_AI_SERVICE_TOKEN": KEY,
            "HOMMY_TEAM_SERVICE_ENABLED": "true",
        }):
            for headers in [
                {}, {"Authorization": "Bearer " + "wrong" * 10},
                {"X-HomeEasy-Session": "fake-personal-session"},
                {"Authorization": "Basic anything"},
            ]:
                result = self.client.post(
                    "/api/hommy/team/interpret", json=payload(), headers=headers
                )
                self.assertEqual(result.status_code, 401, headers)
                self.assertEqual(result.json["error"]["code"], "TEAM_UNAUTHORIZED")
        with patch.dict(os.environ, {
            "HOMMY_TEAM_AI_SERVICE_TOKEN": "",
            "HOMMY_TEAM_SERVICE_ENABLED": "true",
        }):
            self.assertEqual(
                self.client.post("/api/hommy/team/interpret", json=payload(),
                                 headers=self.auth_headers()).status_code, 503,
            )

    def test_read_only_route_has_no_session_validation_or_user_tools(self):
        with patch.dict(os.environ, {
            "HOMMY_TEAM_AI_SERVICE_TOKEN": KEY,
            "HOMMY_TEAM_SERVICE_ENABLED": "true",
        }):
            with patch.object(servidor, "auth_context", side_effect=AssertionError("session called")), \
                 patch.object(servidor, "get_engine", side_effect=AssertionError("tool engine called")), \
                 patch.object(servidor, "interpret_team",
                              return_value={"kind": "ANSWER", "text": "Hay una oportunidad abierta."}) as mock:
                response = self.client.post(
                    "/api/hommy/team/interpret", json=payload(), headers=self.auth_headers()
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, {
                    "kind": "ANSWER", "text": "Hay una oportunidad abierta."
                })
                mock.assert_called_once()

    def test_rejects_oversized_invalid_and_malicious_payload(self):
        with patch.dict(os.environ, {
            "HOMMY_TEAM_AI_SERVICE_TOKEN": KEY,
            "HOMMY_TEAM_SERVICE_ENABLED": "true",
        }):
            too_big = self.client.post(
                "/api/hommy/team/interpret", data=json.dumps({
                    **payload(), "question": "x" * 20000
                }), headers=self.auth_headers()
            )
            self.assertEqual(too_big.status_code, 413)
            invalid = self.client.post(
                "/api/hommy/team/interpret", data="oops", headers=self.auth_headers()
            )
            self.assertEqual(invalid.status_code, 400)

        for transform in [
            lambda p: p["facts"].update({"clientPhone": "573001234567"}),
            lambda p: p["facts"]["opportunities"][0].update({"customerName": "Laura"}),
            lambda p: p.update({"version": 7}),
            lambda p: p["facts"].update({"knownClients": True}),
            lambda p: p["history"].extend([{"question": "a", "answer": "b"}] * 3),
            lambda p: p["facts"]["opportunities"][0].update({"rooms": ["casa de Laura"]}),
        ]:
            data = payload()
            transform(data)
            with self.assertRaises(TeamServiceError):
                validated_payload(data)

    def test_actions_are_review_only_before_any_model_call(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only-key"}):
            for question in [
                "Dile a Laura que vamos en camino",
                "Hommy, envíale el precio de esa cortina",
                "Agenda una visita mañana",
                "Marca esa conversación como venta",
                "Confirma la cita del cliente",
            ]:
                client = FakeClient()
                result = interpret_team(payload(question), client=client)
                self.assertEqual(result["kind"], "REVIEW_REQUIRED", question)
                self.assertEqual(client.responses.calls, [])

    def test_model_is_read_only_with_strict_json_schema_and_no_business_tools(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only-key"}):
            model = FakeClient()
            result = interpret_team(payload(), client=model)
        self.assertEqual(result["kind"], "ANSWER")
        self.assertEqual(len(model.responses.calls), 1)
        params = model.responses.calls[0]
        self.assertNotIn("tools", params)
        self.assertNotIn("conversation", params)
        self.assertEqual(params["store"], False)
        self.assertEqual(params["text"]["format"]["schema"], SCHEMA)
        self.assertTrue(params["text"]["format"]["strict"])
        self.assertLessEqual(len(params["input"][1]["content"]), 12000)

    def test_blocks_unverified_claims_and_personal_details(self):
        facts = payload()["facts"]
        for text in [
            "Ya le envié la cotización.",
            "La cita quedó confirmada.",
            "Hay 26 ventas confirmadas.",
            "Entra a https://bad.example/test",
            "El precio es $500.000.",
            "El número es 573001234567.",
        ]:
            with self.assertRaises(TeamServiceError, msg=text):
                validate_model_answer({"kind": "ANSWER", "text": text}, facts)
        result = validate_model_answer({
            "kind": "ANSWER",
            "text": "Sobre Onda Serena veo una oportunidad abierta. Aún faltan datos para cotizar.",
        }, facts)
        self.assertEqual(result["kind"], "ANSWER")
        self.assertEqual(validate_model_answer({
            "kind": "REVIEW_REQUIRED", "text": "",
        }, facts), {"kind": "REVIEW_REQUIRED"})

    def test_model_errors_do_not_disclose_exception_or_secret(self):
        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "test-only-key",
            "HOMMY_TEAM_AI_SERVICE_TOKEN": KEY,
            "HOMMY_TEAM_SERVICE_ENABLED": "true",
        }):
            with patch.object(servidor, "interpret_team",
                              side_effect=TeamServiceError("TEAM_MODEL_UNAVAILABLE", 502)):
                result = self.client.post(
                    "/api/hommy/team/interpret", json=payload(), headers=self.auth_headers()
                )
            self.assertEqual(result.status_code, 502)
            self.assertNotIn(KEY, result.get_data(as_text=True))
            self.assertNotIn("OPENAI_API_KEY", result.get_data(as_text=True))

    def test_missing_memory_facts_are_unknown_not_confirmed_zero(self):
        data = payload()
        data["facts"].update({
            "available": False,
            "knownClients": None,
            "openOpportunities": None,
            "opportunities": [],
        })
        self.assertFalse(validated_payload(data)["facts"]["available"])
        data["facts"]["knownClients"] = 0
        with self.assertRaises(TeamServiceError):
            validated_payload(data)


if __name__ == "__main__":
    unittest.main()
