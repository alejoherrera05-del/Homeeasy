from __future__ import annotations

import unittest
from datetime import datetime

from hommy_backend.auth import AuthContext
from hommy_backend.followup import FollowupPlanner
from hommy_backend.followup_experience import (
    has_unverified_relationship_claim,
    natural_product_subject,
)
from hommy_backend.periods import HOME_EASY_TIMEZONE


class FakeFollowupClient:
    def __init__(self) -> None:
        self.calls = 0

    def detail(self, quote_number, *, session_token, client_meta, limit_events=20):
        self.calls += 1
        return {
            "status": "ok",
            "cotizacion": {
                "numero": str(quote_number),
                "fecha": "2026-09-01T10:00:00-05:00",
                "nombre": "SANDRA PRUEBA",
                "descripcion": "1 x Cortina onda serena 2.8 /",
                "observaciones": "",
                "total": 1400000,
                "estado": "COTIZACION",
                "notaManual": "La cliente está evaluando la propuesta.",
            },
            "seguimiento": {
                "modo": "REVIEW",
                "estado": "ACTIVE",
                "intencion": "EVALUATING",
                "temperatura": "ACTIVE",
                "estadoVersion": 4,
                "intentosSeguimiento": 0,
            },
            "timeline": [],
            "timelineTotal": 0,
        }


class FakeWhatsAppClient:
    def __init__(self) -> None:
        self.calls = 0

    def context(self, quote_number, detail, *, session_token, client_meta, now=None):
        self.calls += 1
        return {
            "available": True,
            "reason": "",
            "messages": [
                {
                    "at": "2026-09-01T12:00:00-05:00",
                    "direction": "INCOMING",
                    "text": "Gracias, la estamos revisando.",
                }
            ],
            "activity": [],
            "evidence": {
                "messageCount": 1,
                "incomingCount": 1,
                "outgoingCount": 0,
                "lastIncomingAt": "2026-09-01T12:00:00-05:00",
                "lastOutgoingAt": "",
                "customerRepliedAfterLastOutgoing": False,
                "customerRepliedAfterQuote": True,
                "quoteDelivery": None,
            },
        }


class AuditPlanner(FollowupPlanner):
    def _model_plan(self, context, commercial_context):
        return {
            "decision": "SEND",
            "reasonCode": "OTHER",
            "intent": "EVALUATING",
            "temperature": "ACTIVE",
            "summary": "La cliente sigue evaluando la propuesta.",
            "objective": "Retomar de forma breve y consultiva.",
            "message": "Hola Sandra 😊 Paso por aquí para saber si hay algún detalle de la propuesta que quisiera revisar. Quedo pendiente.",
            "nextActionAt": None,
            "confidence": 0.88,
            "needsHumanReview": False,
            "stopReason": None,
            "explanation": "Existe conversación real y no hay una condición de espera o cierre.",
        }


class HommyFollowupAudit10F1Tests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 3, 20, 0, tzinfo=HOME_EASY_TIMEZONE)

    def test_product_brand_names_are_canonicalized(self):
        self.assertEqual(
            natural_product_subject("1 x Cortina onda serena 2.8 /"),
            "Cortina Onda Serena 2.8",
        )
        self.assertEqual(natural_product_subject("1 x sheer elegance"), "Sheer Elegance")
        self.assertEqual(natural_product_subject("1 x enrollable blackout"), "Enrollable Blackout")

    def test_relationship_must_exist_in_evidence(self):
        no_partner = {
            "quote": {"manualNote": "La cliente está interesada."},
            "timeline": [],
            "whatsapp": {"messages": [{"direction": "INCOMING", "text": "Sí, me interesa."}]},
        }
        self.assertTrue(has_unverified_relationship_claim(
            "Hola doña Sandra. Espero que usted y su esposo estén muy bien.",
            no_partner,
        ))

        partner_confirmed = {
            "quote": {"manualNote": ""},
            "timeline": [],
            "whatsapp": {"messages": [{"direction": "INCOMING", "text": "Lo hablamos con mi esposo y sí vamos a contratar."}]},
        }
        self.assertFalse(has_unverified_relationship_claim(
            "Hola doña Sandra. Espero que usted y su esposo estén muy bien.",
            partner_confirmed,
        ))

    def test_review_analysis_reads_homeeasy_and_whatsapp_only_once_even_when_model_is_used(self):
        followup = FakeFollowupClient()
        whatsapp = FakeWhatsAppClient()
        planner = AuditPlanner(
            followup_client=followup,
            whatsapp_client=whatsapp,
            openai_client=object(),
        )
        auth = AuthContext(
            uid="qa-user",
            name="Alejandro QA",
            email="qa@example.invalid",
            role="ADMINISTRADOR",
            permissions=frozenset({"cotizaciones.read", "cotizaciones.write"}),
        )
        result = planner.plan(
            "99",
            auth,
            session_token="session-qa",
            client_meta={"dispositivoId": "qa-device"},
            now=self.now,
        )
        self.assertEqual(result["plan"]["decision"], "SEND")
        self.assertEqual(result["stage"], "10F.1")
        self.assertEqual(followup.calls, 1, "REVIEW analysis should not reread HomeEasy after model work")
        self.assertEqual(whatsapp.calls, 1, "REVIEW analysis should not reread WhatsApp after model work")


if __name__ == "__main__":
    unittest.main(verbosity=2)
