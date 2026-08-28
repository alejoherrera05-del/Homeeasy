from __future__ import annotations

import calendar
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


try:
    HOME_EASY_TIMEZONE = ZoneInfo("America/Bogota")
except ZoneInfoNotFoundError:  # Windows runtimes may not bundle the IANA database.
    HOME_EASY_TIMEZONE = timezone(timedelta(hours=-5), name="America/Bogota")

MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}

MONTH_LABELS = (
    "",
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip().lower())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def _today(now: date | datetime | None = None) -> date:
    if now is None:
        return datetime.now(HOME_EASY_TIMEZONE).date()
    if isinstance(now, datetime):
        if now.tzinfo is None:
            return now.date()
        return now.astimezone(HOME_EASY_TIMEZONE).date()
    return now


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


@dataclass(frozen=True)
class ResolvedPeriod:
    key: str
    label: str
    start: date
    end: date
    is_to_date: bool = False

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def as_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "label": self.label,
            "fecha_inicio": self.start.isoformat(),
            "fecha_fin": self.end.isoformat(),
            "dias": self.days,
            "hasta_hoy": self.is_to_date,
        }


@dataclass(frozen=True)
class MonthComparison:
    current: ResolvedPeriod
    previous_full: ResolvedPeriod
    previous_same_days: ResolvedPeriod


def month_comparison_periods(now: date | datetime | None = None) -> MonthComparison:
    today = _today(now)
    previous_year, previous_month = _previous_month(today.year, today.month)
    previous_last = _month_end(previous_year, previous_month)
    same_day = min(today.day, previous_last.day)
    current = ResolvedPeriod(
        key="este_mes",
        label=f"{MONTH_LABELS[today.month]} {today.year} hasta hoy",
        start=date(today.year, today.month, 1),
        end=today,
        is_to_date=True,
    )
    previous_full = ResolvedPeriod(
        key="mes_pasado",
        label=f"{MONTH_LABELS[previous_month]} {previous_year} completo",
        start=date(previous_year, previous_month, 1),
        end=previous_last,
    )
    previous_same_days = ResolvedPeriod(
        key="mes_pasado_mismos_dias",
        label=f"{MONTH_LABELS[previous_month]} {previous_year}, días 1-{same_day}",
        start=date(previous_year, previous_month, 1),
        end=date(previous_year, previous_month, same_day),
        is_to_date=True,
    )
    return MonthComparison(current, previous_full, previous_same_days)


