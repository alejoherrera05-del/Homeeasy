import unittest
from datetime import date

from hommy_backend.analytics import (
    compare_sales,
    normalize_op_number,
    percentage_change,
    quote_sort_key,
    reconcile_order,
    summarize_quotes,
    summarize_sales,
)
from hommy_backend.periods import ResolvedPeriod


class FinancialReconciliationTests(unittest.TestCase):
    def test_partial_payment_matches_requested_business_example(self):
        result = reconcile_order(
            {
                "numero": "OP 38",
                "total": "$2.900.000",
                "abono_inicial": "$1.450.000",
                "saldo": "$1.450.000",
                "estado": "ACTIVO",
            }
        )
        self.assertEqual(result["numero"], "38")
        self.assertEqual(result["total_cop"], 2_900_000)
        self.assertEqual(result["abonado_total_cop"], 1_450_000)
        self.assertEqual(result["saldo_cop"], 1_450_000)
        self.assertEqual(result["estado_financiero"], "ABONADO")
        self.assertTrue(result["integrity_ok"])

    def test_extra_payments_are_deduplicated_and_invalid_rows_are_ignored(self):
        payments = [
            {"recibo": "R1", "valor": "$250.000", "estado_registro": "ACTIVO", "afecta_saldo": "SI"},
            {"recibo": "R1", "valor": "$250.000", "estado_registro": "ACTIVO", "afecta_saldo": "SI"},
            {"recibo": "R2", "valor": "$500.000", "estado_registro": "ANULADO", "afecta_saldo": "SI"},
            {"recibo": "R3", "valor": "$500.000", "estado_registro": "ACTIVO", "afecta_saldo": "NO"},
        ]
        result = reconcile_order(
            {"numero": "39", "total": 1_000_000, "abono_inicial": 500_000, "saldo": 250_000, "estado": "ACTIVO"},
            payments,
        )
        self.assertEqual(result["abonos_extra_cop"], 250_000)
        self.assertEqual(result["abonado_total_cop"], 750_000)
        self.assertEqual(result["saldo_cop"], 250_000)

    def test_mismatched_explicit_balance_is_never_marked_paid(self):
        result = reconcile_order(
            {"numero": "40", "total": 1_000_000, "abono_inicial": 300_000, "saldo": 0, "estado": "ACTIVO"}
        )
        self.assertFalse(result["integrity_ok"])
        self.assertEqual(result["estado_financiero"], "REVISAR")
        self.assertEqual(result["saldo_cop"], 700_000)

    def test_op_normalization_is_stable(self):
        self.assertEqual({normalize_op_number(value) for value in ("38", "OP38", "OP 38", "op-038")}, {"38"})


class DeterministicAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.period = ResolvedPeriod("este_mes", "agosto 2026", date(2026, 8, 1), date(2026, 8, 28), True)
        self.orders = [
            {"numero": "1", "fecha": "2026-08-10", "cedula": "1", "nombre": "Cliente A", "total": 1_000_000, "abono_inicial": 400_000, "saldo": 600_000, "estado": "ACTIVO"},
            {"numero": "2", "fecha": "2026-08-20", "cedula": "2", "nombre": "Cliente B", "total": 2_000_000, "abono_inicial": 2_000_000, "saldo": 0, "estado": "COMPLETADO"},
            {"numero": "3", "fecha": "2026-08-21", "cedula": "3", "nombre": "Cliente C", "total": 9_000_000, "abono_inicial": 0, "saldo": 9_000_000, "estado": "ANULADO"},
            {"numero": "4", "fecha": "2026-08-22", "cedula": "4", "nombre": "Cliente D", "total": 8_000_000, "abono_inicial": 0, "saldo": 8_000_000, "estado": "ACTIVO", "anulacion_id": "AN-1"},
        ]

    def test_sales_metrics_are_calculated_in_python(self):
        result = summarize_sales(self.orders, self.period, data_updated_at="2026-08-28T10:00:00-05:00")
        self.assertEqual(result["cantidad"], 2)
        self.assertEqual(result["total_vendido"], 3_000_000)
        self.assertEqual(result["total_abonado"], 2_400_000)
        self.assertEqual(result["saldo_pendiente"], 600_000)
        self.assertEqual(result["ticket_promedio"], 1_500_000)
        self.assertEqual(result["venta_mayor"]["numero"], "2")

    def test_percentage_and_comparison_cover_growth_drop_and_zero_base(self):
        self.assertEqual(percentage_change(120, 100), 20.0)
        self.assertEqual(percentage_change(80, 100), -20.0)
        self.assertIsNone(percentage_change(100, 0))
        current = {"total_vendido": 1_200, "ticket_promedio": 600, "datos_actualizados": "x"}
        previous = {"total_vendido": 1_000, "ticket_promedio": 500}
        result = compare_sales(current, previous, previous)
        self.assertEqual(result["variacion_mismos_dias_pct"], 20.0)
        self.assertEqual(result["diferencia_ticket_promedio"], 100)
        self.assertEqual(result["tendencia"], "SUBIO")

    def test_quotes_are_sorted_by_date_then_number_and_summarized(self):
        quotes = [
            {"numero": "103", "fecha": "2026-08-28", "total": 400_000, "estado": "PENDIENTE"},
            {"numero": "104", "fecha": "2026-08-28", "total": 600_000, "estado": "PENDIENTE"},
            {"numero": "200", "fecha": "2026-07-31", "total": 5_000_000, "estado": "PENDIENTE"},
        ]
        self.assertEqual(max(quotes, key=quote_sort_key)["numero"], "104")
        result = summarize_quotes(quotes, self.period)
        self.assertEqual(result["cantidad"], 2)
        self.assertEqual(result["total_cotizado"], 1_000_000)
        self.assertEqual(result["ultima_cotizacion"]["numero"], "104")


if __name__ == "__main__":
    unittest.main(verbosity=2)
