from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Iterable

from .periods import ResolvedPeriod


_CANCELLED_STATES = {
    "anulada",
    "anulado",
    "cancelada",
    "cancelado",
    "reversada",
    "reversado",
}


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip().casefold())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def money_number(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().replace("$", "").replace(" ", "")
    if not text:
        return 0.0
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    if "." in text and "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif text.count(".") > 1 or ("." in text and all(len(part) == 3 for part in text.split(".")[1:])):
        text = text.replace(".", "")
    elif text.count(",") > 1 or ("," in text and all(len(part) == 3 for part in text.split(",")[1:])):
        text = text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        number = float(re.sub(r"[^0-9.\-]", "", text))
    except ValueError:
        return 0.0
    return -number if negative else number


def parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    for fmt in (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y/%m/%d",
        "%d/%m/%y",
        "%Y-%m-%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def normalize_op_number(value: Any) -> str:
    text = normalize_text(value)
    text = re.sub(r"^op[\s#_\-]*", "", text).strip()
    digits = re.sub(r"\D", "", text)
    if digits:
        return str(int(digits))
    return re.sub(r"\s+", "", text).upper()


def optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    text = normalize_text(value)
    if not text:
        return None
    if text in {"1", "si", "s", "true", "verdadero", "yes", "activo", "aplica"}:
        return True
    if text in {"0", "no", "n", "false", "falso", "inactivo", "no aplica"}:
        return False
    return None


def is_cancelled(value: Any) -> bool:
    state = normalize_text(value)
    return state in _CANCELLED_STATES or any(token in state for token in ("anulad", "cancelad", "reversad"))


def _optional_money(value: Any) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    return int(round(money_number(value)))


def _payment_is_initial(payment: dict[str, Any]) -> bool:
    payment_type = normalize_text(payment.get("tipo_registro"))
    return "inicial" in payment_type or "anticipo" in payment_type


def _payment_affects_balance(payment: dict[str, Any]) -> bool:
    if payment.get("anulacion_id"):
        return False
    if is_cancelled(payment.get("estado_registro")):
        return False
    affects = optional_bool(payment.get("afecta_saldo"))
    return affects is not False


def _payment_key(payment: dict[str, Any]) -> tuple[Any, ...]:
    receipt = normalize_text(payment.get("recibo"))
    if receipt:
        return ("recibo", receipt)
    return (
        "fallback",
        str(payment.get("fecha") or ""),
        int(round(money_number(payment.get("valor")))),
        normalize_text(payment.get("tipo_registro")),
    )


def reconcile_order(
    order: dict[str, Any],
    payments: Iterable[dict[str, Any]] | None = None,
    *,
    tolerance_cop: int = 1,
) -> dict[str, Any]:
    """Return a deterministic financial view without mutating the source order."""

    result = dict(order)
    total = max(0, int(round(money_number(order.get("total_cop", order.get("total"))))))
    initial_raw = int(round(money_number(order.get("abono_inicial_cop", order.get("abono_inicial")))))
    initial_valid = not is_cancelled(order.get("estado_abono_inicial"))
    initial_affects = optional_bool(order.get("abono_inicial_afecta_saldo")) is not False
    initial = max(0, initial_raw) if initial_valid and initial_affects else 0

    source_payments = list(payments if payments is not None else (order.get("abonos_extra") or []))
    valid_payments: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    extra_total = 0
    for payment in source_payments:
        if not isinstance(payment, dict) or _payment_is_initial(payment) or not _payment_affects_balance(payment):
            continue
        key = _payment_key(payment)
        if key in seen:
            continue
        seen.add(key)
        item = dict(payment)
        amount = int(round(money_number(payment.get("valor_cop", payment.get("valor")))))
        item["valor_cop"] = amount
        valid_payments.append(item)
        extra_total += amount

    extra_total = max(0, extra_total)
    paid_total = max(0, initial + extra_total)
    calculated_balance = max(total - paid_total, 0)
    explicit_source = order.get("saldo_explicito_cop")
    if explicit_source is None:
        explicit_source = order.get("saldo_explicito", order.get("saldo"))
    explicit_balance = _optional_money(explicit_source)

    warnings: list[str] = []
    if explicit_balance is not None and abs(explicit_balance - calculated_balance) > max(0, tolerance_cop):
        warnings.append("El saldo explícito no coincide con total menos abonos válidos.")
    if paid_total > total and total > 0:
        warnings.append("Los abonos válidos superan el total de la orden.")

    embedded = [
        int(round(money_number(value)))
        for value in (order.get("abonos_legacy") or [])
        if str(value or "").strip()
    ]
    embedded_total = sum(embedded)
    if embedded_total and embedded_total != extra_total:
        warnings.append("Los abonos legacy de la OP difieren del registro canónico de Abonos.")

    cancelled = is_cancelled(order.get("estado")) or bool(str(order.get("anulacion_id") or "").strip())
    if cancelled:
        financial_state = "ANULADO"
    elif warnings:
        financial_state = "REVISAR"
    elif total > 0 and calculated_balance == 0:
        financial_state = "PAGADO"
    elif paid_total > 0:
        financial_state = "ABONADO"
    else:
        financial_state = "PENDIENTE"

    result.update(
        {
            "numero": normalize_op_number(order.get("numero")),
            "total_cop": total,
            "abono_inicial_cop": initial,
            "abonos_extra_cop": extra_total,
            "abonado_total_cop": paid_total,
            "saldo_calculado_cop": calculated_balance,
            "saldo_explicito_cop": explicit_balance,
            "saldo_cop": calculated_balance,
            "estado_financiero": financial_state,
            "integrity_ok": not warnings,
            "integrity_warnings": warnings,
            "abonos_extra": valid_payments,
        }
    )
    return result


def _period_rows(rows: Iterable[dict[str, Any]], period: ResolvedPeriod) -> list[dict[str, Any]]:
    selected = []
    for row in rows:
        if (
            is_cancelled(row.get("estado"))
            or str(row.get("anulacion_id") or "").strip()
            or normalize_text(row.get("estado_financiero")) == "anulado"
        ):
            continue
        day = parse_date(row.get("fecha"))
        if day and period.start <= day <= period.end:
            selected.append(dict(row))
    return selected


def _top_client(rows: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    groups: dict[str, dict[str, Any]] = defaultdict(lambda: {"total_cop": 0, "ordenes": 0, "nombre": "", "cedula": ""})
    for row in rows:
        key = normalize_text(row.get("cedula")) or normalize_text(row.get("nombre"))
        if not key:
            continue
        bucket = groups[key]
        bucket["total_cop"] += int(round(money_number(row.get("total_cop", row.get("total")))))
        bucket["ordenes"] += 1
        bucket["nombre"] = str(row.get("nombre") or "")
        bucket["cedula"] = str(row.get("cedula") or "")
    return max(groups.values(), key=lambda item: (item["total_cop"], item["ordenes"]), default=None)


def summarize_sales(
    orders: Iterable[dict[str, Any]],
    period: ResolvedPeriod,
    *,
    data_updated_at: str = "",
) -> dict[str, Any]:
    selected = [reconcile_order(row) for row in _period_rows(orders, period)]
    total = sum(row["total_cop"] for row in selected)
    paid = sum(row["abonado_total_cop"] for row in selected)
    balance = sum(row["saldo_cop"] for row in selected if row["estado_financiero"] != "ANULADO")
    largest = max(selected, key=lambda row: (row["total_cop"], parse_date(row.get("fecha")) or date.min), default=None)
    return {
        "periodo": period.as_dict(),
        "cantidad": len(selected),
        "total_vendido": total,
        "total_abonado": paid,
        "saldo_pendiente": balance,
        "ticket_promedio": round(total / len(selected)) if selected else 0,
        "venta_mayor": None
        if not largest
        else {
            "numero": largest.get("numero", ""),
            "fecha": largest.get("fecha", ""),
            "nombre": largest.get("nombre", ""),
            "total_cop": largest["total_cop"],
        },
        "cliente_mayor_compra": _top_client(selected),
        "datos_actualizados": data_updated_at,
        "ordenes": selected,
    }


def percentage_change(current: int | float, previous: int | float) -> float | None:
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 2)


def compare_sales(
    current: dict[str, Any],
    previous_full: dict[str, Any],
    previous_same_days: dict[str, Any],
) -> dict[str, Any]:
    current_total = int(current.get("total_vendido") or 0)
    previous_total = int(previous_full.get("total_vendido") or 0)
    previous_mtd_total = int(previous_same_days.get("total_vendido") or 0)
    delta = current_total - previous_total
    delta_mtd = current_total - previous_mtd_total
    if delta_mtd > 0:
        trend = "SUBIO"
    elif delta_mtd < 0:
        trend = "BAJO"
    else:
        trend = "IGUAL"
    return {
        "periodo_actual": current,
        "periodo_anterior_completo": previous_full,
        "periodo_anterior_mismos_dias": previous_same_days,
        "variacion_cop": delta,
        "variacion_pct": percentage_change(current_total, previous_total),
        "variacion_mismos_dias_cop": delta_mtd,
        "variacion_mismos_dias_pct": percentage_change(current_total, previous_mtd_total),
        "diferencia_ticket_promedio": int(current.get("ticket_promedio") or 0)
        - int(previous_same_days.get("ticket_promedio") or 0),
        "tendencia": trend,
        "datos_actualizados": current.get("datos_actualizados", ""),
    }


def quote_sort_key(quote: dict[str, Any]) -> tuple[date, int, str]:
    number_text = str(quote.get("numero") or "")
    digits = re.sub(r"\D", "", number_text)
    return parse_date(quote.get("fecha")) or date.min, int(digits or 0), number_text


def summarize_quotes(
    quotes: Iterable[dict[str, Any]],
    period: ResolvedPeriod,
    *,
    data_updated_at: str = "",
) -> dict[str, Any]:
    selected = _period_rows(quotes, period)
    selected.sort(key=quote_sort_key, reverse=True)
    total = sum(int(round(money_number(row.get("total")))) for row in selected)
    return {
        "periodo": period.as_dict(),
        "cantidad": len(selected),
        "total_cotizado": total,
        "ticket_promedio": round(total / len(selected)) if selected else 0,
        "ultima_cotizacion": selected[0] if selected else None,
        "datos_actualizados": data_updated_at,
    }
