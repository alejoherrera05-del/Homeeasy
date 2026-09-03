from __future__ import annotations

import json
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from hommy_backend.auth import AuthContext
from hommy_backend.followup import FollowupPlanError, FollowupPlanner
from hommy_backend.periods import HOME_EASY_TIMEZONE
from hommy_backend.whatsapp_context import WhatsAppConversationClient


def source_detail(version=1):
    return {
        "status": "ok",
        "cotizacion": {
            "numero": "32",
            "fecha": "2026-08-31T18:17:13-05:00",
            "cedula": "SECRET-ID",
            "nombre": "Karen Cordero",
            "descripcion": "Cortina onda serena 2.8",
            "observaciones": "Tela Reverso Taupe",
            "total": 1400000,
            "pdfUrl": "https://example.invalid/private.pdf",
            "estado": "COTIZACION",
            "notaManual": "",
        },
        "cliente": {
            "cedula": "SECRET-ID",
            "nombre": "Karen Cordero",
            "telefono": "3001112233",
            "email": "karen@example.invalid",
            "direccion": "Calle privada 123",
        },
        "seguimiento": {
            "modo": "REVIEW",
            "estado": "ACTIVE",
            "intencion": "NEW_QUOTE",
            "temperatura": "ACTIVE",
            "resumen": "",
            "objeciones": [],
            "fechaPrometida": "",
            "proximaAccionFecha": "",
            "proximaAccionTipo": "",
            "ultimoSaliente": "",
            "ultimoEntrante": "",
            "intentosSeguimiento": 0,
            "motivoStop": "",
            "planVersion": 0,
            "estadoVersion": version,
        },
        "timeline": [
            {
                "fecha": "2026-08-31T18:17:13-05:00",
                "actorType": "SYSTEM",
                "eventType": "QUOTE_CREATED",
                "channel": "SYSTEM",
                "text": "Cotización COT-32 creada.",
                "intencion": "NEW_QUOTE",
                "temperatura": "ACTIVE",
                "estado": "ACTIVE",
                "motivo": "",
            }
        ],
        "timelineTotal": 1,
    }


def silent_whatsapp():
    return {
        "available": True,
        "source": "WAHA_WEBJS",
        "messages": [
            {
                "at": "2026-09-01T10:14:00-05:00",
                "direction": "OUTGOING",
                "text": "Hola Karen, te compartimos tu Cotización COT-32 de HomeEasy.",
                "hasMedia": True,
                "media": "[Documento PDF]",
                "ack": "READ",
            },
            {
                "at": "2026-09-01T10:15:00-05:00",
                "direction": "OUTGOING",
                "text": "Quedamos atentos a cualquier duda que tengas.",
                "hasMedia": False,
                "media": "",
                "ack": "READ",
            },
        ],
        "activity": [
            {
                "at": "2026-09-01T10:14:00-05:00",
                "state": "SENT",
                "documentType": "cotizacion",
                "reference": "COT-32",
                "referenceMatch": True,
                "filename": "Cotizacion_COT-32.pdf",
                "source": "cotizacion",
            }
        ],
        "evidence": {
            "messageCount": 2,
            "incomingCount": 0,
            "outgoingCount": 2,
            "lastIncomingAt": None,
            "lastOutgoingAt": "2026-09-01T10:15:00-05:00",
            "hoursSinceLastOutgoing": 52.0,
            "customerRepliedAfterLastOutgoing": False,
            "quoteDelivery": {
                "at": "2026-09-01T10:14:00-05:00",
                "state": "SENT",
                "reference": "COT-32",
                "filename": "Cotizacion_COT-32.pdf",
            },
            "customerRepliedAfterQuote": False,
        },
    }


def with_reply():
    value = json.loads(json.dumps(silent_whatsapp()))
    value["messages"].append(
        {
            "at": "2026-09-03T15:00:00-05:00",
            "direction": "INCOMING",
            "text": "Hola, sí la estoy revisando. Mañana te confirmo.",
            "hasMedia": False,
            "media": "",
            "ack": "",
        }
    )
    value["evidence"].update(
        {
            "messageCount": 3,
            "incomingCount": 1,
            "lastIncomingAt": "2026-09-03T15:00:00-05:00",
            "customerRepliedAfterLastOutgoing": True,
            "customerRepliedAfterQuote": True,
        }
    )
    return value


def no_response_plan():
    return {
        "decision": "SEND",
        "reasonCode": "FOLLOWUP_DUE",
        "intent": "NO_RESPONSE",
        "temperature": "ACTIVE",
        "summary": "La cotización fue enviada y no hay respuesta posterior de la cliente.",
        "objective": "Retomar la conversación con una ayuda concreta y sin presión.",
        "message": (
            "Hola Karen 😊 Quería saber si alcanzaste a revisar la propuesta de la Onda Serena. "
            "Si te quedó alguna duda sobre la tela Reverso Taupe o las medidas, con gusto te ayudo a revisarla."
        ),
        "nextActionAt": None,
        "confidence": 0.9,
        "needsHumanReview": False,
        "stopReason": None,
        "explanation": "Hay envío confirmado y no existe respuesta entrante posterior.",
    }


class FakeResponses:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(output_text=json.dumps(self.payload, ensure_ascii=False))


class FakeOpenAI:
    def __init__(self, payload):
        self.responses = FakeResponses(payload)


class SequenceFollowupClient:
    def __init__(self, rows):
        self.rows = list(rows)

    def detail(self, quote_number, **kwargs):
        if not self.rows:
            raise AssertionError("Unexpected HomeEasy detail call")
        return self.rows.pop(0)


