from __future__ import annotations

import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from hommy_backend.auth import AuthContext
from hommy_backend.followup import FollowupPlanner
from hommy_backend.periods import HOME_EASY_TIMEZONE
from hommy_backend.whatsapp_context import WhatsAppConversationClient, _minimize_bridge_payload


def source_detail(*, version=2, phone="3163197666"):
    return {
        "status": "ok",
        "cotizacion": {
            "numero": "32",
            "fecha": "2026-08-31T18:17:13-05:00",
            "cedula": "SECRET-ID",
            "nombre": "Karen Prueba",
            "descripcion": "Onda Serena 2.8",
            "observaciones": "Sala",
            "total": 1400000,
            "pdfUrl": "https://example.invalid/private.pdf",
            "estado": "COTIZACION",
            "notaManual": "",
        },
        "cliente": {
            "cedula": "SECRET-ID",
            "nombre": "Karen Prueba",
            "telefono": phone,
            "email": "SECRET-EMAIL",
            "direccion": "SECRET-ADDRESS",
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


def bridge_payload(*, incoming=None, outgoing=None, activity=None):
    return {
        "ok": True,
        "messages": (outgoing or []) + (incoming or []),
        "activity": activity or [],
        "evidence": {},
    }


def silent_whatsapp():
    return {
        "available": True,
        "source": "WAHA_WEBJS",
        "messages": [
            {
                "at": "2026-09-01T10:01:00-05:00",
                "direction": "OUTGOING",
                "text": "Quedamos atentos a cualquier duda.",
                "hasMedia": False,
                "media": "",
                "ack": "DELIVERED",
            }
        ],
        "activity": [
            {
                "at": "2026-09-01T10:00:00-05:00",
                "state": "SENT",
                "documentType": "cotizacion",
                "reference": "COT-32",
                "referenceMatch": True,
                "filename": "Cotizacion-COT-32.pdf",
                "source": "cotizaciones",
            }
        ],
        "evidence": {
            "messageCount": 1,
            "incomingCount": 0,
            "outgoingCount": 1,
            "lastIncomingAt": None,
            "lastOutgoingAt": "2026-09-01T10:01:00-05:00",
            "hoursSinceLastOutgoing": 52.0,
            "customerRepliedAfterLastOutgoing": False,
            "quoteDelivery": {
                "at": "2026-09-01T10:00:00-05:00",
                "state": "SENT",
                "reference": "COT-32",
                "filename": "Cotizacion-COT-32.pdf",
            },
            "customerRepliedAfterQuote": False,
        },
    }


def replied_whatsapp():
    data = silent_whatsapp()
    data["messages"].append(
        {
            "at": "2026-09-03T13:58:00-05:00",
            "direction": "INCOMING",
            "text": "Lo reviso esta tarde.",
            "hasMedia": False,
            "media": "",
            "ack": "",
        }
    )
    data["evidence"].update(
        {
            "messageCount": 2,
            "incomingCount": 1,
            "lastIncomingAt": "2026-09-03T13:58:00-05:00",
            "customerRepliedAfterLastOutgoing": True,
            "customerRepliedAfterQuote": True,
        }
    )
    return data


def no_response_plan():
    return {
        "decision": "SEND",
        "reasonCode": "FOLLOWUP_DUE",
        "intent": "NO_RESPONSE",
        "temperature": "ACTIVE",
        "summary": "La cotización fue enviada y no existe respuesta posterior.",
        "objective": "Retomar sin presión.",
        "message": "Hola Karen 😊 Quería saber si alcanzaste a revisar la propuesta. ¿Hay algo que quieras ajustar o comparar?",
        "nextActionAt": None,
        "confidence": 0.9,
        "needsHumanReview": False,
        "stopReason": None,
        "explanation": "Existe evidencia de envío y silencio posterior.",
    }


class FakeResponses:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        import json
        return SimpleNamespace(output_text=json.dumps(self.payload, ensure_ascii=False))


class FakeOpenAI:
    def __init__(self, payload):
        self.responses = FakeResponses(payload)


class SequenceFollowupClient:
    def __init__(self, values):
        self.values = list(values)
        self.calls = []

    def detail(self, quote_number, **kwargs):
        self.calls.append((quote_number, kwargs))
        if not self.values:
            raise AssertionError("Unexpected detail call")
        return self.values.pop(0)


class SequenceWhatsAppClient:
    def __init__(self, values):
        self.values = list(values)
        self.calls = []

    def context(self, quote_number, detail, **kwargs):
        self.calls.append((quote_number, detail, kwargs))
        if not self.values:
            raise AssertionError("Unexpected WhatsApp context call")
        return self.values.pop(0)


class WhatsAppContextClientTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 3, 14, 0, tzinfo=HOME_EASY_TIMEZONE)

    def test_bridge_payload_is_minimized_and_contact_data_is_redacted(self):
        payload = {
            "ok": True,
            "phone": "573163197666",
            "messages": [
                {
                    "timestamp": 1788271200,
                    "fromMe": True,
                    "body": "Mi correo es test@example.com y mi teléfono 316 319 7666.",
                    "ack": "DELIVERED",
                }
            ],
            "activity": [],
            "evidence": {
                "messageCount": 1,
                "incomingCount": 0,
                "outgoingCount": 1,
                "lastOutgoingAt": "2026-09-01T10:00:00-05:00",
            },
        }
        minimized = _minimize_bridge_payload(payload, now=self.now)
        self.assertNotIn("test@example.com", str(minimized))
        self.assertNotIn("316 319 7666", str(minimized))
        self.assertNotIn("573163197666", str(minimized))
        self.assertTrue(minimized["available"])

    def test_invalid_phone_fails_closed_without_network(self):
        detail = source_detail(phone="#ERROR!")
        client = WhatsAppConversationClient("https://bridge.example.invalid")
        with patch.object(client.http, "get") as get:
            result = client.context("32", detail, session_token="session", client_meta={"dispositivoId": "d1"}, now=self.now)
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "MISSING_OR_INVALID_PHONE")
        get.assert_not_called()


class FollowupWhatsAppIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 3, 14, 0, tzinfo=HOME_EASY_TIMEZONE)
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
        self.assertEqual(result["stage"], "10E")
        self.assertEqual(result["plan"]["decision"], "SEND")
        self.assertEqual(result["plan"]["intent"], "NO_RESPONSE")
        self.assertEqual(result["model"], "deterministic-guard")
        self.assertEqual(len(ai.responses.calls), 0)
        self.assertEqual(len(whatsapp.calls), 1)
        self.assertIn("Karen", result["plan"]["message"])
        self.assertIn("propuesta", result["plan"]["message"].lower())
        self.assertIn("ajustar o comparar", result["plan"]["message"])

    def test_new_whatsapp_reply_discards_stale_plan(self):
        source = source_detail()
        source["seguimiento"]["intencion"] = "EVALUATING"
        source["timeline"].append(
            {
                "fecha": "2026-09-02T10:00:00-05:00",
                "actorType": "HUMAN",
                "eventType": "MANUAL_NOTE",
                "channel": "APP",
                "text": "Cliente está evaluando una alternativa.",
                "intencion": "EVALUATING",
                "temperatura": "ACTIVE",
                "estado": "ACTIVE",
                "motivo": "",
            }
        )
        whatsapp = SequenceWhatsAppClient([silent_whatsapp(), replied_whatsapp()])
        planner = FollowupPlanner(SequenceFollowupClient([source, source]), FakeOpenAI({
            "decision": "SEND",
            "reasonCode": "FOLLOWUP_DUE",
            "intent": "EVALUATING",
            "temperature": "ACTIVE",
            "summary": "Está evaluando.",
            "objective": "Retomar.",
            "message": "Hola Karen, ¿quieres que revisemos la alternativa que tenías pendiente?",
            "nextActionAt": None,
            "confidence": 0.8,
            "needsHumanReview": False,
            "stopReason": None,
            "explanation": "Hay contexto para retomar.",
        }), whatsapp)
        from hommy_backend.followup import FollowupPlanError
        with self.assertRaises(FollowupPlanError) as raised:
            planner.plan("32", self.ctx, session_token="session-secret", client_meta={"dispositivoId": "device-1"}, now=self.now)
        self.assertEqual(raised.exception.code, "FOLLOWUP_STATE_CHANGED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
