import os
import unittest

from hommy_backend.auth import AuthContext
from hommy_backend.realtime import session_config
from hommy_backend.tools import execute_tool


class StubData:
    def recent_sales(self, limit=5):
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
        documents = [card for card in result["ui"] if card.get("type") == "document"]
        self.assertEqual(documents[0]["title"], "OP 38 · Ver documento")

    def test_realtime_defaults_to_cedar_and_less_eager_turn_detection(self):
        previous = os.environ.pop("HOMMY_REALTIME_VOICE", None)
        try:
            config = session_config(self.context)
        finally:
            if previous is not None:
                os.environ["HOMMY_REALTIME_VOICE"] = previous
        self.assertEqual(config["audio"]["output"]["voice"], "cedar")
        vad = config["audio"]["input"]["turn_detection"]
        self.assertEqual(vad["type"], "server_vad")
        self.assertGreaterEqual(vad["threshold"], 0.65)
        self.assertGreaterEqual(vad["silence_duration_ms"], 900)
        self.assertTrue(vad["interrupt_response"])
        self.assertIn("PESOS COLOMBIANOS", config["instructions"])
        self.assertIn("consultar_historial_pagos", config["instructions"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