class SequenceWhatsAppClient:
    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = []

    def context(self, quote_number, detail, **kwargs):
        self.calls.append((quote_number, kwargs))
        if not self.rows:
            raise AssertionError("Unexpected WhatsApp context call")
        return self.rows.pop(0)


class WhatsAppContextClientTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 3, 15, 0, tzinfo=HOME_EASY_TIMEZONE)

    def test_bridge_payload_is_minimized_and_contact_data_is_redacted(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "ok": True,
            "messages": [
                {
                    "id": "SECRET-MESSAGE-ID",
                    "at": "2026-09-01T10:15:00-05:00",
                    "direction": "OUTGOING",
                    "text": "Escríbeme al 3001112233 o a karen@example.com",
                    "hasMedia": False,
                    "media": "",
                    "ack": "READ",
                }
            ],
            "activity": [
                {
                    "at": "2026-09-01T10:14:00-05:00",
                    "state": "SENT",
                    "documentType": "cotizacion",
                    "reference": "COT-32",
                    "referenceMatch": True,
                    "filename": "Cotizacion_COT-32.pdf",
                    "source": "cotizacion",
                    "messageId": "SECRET-ACTIVITY-ID",
                }
            ],
            "evidence": {
                "messageCount": 1,
                "incomingCount": 0,
                "outgoingCount": 1,
                "lastIncomingAt": None,
                "lastOutgoingAt": "2026-09-01T10:15:00-05:00",
                "customerRepliedAfterLastOutgoing": False,
                "quoteDelivery": {
                    "at": "2026-09-01T10:14:00-05:00",
                    "state": "SENT",
                    "reference": "COT-32",
                    "filename": "Cotizacion_COT-32.pdf",
                },
                "customerRepliedAfterQuote": False,
            },
        }
        client = WhatsAppConversationClient("https://bridge.example.invalid", timeout=8)
        with patch.object(client.http, "get", return_value=response) as get:
            result = client.context(
                "32",
                source_detail(),
                session_token="session-secret",
                client_meta={
                    "dispositivoId": "device-1",
                    "dispositivoNombre": "iPhone de Alejandro",
                    "plataforma": "iOS",
                    "navegador": "Safari",
                },
                now=self.now,
            )
        self.assertTrue(result["available"])
        raw = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("3001112233", raw)
        self.assertNotIn("karen@example.com", raw)
        self.assertNotIn("SECRET-MESSAGE-ID", raw)
        self.assertNotIn("SECRET-ACTIVITY-ID", raw)
        self.assertIn("[teléfono omitido]", raw)
        self.assertIn("[correo omitido]", raw)
        request = get.call_args
        self.assertEqual(request.kwargs["params"]["reference"], "COT-32")
        self.assertEqual(request.kwargs["headers"]["X-HomeEasy-Session"], "session-secret")
        self.assertEqual(request.kwargs["headers"]["X-HomeEasy-Device-Id"], "device-1")

    def test_invalid_phone_fails_closed_without_network(self):
        client = WhatsAppConversationClient("https://bridge.example.invalid")
        detail = source_detail()
        detail["cliente"]["telefono"] = "#ERROR!"
        with patch.object(client.http, "get") as get:
            result = client.context(
                "32",
                detail,
                session_token="session-secret",
                client_meta={"dispositivoId": "device-1"},
                now=self.now,
            )
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "MISSING_OR_INVALID_PHONE")
        get.assert_not_called()


class FollowupWhatsAppIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 3, 15, 0, tzinfo=HOME_EASY_TIMEZONE)
        self.ctx = AuthContext(
            "test-user",
            "Usuario Prueba",
            "user@example.invalid",
            "ADMIN",
            frozenset({"app.access", "cotizaciones.read"}),
        )

    def test_confirmed_quote_silence_reaches_model_as_no_response_evidence(self):
        ai = FakeOpenAI(no_response_plan())
        whatsapp = SequenceWhatsAppClient([silent_whatsapp()])
        planner = FollowupPlanner(
            SequenceFollowupClient([source_detail()]),
            ai,
            whatsapp,
        )
        result = planner.plan(
            "32",
            self.ctx,
            session_token="session-secret",
            client_meta={"dispositivoId": "device-1"},
            now=self.now,
        )
        self.assertEqual(result["stage"], "10C2")
        self.assertEqual(result["plan"]["decision"], "SEND")
        self.assertEqual(result["plan"]["intent"], "NO_RESPONSE")
        self.assertEqual(result["model"], "deterministic-guard")
        self.assertEqual(len(ai.responses.calls), 0)
        self.assertEqual(len(whatsapp.calls), 1)
        self.assertIn("Karen", result["plan"]["message"])
        self.assertIn("propuesta", result["plan"]["message"].lower())
        self.assertIn("ajustar o comparar", result["plan"]["message"])

    def test_new_whatsapp_reply_discards_stale_plan(self):
        planner = FollowupPlanner(
            SequenceFollowupClient([source_detail(), source_detail()]),
            FakeOpenAI(no_response_plan()),
            SequenceWhatsAppClient([with_reply(), silent_whatsapp()]),
        )
        with self.assertRaises(FollowupPlanError) as raised:
            planner.plan(
                "32",
                self.ctx,
                session_token="session-secret",
                client_meta={"dispositivoId": "device-1"},
                now=self.now,
            )
        self.assertEqual(raised.exception.code, "FOLLOWUP_STATE_CHANGED")
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
