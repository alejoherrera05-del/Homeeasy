from __future__ import annotations

import unittest
from datetime import datetime
from types import SimpleNamespace

from hommy_backend.auth import AuthContext
from hommy_backend.followup_experience import (
    build_followup_history,
    followup_attempt_count,
    has_unverified_payment_completion_claim,
    infer_conversation_style,
    natural_product_subject,
)
from hommy_backend.periods import HOME_EASY_TIMEZONE


class FollowupExperienceUnitTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 3, 20, 0, tzinfo=HOME_EASY_TIMEZONE)

    def test_preserves_observed_honorific_and_usted_register(self):
        quote = {"firstName": "Sandra"}
        whatsapp = {
            "messages": [
                {"direction": "OUTGOING", "text": "Hola doña Sandra, ¿cómo está? Si quiere revisamos la propuesta."},
                {"direction": "INCOMING", "text": "Muchas gracias."},
            ]
        }
        style = infer_conversation_style(quote, whatsapp)
        self.assertEqual(style["preferredAddress"], "doña Sandra")
        self.assertTrue(style["honorificObserved"])
        self.assertEqual(style["register"], "USTED")

    def test_never_invents_honorific(self):
        quote = {"firstName": "Karen"}
        whatsapp = {"messages": [{"direction": "OUTGOING", "text": "Hola Karen 😊 ¿alcanzaste a revisar la propuesta?"}]}
        style = infer_conversation_style(quote, whatsapp)
        self.assertEqual(style["preferredAddress"], "Karen")
        self.assertFalse(style["honorificObserved"])

    def test_storage_style_product_is_humanized(self):
        self.assertEqual(natural_product_subject("1 x Cortina onda serena 2.8 /"), "Cortina onda serena 2.8")
        self.assertEqual(natural_product_subject("1 x Sala / 1 x Habitación /"), "")

    def test_waiting_for_payday_does_not_prove_payment_happened(self):
        context = {
            "quote": {"manualNote": "Que sí compraría, pero que esperara a la quincena."},
            "timeline": [],
            "whatsapp": {"messages": [{"direction": "INCOMING", "text": "Estamos esperando a que nos paguen la quincena, sí nos interesa."}]},
        }
        self.assertTrue(has_unverified_payment_completion_claim(
            "Hola doña Sandra. Como ya les pagaron la quincena, quería saber cuándo podemos iniciar.",
            context,
        ))
        self.assertFalse(has_unverified_payment_completion_claim(
            "Hola doña Sandra. Paso por aquí para retomar la propuesta que habíamos dejado pendiente.",
            context,
        ))

    def test_attempt_count_recovers_from_timeline_if_snapshot_was_not_incremented(self):
        context = {
            "followup": {"attempts": 0},
            "timeline": [
                {"eventType": "QUOTE_CREATED", "channel": "SYSTEM"},
                {"eventType": "MESSAGE_SENT", "channel": "WHATSAPP"},
            ],
        }
        self.assertEqual(followup_attempt_count(context), 1)

    def test_history_combines_homeeasy_and_whatsapp_without_pii_fields(self):
        detail = {
            "timeline": [
                {"fecha": "2026-08-31T18:17:13-05:00", "actorType": "SYSTEM", "eventType": "QUOTE_CREATED", "channel": "SYSTEM", "text": "Cotización COT-32 creada."},
                {"fecha": "2026-09-03T19:12:20-05:00", "actorType": "HUMAN", "eventType": "MESSAGE_SENT", "channel": "WHATSAPP", "text": "Hola Karen, paso por aquí para retomar la propuesta."},
            ]
        }
        whatsapp = {
            "messages": [
                {"at": "2026-09-03T19:12:20-05:00", "direction": "OUTGOING", "text": "Hola Karen, paso por aquí para retomar la propuesta."},
                {"at": "2026-09-03T19:20:00-05:00", "direction": "INCOMING", "text": "Gracias, lo reviso."},
            ],
            "evidence": {"quoteDelivery": {"at": "2026-09-01T10:00:00-05:00"}},
        }
        history = build_followup_history(detail, whatsapp)
        self.assertTrue(any(item["kind"] == "QUOTE_SENT" for item in history))
        self.assertTrue(any(item["kind"] == "INCOMING" for item in history))
        self.assertFalse(any("phone" in item or "email" in item for item in history))


if __name__ == "__main__":
    unittest.main(verbosity=2)