def resolve_period(expression: str, now: date | datetime | None = None) -> ResolvedPeriod | None:
    """Resolve common Spanish business periods using HomeEasy's Bogotá date.

    The resolver is deliberately deterministic. It returns ``None`` when the
    phrase is not sufficiently clear, leaving the caller free to ask a focused
    follow-up instead of guessing.
    """

    text = _normalize(expression)
    today = _today(now)

    period_markers = {
        key
        for key, pattern in (
            ("manana", r"\bmanana\b"),
            ("ayer", r"\bayer\b"),
            ("hoy", r"\bhoy\b"),
            ("ultimos_dias", r"\bultimos?\s+(?:7|30)\s+dias\b"),
            ("semana_pasada", r"\bsemana\s+(?:pasada|anterior)\b"),
            ("esta_semana", r"\besta\s+semana\b|\bla\s+semana\b(?!\s+(?:pasada|anterior))|\bsemana\s+actual\b"),
            ("trimestre_anterior", r"\btrimestre\s+(?:pasado|anterior)\b"),
            ("este_trimestre", r"\beste\s+trimestre\b|\bel\s+trimestre\b(?!\s+(?:pasado|anterior))|\btrimestre\s+actual\b"),
            ("ano_pasado", r"\b(?:ano|año)\s+(?:pasado|anterior)\b"),
            ("este_ano", r"\beste\s+(?:ano|año)\b|\bel\s+(?:ano|año)\b(?!\s+(?:pasado|anterior))|\b(?:ano|año)\s+actual\b"),
            ("mes_pasado", r"\bmes\s+(?:pasado|anterior)\b"),
            ("este_mes", r"\beste\s+mes\b|\bel\s+mes\b(?!\s+(?:pasado|anterior))|\bmes\s+actual\b"),
        )
        if re.search(pattern, text)
    }
    month_pattern = "|".join(MONTHS)
    period_markers.update(f"mes_nombre:{name}" for name in set(re.findall(rf"\b({month_pattern})\b", text)))
    if len(period_markers) > 1:
        return None

    if re.search(r"\bmanana\b", text):
        target = today + timedelta(days=1)
        return ResolvedPeriod("manana", "mañana", target, target)
    if re.search(r"\bayer\b", text):
        target = today - timedelta(days=1)
        return ResolvedPeriod("ayer", "ayer", target, target)
    if re.search(r"\bhoy\b", text):
        return ResolvedPeriod("hoy", "hoy", today, today, True)

    match = re.search(r"\bultimos?\s+(7|30)\s+dias\b", text)
    if match:
        days = int(match.group(1))
        return ResolvedPeriod(
            f"ultimos_{days}_dias",
            f"últimos {days} días",
            today - timedelta(days=days - 1),
            today,
            True,
        )

    if re.search(r"\bsemana\s+(pasada|anterior)\b", text):
        this_monday = today - timedelta(days=today.weekday())
        start = this_monday - timedelta(days=7)
        return ResolvedPeriod("semana_pasada", "semana pasada", start, start + timedelta(days=6))
    if re.search(r"\b(esta|la)\s+semana\b", text) or re.search(r"\bsemana\s+actual\b", text):
        start = today - timedelta(days=today.weekday())
        return ResolvedPeriod("esta_semana", "esta semana", start, today, True)

    if re.search(r"\btrimestre\s+(pasado|anterior)\b", text):
        current_quarter = (today.month - 1) // 3
        if current_quarter == 0:
            year, quarter = today.year - 1, 3
        else:
            year, quarter = today.year, current_quarter - 1
        month = quarter * 3 + 1
        return ResolvedPeriod(
            "trimestre_anterior",
            "trimestre anterior",
            date(year, month, 1),
            _month_end(year, month + 2),
        )
    if re.search(r"\b(este|el)\s+trimestre\b", text) or re.search(r"\btrimestre\s+actual\b", text):
        month = ((today.month - 1) // 3) * 3 + 1
        return ResolvedPeriod("este_trimestre", "este trimestre", date(today.year, month, 1), today, True)

    if re.search(r"\b(ano|año)\s+(pasado|anterior)\b", text):
        year = today.year - 1
        return ResolvedPeriod("ano_pasado", f"año {year}", date(year, 1, 1), date(year, 12, 31))
    if re.search(r"\b(este|el)\s+(ano|año)\b", text) or re.search(r"\b(ano|año)\s+actual\b", text):
        return ResolvedPeriod("este_ano", f"{today.year} hasta hoy", date(today.year, 1, 1), today, True)

    if re.search(r"\bmes\s+(pasado|anterior)\b", text):
        year, month = _previous_month(today.year, today.month)
        return ResolvedPeriod(
            "mes_pasado",
            f"{MONTH_LABELS[month]} {year}",
            date(year, month, 1),
            _month_end(year, month),
        )
    if re.search(r"\b(este|el)\s+mes\b", text) or re.search(r"\bmes\s+actual\b", text):
        return ResolvedPeriod(
            "este_mes",
            f"{MONTH_LABELS[today.month]} {today.year} hasta hoy",
            date(today.year, today.month, 1),
            today,
            True,
        )

    month_match = re.search(rf"\b({month_pattern})(?:\s+de\s+|\s+)?(20\d{{2}})?\b", text)
    if month_match:
        month_name = month_match.group(1)
        month = MONTHS[month_name]
        explicit_year = month_match.group(2)
        year = int(explicit_year) if explicit_year else today.year
        if not explicit_year and month > today.month:
            year -= 1
        start = date(year, month, 1)
        natural_end = _month_end(year, month)
        if start > today:
            return None
        end = today if year == today.year and month == today.month else natural_end
        return ResolvedPeriod(
            f"mes_{year}_{month:02d}",
            f"{MONTH_LABELS[month]} {year}" + (" hasta hoy" if end == today and natural_end != today else ""),
            start,
            end,
            end == today and natural_end != today,
        )

    return None
