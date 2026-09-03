from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import Mock, patch

from hommy_backend.periods import HOME_EASY_TIMEZONE
from hommy_backend.whatsapp_context import WhatsAppConversationClient


class WhatsAppContextRequestBoundaryTests(unittest.TestCase):
    def test_context_request_sends_quote_reference_not_phone(self):
        detail = {
            "cotizacion": {"numero": "32", "fecha": "2026-08-31T18:17:13-05:00"},
            "cliente": {"telefono": "3001112233"},
            "seguimiento": {"telefono": "3001112233"},
        }
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "ok": True,
            "messages": [],
            "activity": [],
            "evidence": {
                "messageCount": 0,
                "incomingCount": 0,
                "outgoingCount": 0,
                "lastIncomingAt": None,
                "lastOutgoingAt": None,
                "customerRepliedAfterLastOutgoing": False,
                "quoteDelivery": None,
                "customerRepliedAfterQuote": False,
            },
        }
        client = WhatsAppConversationClient("https://bridge.example.invalid", timeout=8)
        with patch.object(client.http, "get", return_value=response) as get:
            result = client.context(
                "32",
                detail,
                session_token="session-secret",
                client_meta={"dispositivoId": "device-1"},
                now=datetime(2026, 9, 3, 15, 0, tzinfo=HOME_EASY_TIMEZONE),
            )

        self.assertTrue(result["available"])
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["reference"], "COT-32")
        self.assertNotIn("phone", params)
        self.assertNotIn("3001112233", str(get.call_args))


if __name__ == "__main__":
    unittest.main()
