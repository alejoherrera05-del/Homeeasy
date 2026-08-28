import unittest
from datetime import date

from hommy_backend.auth import AuthContext
from hommy_backend.engine import HommyEngine
from hommy_backend.periods import resolve_period
from hommy_backend.tools import TOOL_SPECS


NOW = date(2026, 8, 28)

# Synthetic, deterministic routing contract. It is intentionally network-free;
# a separate optional model evaluation can consume the same corpus in staging.
INTENT_CASES = [
    ("cuánto llevo vendido este mes", "analizar_ventas_periodo", "este_mes"),
    ("cuánto vendí el mes pasado", "analizar_ventas_periodo", "mes_pasado"),
    ("cuánto vendimos hoy", "analizar_ventas_periodo", "hoy"),
    ("cuántas ventas hicimos esta semana", "analizar_ventas_periodo", "esta_semana"),
    ("ventas de los últimos 7 días", "analizar_ventas_periodo", "ultimos_7_dias"),
    ("ventas de los últimos 30 días", "analizar_ventas_periodo", "ultimos_30_dias"),
    ("ventas de julio", "analizar_ventas_periodo", "mes_2026_07"),
    ("compara este mes con el anterior", "comparar_periodos_ventas", "este_mes"),
    ("voy mejor o peor este mes", "comparar_periodos_ventas", "este_mes"),
    ("cuál fue la última venta", "obtener_ultimas_ventas", None),
    ("muéstrame las últimas cinco ventas", "obtener_ultimas_ventas", None),
    ("cuál es el saldo de OP 38", "consultar_historial_pagos", None),
    ("cuánto ha abonado la OP 38", "consultar_historial_pagos", None),
    ("quién me debe más", "consultar_saldos_pendientes", None),
    ("cuánto me deben", "consultar_saldos_pendientes", None),
    ("cuál fue nuestra última cotización", "consultar_ultima_cotizacion", None),
    ("muéstrame las últimas cinco cotizaciones", "consultar_cotizaciones", None),
    ("cuánto hemos cotizado este mes", "analizar_cotizaciones", "este_mes"),
    ("cotizaciones de julio", "consultar_cotizaciones", "mes_2026_07"),
    ("qué cotizó Cliente Prueba", "consultar_cotizaciones", None),
    ("busca a Cliente Prueba", "buscar_cliente", None),
    ("qué ha comprado Cliente Prueba", "consultar_historial_cliente", None),
    ("qué tengo hoy", "consultar_agenda", "hoy"),
    ("qué tengo mañana", "consultar_agenda", "manana"),
    ("qué visitas hay esta semana", "consultar_agenda", "esta_semana"),
    ("cómo va HomeEasy este mes", "analizar_ventas_periodo", "este_mes"),
    ("dame un resumen del negocio", "obtener_resumen_negocio", None),
]


class HommyIntentContractTests(unittest.TestCase):
    def test_expected_tools_exist_in_the_permission_filtered_catalog(self):
        declared = {tool["name"] for tool in TOOL_SPECS}
        for prompt, expected_tool, _ in INTENT_CASES:
            with self.subTest(prompt=prompt):
                self.assertIn(expected_tool, declared)

    def test_temporal_intents_resolve_without_model_date_math(self):
        for prompt, _, expected_period in INTENT_CASES:
            if expected_period is None:
                continue
            with self.subTest(prompt=prompt):
                period = resolve_period(prompt, now=NOW)
                self.assertIsNotNone(period)
                self.assertEqual(period.key, expected_period)

    def test_engine_instructions_name_high_level_routes(self):
        context = AuthContext(
            "uid-test", "Usuario Prueba", "test@example.com", "TEST", frozenset({"app.access"})
        )
        instructions = HommyEngine.instructions(context)
        for tool_name in (
            "analizar_ventas_periodo",
            "comparar_periodos_ventas",
            "consultar_ultima_cotizacion",
            "consultar_cotizaciones",
            "analizar_cotizaciones",
        ):
            self.assertIn(tool_name, instructions)


if __name__ == "__main__":
    unittest.main(verbosity=2)
