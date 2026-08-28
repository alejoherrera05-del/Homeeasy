import unittest
from datetime import date, datetime, timezone

from hommy_backend.periods import month_comparison_periods, resolve_period


NOW = date(2026, 8, 28)


class HommyPeriodResolverTests(unittest.TestCase):
    def assert_period(self, phrase, start, end, key=None, now=NOW):
        period = resolve_period(phrase, now=now)
        self.assertIsNotNone(period, phrase)
        self.assertEqual(period.start, date.fromisoformat(start))
        self.assertEqual(period.end, date.fromisoformat(end))
        if key:
            self.assertEqual(period.key, key)

    def test_relative_business_periods(self):
        cases = [
            ("¿Cuánto vendimos hoy?", "2026-08-28", "2026-08-28", "hoy"),
            ("¿Qué tengo mañana?", "2026-08-29", "2026-08-29", "manana"),
            ("ventas de ayer", "2026-08-27", "2026-08-27", "ayer"),
            ("esta semana", "2026-08-24", "2026-08-28", "esta_semana"),
            ("semana pasada", "2026-08-17", "2026-08-23", "semana_pasada"),
            ("la semana pasada", "2026-08-17", "2026-08-23", "semana_pasada"),
            ("este mes", "2026-08-01", "2026-08-28", "este_mes"),
            ("mes anterior", "2026-07-01", "2026-07-31", "mes_pasado"),
            ("vendí el mes pasado", "2026-07-01", "2026-07-31", "mes_pasado"),
            ("este trimestre", "2026-07-01", "2026-08-28", "este_trimestre"),
            ("trimestre anterior", "2026-04-01", "2026-06-30", "trimestre_anterior"),
            ("el trimestre pasado", "2026-04-01", "2026-06-30", "trimestre_anterior"),
            ("este año", "2026-01-01", "2026-08-28", "este_ano"),
            ("año pasado", "2025-01-01", "2025-12-31", "ano_pasado"),
            ("el año pasado", "2025-01-01", "2025-12-31", "ano_pasado"),
            ("últimos 7 días", "2026-08-22", "2026-08-28", "ultimos_7_dias"),
            ("ultimos 30 dias", "2026-07-30", "2026-08-28", "ultimos_30_dias"),
        ]
        for phrase, start, end, key in cases:
            with self.subTest(phrase=phrase):
                self.assert_period(phrase, start, end, key)

    def test_month_names_and_years(self):
        self.assert_period("agosto", "2026-08-01", "2026-08-28")
        self.assert_period("agosto de 2026", "2026-08-01", "2026-08-28")
        self.assert_period("julio", "2026-07-01", "2026-07-31")
        self.assert_period("enero de 2025", "2025-01-01", "2025-01-31")

    def test_future_month_name_without_year_uses_previous_year(self):
        self.assert_period("ventas de diciembre", "2025-12-01", "2025-12-31")

    def test_december_to_january_rollover(self):
        self.assert_period(
            "mes pasado",
            "2026-12-01",
            "2026-12-31",
            now=date(2027, 1, 8),
        )
        self.assert_period(
            "trimestre anterior",
            "2026-10-01",
            "2026-12-31",
            now=date(2027, 1, 8),
        )

    def test_month_to_date_comparison_uses_same_number_of_days(self):
        comparison = month_comparison_periods(NOW)
        self.assertEqual(comparison.current.start, date(2026, 8, 1))
        self.assertEqual(comparison.current.end, NOW)
        self.assertEqual(comparison.previous_full.end, date(2026, 7, 31))
        self.assertEqual(comparison.previous_same_days.end, date(2026, 7, 28))
        self.assertEqual(comparison.current.days, comparison.previous_same_days.days)

    def test_same_days_clamps_to_shorter_previous_month(self):
        comparison = month_comparison_periods(date(2026, 3, 31))
        self.assertEqual(comparison.previous_same_days.end, date(2026, 2, 28))

    def test_aware_datetime_is_converted_to_bogota_date(self):
        utc_now = datetime(2026, 8, 29, 3, 0, tzinfo=timezone.utc)
        period = resolve_period("hoy", now=utc_now)
        self.assertEqual(period.start, date(2026, 8, 28))

    def test_ambiguous_or_future_explicit_period_is_not_guessed(self):
        self.assertIsNone(resolve_period("cuando puedas", now=NOW))
        self.assertIsNone(resolve_period("diciembre de 2027", now=NOW))

    def test_multiple_explicit_days_are_rejected_as_ambiguous(self):
        self.assertIsNone(resolve_period("hoy y ayer", now=NOW))
        self.assertIsNone(resolve_period("enero o febrero", now=NOW))
        self.assertIsNone(resolve_period("esta semana o mes pasado", now=NOW))


if __name__ == "__main__":
    unittest.main(verbosity=2)
