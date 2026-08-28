from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any

from .analytics import money_number, normalize_text, parse_date, reconcile_order
from .auth import AuthContext
from .data import HomeEasyDataError, HomeEasyDataStore
from .periods import ResolvedPeriod, resolve_period


class ToolPermissionError(RuntimeError):
    pass


def fn(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
        "strict": True,
    }


TOOL_SPECS = [
    fn(
        "buscar_cliente",
        "Busca únicamente datos de contacto de un cliente real por nombre, cédula o teléfono. No devuelve historial comercial.",
        {"criterio": {"type": "string"}},
        ["criterio"],
    ),
    fn(
        "consultar_historial_cliente",
        "Consulta compras y/o cotizaciones de un cliente real, filtradas por los permisos del usuario.",
        {"criterio": {"type": "string"}},
        ["criterio"],
    ),
    fn(
        "consultar_orden",
        "Consulta una orden de pedido por OP y reconcilia total, abonos y saldo actual.",
        {"numero_op": {"type": "string"}},
        ["numero_op"],
    ),
    fn(
        "consultar_saldos_pendientes",
        "Obtiene cartera real reconciliada: total, abonado, saldo e integridad financiera por OP.",
        {"limite": {"type": "integer", "minimum": 1, "maximum": 100}},
        ["limite"],
    ),
    fn(
        "consultar_agenda",
        "Consulta la agenda real para una fecha YYYY-MM-DD o un periodo inequívoco como hoy o mañana.",
        {"fecha": {"type": "string"}},
        ["fecha"],
    ),
    fn(
        "obtener_ultimas_ventas",
        "Obtiene las ventas más recientes con OP, total, abonado, saldo y documento integrado.",
        {"cantidad": {"type": "integer", "minimum": 1, "maximum": 20}},
        ["cantidad"],
    ),
    fn(
        "analizar_ventas_periodo",
        "Calcula en Python un reporte ejecutivo de ventas para hoy, esta semana, este mes, mes pasado, este año, últimos 7/30 días o un mes explícito. No pidas fechas si el periodo es inferible.",
        {"periodo": {"type": "string", "description": "Expresión temporal en español, por ejemplo este_mes o julio de 2026."}},
        ["periodo"],
    ),
    fn(
        "comparar_periodos_ventas",
        "Compara el mes actual hasta hoy contra el mes anterior completo y contra los mismos días del mes anterior. Devuelve variaciones, órdenes y ticket promedio calculados en Python.",
        {"periodo": {"type": "string", "description": "Usa este_mes para la comparación MTD ejecutiva."}},
        ["periodo"],
    ),
    fn(
        "generar_reporte_ventas",
        "Calcula un reporte agregado para un rango explícito. Prefiere analizar_ventas_periodo cuando el usuario usa un periodo relativo.",
        {
            "fecha_inicio": {"type": "string", "description": "YYYY-MM-DD"},
            "fecha_fin": {"type": "string", "description": "YYYY-MM-DD"},
        },
        ["fecha_inicio", "fecha_fin"],
    ),
    fn(
        "consultar_historial_pagos",
        "Consulta y reconcilia total, abono inicial, abonos extra y saldo de una OP. Úsala para seguimientos como cuánto debe o cuánto ha abonado.",
        {"numero_op": {"type": "string"}},
        ["numero_op"],
    ),
    fn(
        "consultar_ultima_cotizacion",
        "Devuelve la cotización más reciente usando fecha y número como desempate.",
        {},
        [],
    ),
    fn(
        "consultar_cotizaciones",
        "Consulta cotizaciones recientes, de un periodo, cliente o estado. Usa cadenas vacías para filtros no solicitados.",
        {
            "periodo": {"type": "string"},
            "cliente": {"type": "string"},
            "estado": {"type": "string"},
            "limite": {"type": "integer", "minimum": 1, "maximum": 50},
        },
        ["periodo", "cliente", "estado", "limite"],
    ),
    fn(
        "analizar_cotizaciones",
        "Calcula total cotizado, cantidad y ticket promedio de un periodo inferible.",
        {"periodo": {"type": "string"}},
        ["periodo"],
    ),
    fn("obtener_resumen_negocio", "Obtiene métricas generales actuales y reconciliadas de HomeEasy.", {}, []),
    fn(
        "consultar_catalogo",
        "Busca referencias y tarifas actuales por sistema, tela, privacidad o etiqueta comercial.",
        {
            "sistema": {"type": "string"},
            "tela": {"type": "string"},
            "privacidad": {"type": "string"},
            "etiqueta": {"type": "string"},
            "limite": {"type": "integer", "minimum": 1, "maximum": 12},
        },
        ["sistema", "tela", "privacidad", "etiqueta", "limite"],
    ),
    fn(
        "cotizar_producto",
        "Calcula una cotización HomeEasy con la tarifa actual. Nunca calcules precios mentalmente.",
        {
            "sistema": {"type": "string"},
            "tela": {"type": "string"},
            "ancho": {"type": "number", "description": "Metros; acepta centímetros si es mayor a 10."},
            "alto": {"type": "number", "description": "Metros; acepta centímetros si es mayor a 10."},
            "cantidad": {"type": "integer", "minimum": 1, "maximum": 50},
            "incluir_lujo": {"type": "boolean"},
            "solo_renueva": {"type": "boolean"},
        },
        ["sistema", "tela", "ancho", "alto", "cantidad", "incluir_lujo", "solo_renueva"],
    ),
]


@dataclass(frozen=True)
class PermissionRule:
    all_of: tuple[str, ...] = ()
    any_of: tuple[str, ...] = ()


PERMISSIONS: dict[str, PermissionRule] = {
    "buscar_cliente": PermissionRule(all_of=("clientes.read",)),
    "consultar_historial_cliente": PermissionRule(
        all_of=("clientes.read",),
        any_of=("ventas.read", "pedidos.read", "pedidos.write", "cotizaciones.read", "cotizaciones.write"),
    ),
    "consultar_orden": PermissionRule(any_of=("ventas.read", "pedidos.read", "pedidos.write")),
    "consultar_saldos_pendientes": PermissionRule(any_of=("caja.read", "ventas.read")),
    "consultar_agenda": PermissionRule(all_of=("agenda.read",)),
    "obtener_ultimas_ventas": PermissionRule(all_of=("ventas.read",)),
    "analizar_ventas_periodo": PermissionRule(any_of=("reportes.read", "ventas.read")),
    "comparar_periodos_ventas": PermissionRule(any_of=("reportes.read", "ventas.read")),
    "generar_reporte_ventas": PermissionRule(any_of=("reportes.read", "ventas.read")),
    "consultar_historial_pagos": PermissionRule(any_of=("ventas.read", "abonos.read", "abonos.write", "caja.read")),
    "consultar_ultima_cotizacion": PermissionRule(any_of=("cotizaciones.read", "cotizaciones.write")),
    "consultar_cotizaciones": PermissionRule(any_of=("cotizaciones.read", "cotizaciones.write")),
    "analizar_cotizaciones": PermissionRule(any_of=("cotizaciones.read", "cotizaciones.write")),
    "obtener_resumen_negocio": PermissionRule(all_of=("reportes.read",)),
    "consultar_catalogo": PermissionRule(all_of=("app.access",)),
    "cotizar_producto": PermissionRule(all_of=("cotizaciones.write",)),
}


def tool_is_allowed(name: str, context: AuthContext) -> bool:
    rule = PERMISSIONS.get(name)
    if rule is None:
        return False
    if any(not context.has(permission) for permission in rule.all_of):
        return False
    if rule.any_of and not context.has_any(rule.any_of):
        return False
    return True


def tools_for_context(context: AuthContext) -> list[dict[str, Any]]:
    return [tool for tool in TOOL_SPECS if tool_is_allowed(str(tool.get("name") or ""), context)]


def _contact_only(client: dict[str, Any]) -> dict[str, Any]:
    email = str(client.get("email") or "").strip()
    if normalize_text(email) in {"sincorreo@sincorreo.com", "sin correo", "no aplica", "n/a"}:
        email = ""
    return {
        "cedula": client.get("cedula", ""),
        "nombre": client.get("nombre", ""),
        "telefono": client.get("telefono", ""),
        "email": email,
        "email_display": email or "Sin correo registrado",
        "direccion": client.get("direccion", ""),
    }


def _cop_number(value: Any) -> int:
    return int(round(money_number(value)))


def _cop_text(value: Any) -> str:
    return "$" + f"{_cop_number(value):,}".replace(",", ".")


def _document(entity: str, number: Any, url: Any) -> dict[str, str] | None:
    clean_url = str(url or "").strip()
    if not clean_url.startswith("https://"):
        return None
    return {
        "type": "document",
        "entity": entity,
        "entityId": str(number or "").strip(),
        "title": "Ver cotización" if entity == "quote" else "Ver OP",
        "url": clean_url,
    }


def _payment_payload(payment: dict[str, Any]) -> dict[str, Any]:
    result = dict(payment)
    result["valor_cop"] = _cop_number(payment.get("valor_cop", payment.get("valor")))
    return result


def _order_payload(order: dict[str, Any]) -> dict[str, Any]:
    result = reconcile_order(order)
    result["abonos_extra"] = [_payment_payload(item) for item in (result.get("abonos_extra") or [])]
    return result


def _order_card(order: dict[str, Any]) -> dict[str, Any]:
    order = _order_payload(order)
    number = str(order.get("numero") or "").strip()
    name = str(order.get("nombre") or "Cliente").strip()
    description = str(order.get("descripcion") or "").strip()
    day = str(order.get("fecha") or "").strip()
    card = {
        "type": "order",
        "entity_id": f"order:{number}" if number else "",
        "entityId": number,
        "numero": number,
        "cliente": name,
        "fecha": day,
        "descripcion": description,
        "total_cop": order.get("total_cop", 0),
        "abonado_total_cop": order.get("abonado_total_cop", 0),
        "saldo_cop": order.get("saldo_cop", 0),
        "estado_financiero": order.get("estado_financiero", ""),
        "title": f"OP {number} · {name}" if number else name,
        "subtitle": " · ".join(part for part in (day, description) if part),
        "amount": order.get("total_cop", 0),
        "total": order.get("total_cop", 0),
        "paid": order.get("abonado_total_cop", 0),
        "balance": order.get("saldo_cop", 0),
        "meta": f"Abonado {_cop_text(order.get('abonado_total_cop'))} · Saldo {_cop_text(order.get('saldo_cop'))}",
        "status": order.get("estado_financiero", ""),
        "integrityOk": bool(order.get("integrity_ok", True)),
    }
    document = _document("order", number, order.get("url_pdf"))
    if document:
        card["document"] = document
        card["documento"] = {"url": document["url"], "label": document["title"]}
    if order.get("integrity_warnings"):
        card["integrityWarning"] = str(order["integrity_warnings"][0])
    return card


def _balance_card(order: dict[str, Any]) -> dict[str, Any]:
    order = _order_payload(order)
    number = str(order.get("numero") or "").strip()
    card = {
        "type": "balance",
        "entity_id": f"order:{number}" if number else "",
        "entityId": number,
        "numero": number,
        "cliente": str(order.get("nombre") or "Cliente"),
        "fecha": str(order.get("fecha") or ""),
        "descripcion": str(order.get("descripcion") or ""),
        "total_cop": order.get("total_cop", 0),
        "abonado_total_cop": order.get("abonado_total_cop", 0),
        "saldo_cop": order.get("saldo_cop", 0),
        "estado_financiero": order.get("estado_financiero", ""),
        "title": f"OP {number} · {order.get('nombre') or 'Cliente'}",
        "subtitle": str(order.get("descripcion") or "").strip(),
        "amount": order.get("saldo_cop", 0),
        "total": order.get("total_cop", 0),
        "paid": order.get("abonado_total_cop", 0),
        "balance": order.get("saldo_cop", 0),
        "meta": f"Total {_cop_text(order.get('total_cop'))} · Abonado {_cop_text(order.get('abonado_total_cop'))}",
        "status": order.get("estado_financiero", ""),
        "integrityOk": bool(order.get("integrity_ok", True)),
    }
    document = _document("order", number, order.get("url_pdf"))
    if document:
        card["document"] = document
        card["documento"] = {"url": document["url"], "label": document["title"]}
    return card


def _quote_payload(quote: dict[str, Any]) -> dict[str, Any]:
    result = dict(quote)
    result["total_cop"] = _cop_number(quote.get("total_cop", quote.get("total")))
    return result


def _quote_card(quote: dict[str, Any]) -> dict[str, Any]:
    quote = _quote_payload(quote)
    number = str(quote.get("numero") or "").strip()
    card = {
        "type": "quote",
        "entity_id": f"quote:{number}" if number else "",
        "entityId": number,
        "numero": number,
        "cliente": str(quote.get("nombre") or "").strip(),
        "fecha": str(quote.get("fecha") or "").strip(),
        "descripcion": str(quote.get("descripcion") or "").strip(),
        "total_cop": quote.get("total_cop", 0),
        "estado": str(quote.get("estado") or "").strip(),
        "title": f"Cotización {number}" if number else "Cotización",
        "subtitle": " · ".join(
            part for part in (str(quote.get("nombre") or "").strip(), str(quote.get("fecha") or "").strip()) if part
        ),
        "amount": quote.get("total_cop", 0),
        "meta": str(quote.get("descripcion") or "").strip(),
        "status": str(quote.get("estado") or "").strip(),
    }
    document = _document("quote", number, quote.get("url_pdf"))
    if document:
        card["document"] = document
        card["documento"] = {"url": document["url"], "label": document["title"]}
    return card


def _customer_card(client: dict[str, Any], *, history: bool = False) -> dict[str, Any]:
    contact = _contact_only(client)
    return {
        "type": "customer",
        "entity_id": f"customer:{contact.get('cedula')}" if contact.get("cedula") else "",
        "nombre": contact.get("nombre") or "Cliente",
        "cedula": contact.get("cedula") or "",
        "telefono": contact.get("telefono") or "",
        "email": contact.get("email") or "",
        "direccion": contact.get("direccion") or "",
        "actions": ["copy", "share", "whatsapp", "call"],
        "title": contact.get("nombre") or "Cliente",
        "subtitle": contact.get("cedula") or "",
        "meta": " · ".join(part for part in (contact.get("telefono"), contact.get("email_display")) if part),
        "contact": contact,
        "historyAvailable": history,
    }


def _suggestions(context: AuthContext, *items: tuple[str, str, str]) -> dict[str, Any]:
    allowed = [
        {"label": label, "prompt": prompt}
        for label, prompt, tool_name in items
        if tool_is_allowed(tool_name, context)
    ]
    return {
        "type": "suggestions",
        "items": allowed[:3],
    }


def _resolved_period(value: Any) -> ResolvedPeriod:
    expression = str(value or "").strip().replace("_", " ")
    period = resolve_period(expression)
    if period is None:
        raise ValueError("No pude resolver ese periodo con seguridad.")
    return period


def _sales_metric_cards(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "type": "kpi_group",
            "title": "Ventas del periodo",
            "items": [
                {"key": "sales", "label": "Ventas", "kind": "currency", "value": int(result.get("total_vendido") or 0)},
                {"key": "orders", "label": "Órdenes", "kind": "integer", "value": int(result.get("cantidad") or 0)},
                {"key": "ticket", "label": "Ticket promedio", "kind": "currency", "value": int(result.get("ticket_promedio") or 0)},
                {"key": "balance", "label": "Saldo pendiente", "kind": "currency", "value": int(result.get("saldo_pendiente") or 0)},
            ],
        },
    ]


def _strip_client_identity(report: dict[str, Any]) -> None:
    report.pop("cliente_mayor_compra", None)
    largest = report.get("venta_mayor")
    if isinstance(largest, dict):
        largest.pop("nombre", None)


def execute_tool(name: str, arguments: dict[str, Any], context: AuthContext, data: HomeEasyDataStore) -> dict[str, Any]:
    if not tool_is_allowed(name, context):
        raise ToolPermissionError("Tu rol no tiene permiso para consultar esa información.")

    ui: list[dict[str, Any]] = []
    try:
        if name == "buscar_cliente":
            raw_matches = data.search_clients(arguments.get("criterio", ""), 5)
            result = [_contact_only(client) for client in raw_matches]
            if len(raw_matches) == 1:
                ui.extend((_customer_card(raw_matches[0]), _suggestions(
                    context,
                    ("Ver compras", "¿Qué ha comprado este cliente?", "consultar_historial_cliente"),
                    ("Ver saldo", "¿Tiene saldo pendiente?", "consultar_saldos_pendientes"),
                )))

        elif name == "consultar_historial_cliente":
            raw_matches = data.search_clients(arguments.get("criterio", ""), 5)
            contacts = [_contact_only(client) for client in raw_matches]
            if len(raw_matches) != 1:
                result = {"coincidencias": contacts, "requiere_precision": len(raw_matches) > 1, "encontrado": bool(raw_matches)}
            else:
                client = raw_matches[0]
                result = {"cliente": _contact_only(client)}
                if context.has_any(("ventas.read", "pedidos.read", "pedidos.write")):
                    result["ordenes"] = [_order_payload(item) for item in list(client.get("ordenes") or [])[-10:]]
                    summary = dict(client.get("resumen_compras") or {})
                    result.update(
                        {
                            "cantidad_ordenes": int(summary.get("cantidad_ordenes") or 0),
                            "total_comprado_cop": int(summary.get("total_comprado_cop") or 0),
                            "total_abonado_cop": int(summary.get("total_abonado_cop") or 0),
                            "saldo_total_cop": int(summary.get("saldo_total_cop") or 0),
                            "ordenes_en_revision": int(summary.get("ordenes_en_revision") or 0),
                            "ultima_compra": summary.get("ultima_compra"),
                        }
                    )
                if context.has_any(("cotizaciones.read", "cotizaciones.write")):
                    result["cotizaciones"] = [_quote_payload(item) for item in list(client.get("cotizaciones") or [])[-10:]]
                ui.append(_customer_card(client, history=True))
                ui.extend(_order_card(item) for item in result.get("ordenes", [])[-5:])
                ui.extend(_quote_card(item) for item in result.get("cotizaciones", [])[-5:])
                ui.append(_suggestions(
                    context,
                    ("Ver saldo", "¿Tiene saldo pendiente?", "consultar_saldos_pendientes"),
                    ("Ver cotizaciones", "Muéstrame sus cotizaciones", "consultar_cotizaciones"),
                ))

        elif name == "consultar_orden":
            raw = data.get_order(arguments.get("numero_op", ""), require_fresh=True)
            result = _order_payload(raw) if raw else None
            if result:
                ui.extend((_order_card(result), _suggestions(
                    context,
                    ("Ver pagos", f"¿Cuánto ha abonado la OP {result.get('numero')}?", "consultar_historial_pagos"),
                    ("Ver cliente", f"Dame los datos del cliente de la OP {result.get('numero')}", "buscar_cliente"),
                )))

        elif name == "consultar_saldos_pendientes":
            raw_summary = data.pending_balances_summary(
                int(arguments.get("limite", 20)),
                require_fresh=True,
            )
            result = {
                **raw_summary,
                "mayor_saldo": _order_payload(raw_summary["mayor_saldo"])
                if raw_summary.get("mayor_saldo")
                else None,
                "ordenes": [_order_payload(item) for item in raw_summary.get("ordenes", [])],
            }
            ui.extend(_balance_card(item) for item in result["ordenes"][:5])

        elif name == "consultar_agenda":
            requested = str(arguments.get("fecha") or "").strip()
            if parse_date(requested):
                day = parse_date(requested)
                result = data.schedule_for(day.isoformat() if day else date.today().isoformat())
            else:
                period = _resolved_period(requested or "hoy")
                result = data.schedule_between(period)

        elif name == "obtener_ultimas_ventas":
            result = [
                _order_payload(item)
                for item in data.recent_sales(int(arguments.get("cantidad", 5)), require_fresh=True)
            ]
            ui.extend(_order_card(item) for item in result[:5])
            ui.append(_suggestions(
                context,
                ("Comparar mes", "Compara este mes con el mes pasado", "comparar_periodos_ventas"),
                ("Ver cartera", "¿Cuánto nos deben?", "consultar_saldos_pendientes"),
            ))

        elif name == "analizar_ventas_periodo":
            period = _resolved_period(arguments.get("periodo"))
            result = data.analyze_sales_period(period, include_orders=False)
            if not context.has("clientes.read"):
                _strip_client_identity(result)
            ui.extend(_sales_metric_cards(result))
            ui.append(_suggestions(
                context,
                ("Comparar", "Compara este mes con el mes pasado", "comparar_periodos_ventas"),
                ("Ver cartera", "¿Cuánto tenemos pendiente por cobrar?", "consultar_saldos_pendientes"),
            ))

        elif name == "comparar_periodos_ventas":
            requested = _resolved_period(arguments.get("periodo") or "este mes")
            if requested.key != "este_mes":
                raise ValueError("La comparación ejecutiva disponible usa el mes actual hasta hoy.")
            result = data.compare_current_month()
            if not context.has("clientes.read"):
                for key in ("periodo_actual", "periodo_anterior_completo", "periodo_anterior_mismos_dias"):
                    report = result.get(key)
                    if isinstance(report, dict):
                        _strip_client_identity(report)
            current = result["periodo_actual"]
            previous = result["periodo_anterior_mismos_dias"]
            ui.extend(
                [
                    {
                        "type": "kpi_group",
                        "title": "Comparación de ventas",
                        "items": [
                            {"key": "sales", "label": "Ventas del mes", "kind": "currency", "value": current.get("total_vendido", 0)},
                            {"key": "orders", "label": "Órdenes", "kind": "integer", "value": current.get("cantidad", 0)},
                            {"key": "ticket", "label": "Ticket promedio", "kind": "currency", "value": current.get("ticket_promedio", 0)},
                            {
                                "key": "change",
                                "label": "Vs. mismos días",
                                "kind": "percent",
                                "value": result.get("variacion_mismos_dias_pct"),
                                "tone": "up" if result.get("tendencia") == "SUBIO" else "down" if result.get("tendencia") == "BAJO" else "",
                            },
                        ],
                    },
                    {
                        "type": "chart",
                        "chartType": "bar",
                        "title": "Ventas · mismo número de días",
                        "series": [
                            {"label": previous["periodo"]["label"], "kind": "currency", "value": previous.get("total_vendido", 0)},
                            {"label": current["periodo"]["label"], "kind": "currency", "value": current.get("total_vendido", 0)},
                        ],
                        "accessible_summary": (
                            f"La variación frente a los mismos días del mes anterior es "
                            f"{result.get('variacion_mismos_dias_pct')}%."
                            if result.get("variacion_mismos_dias_pct") is not None
                            else "No hay una base anterior suficiente para calcular la variación porcentual."
                        ),
                    },
                ]
            )

        elif name == "generar_reporte_ventas":
            result = data.sales_report(arguments.get("fecha_inicio", ""), arguments.get("fecha_fin", ""))
            result.pop("ordenes", None)
            if not context.has("clientes.read"):
                _strip_client_identity(result)
            ui.extend(_sales_metric_cards(result))

        elif name == "consultar_historial_pagos":
            result = data.payment_history(arguments.get("numero_op", ""))
            if result:
                number = str(result.get("numero") or "")
                document = _document("order", number, result.get("url_pdf"))
                card = {
                    "type": "balance",
                    "entity_id": f"order:{number}" if number else "",
                    "entityId": number,
                    "numero": number,
                    "cliente": str(result.get("cliente") or ""),
                    "fecha": str(result.get("fecha") or ""),
                    "descripcion": str(result.get("descripcion") or ""),
                    "total_cop": result.get("total_cop", 0),
                    "abonado_total_cop": result.get("abonado_total_cop", 0),
                    "saldo_cop": result.get("saldo_cop", 0),
                    "estado_financiero": result.get("estado_financiero", ""),
                    "title": f"OP {number} · {result.get('cliente', '')}",
                    "subtitle": f"Total {_cop_text(result.get('total_cop'))} · Abonado {_cop_text(result.get('abonado_total_cop'))}",
                    "amount": result.get("saldo_cop", 0),
                    "total": result.get("total_cop", 0),
                    "paid": result.get("abonado_total_cop", 0),
                    "balance": result.get("saldo_cop", 0),
                    "meta": "Saldo reconciliado",
                    "status": result.get("estado_financiero", ""),
                    "integrityOk": bool(result.get("integrity_ok", True)),
                }
                if document:
                    card["document"] = document
                    card["documento"] = {"url": document["url"], "label": document["title"]}
                ui.append(card)

        elif name == "consultar_ultima_cotizacion":
            raw = data.latest_quote(require_fresh=True)
            result = _quote_payload(raw) if raw else None
            if result:
                ui.extend((_quote_card(result), _suggestions(
                    context,
                    ("Ver cliente", f"Dame los datos de {result.get('nombre') or 'este cliente'}", "buscar_cliente"),
                    ("Ver historial", f"Muéstrame las cotizaciones de {result.get('nombre') or 'este cliente'}", "consultar_historial_cliente"),
                )))

        elif name == "consultar_cotizaciones":
            period_text = str(arguments.get("periodo") or "").strip()
            period = _resolved_period(period_text) if period_text else None
            rows = data.query_quotes(
                period=period,
                client=arguments.get("cliente", ""),
                state=arguments.get("estado", ""),
                limit=int(arguments.get("limite", 5)),
                require_fresh=True,
            )
            result = [_quote_payload(item) for item in rows]
            ui.extend(_quote_card(item) for item in result[:5])

        elif name == "analizar_cotizaciones":
            period = _resolved_period(arguments.get("periodo"))
            result = data.analyze_quotes_period(period)
            ui.append({
                "type": "kpi_group",
                "title": f"Cotizaciones · {period.label}",
                "items": [
                    {"key": "quoted", "label": "Total cotizado", "kind": "currency", "value": result.get("total_cotizado", 0)},
                    {"key": "quotes", "label": "Cotizaciones", "kind": "integer", "value": result.get("cantidad", 0)},
                    {"key": "ticket", "label": "Ticket promedio", "kind": "currency", "value": result.get("ticket_promedio", 0)},
                ],
            })

        elif name == "obtener_resumen_negocio":
            result = data.summary()
            ui.append({
                "type": "kpi_group",
                "title": "Resumen de HomeEasy",
                "items": [
                    {"key": "sales", "label": "Vendido", "kind": "currency", "value": result.get("vendido", 0)},
                    {"key": "orders", "label": "Órdenes", "kind": "integer", "value": result.get("ventas", 0)},
                    {"key": "paid", "label": "Abonado", "kind": "currency", "value": result.get("abonado", 0)},
                    {"key": "balance", "label": "Por cobrar", "kind": "currency", "value": result.get("pendiente", 0)},
                ],
            })

        elif name == "consultar_catalogo":
            result = data.catalog(
                system=arguments.get("sistema", ""),
                fabric=arguments.get("tela", ""),
                privacy=arguments.get("privacidad", ""),
                tag=arguments.get("etiqueta", ""),
                limit=int(arguments.get("limite", 5)),
            )

        elif name == "cotizar_producto":
            result = data.quote_product(
                system=arguments.get("sistema", ""),
                fabric=arguments.get("tela", ""),
                width=float(arguments.get("ancho", 0)),
                height=float(arguments.get("alto", 0)),
                quantity=int(arguments.get("cantidad", 1)),
                headrail_upgrade=bool(arguments.get("incluir_lujo", False)),
                renueva=bool(arguments.get("solo_renueva", False)),
            )
            if result.get("ok"):
                warnings = [str(item) for item in result.get("advertencias_tecnicas") or [] if str(item).strip()]
                meta = "Incluye IVA, instalación y transporte según configuración vigente."
                if warnings:
                    meta = f"{meta} Revisión técnica: {' '.join(warnings)}"
                ui.append(
                    {
                        "type": "quote",
                        "title": f"{result.get('sistema')} · {result.get('tela')}",
                        "subtitle": f"{result['medidas']['ancho_m']:.2f} × {result['medidas']['alto_m']:.2f} m · {result.get('cantidad', 1)} und.",
                        "amount": result.get("total", 0),
                        "meta": meta,
                        "warnings": warnings,
                    }
                )

        else:
            raise ToolPermissionError("Herramienta no disponible.")

    except (ValueError, HomeEasyDataError) as exc:
        return {"ok": False, "code": "DATA_ERROR", "message": str(exc), "ui": []}

    return {"ok": True, "data": result, "ui": ui}


def tool_result_for_model(result: dict[str, Any]) -> str:
    excluded = {
        "ui",
        "observaciones",
        "notas_ajuste",
        "notas_seguimiento",
        "url_pdf",
        "document",
        "documento",
    }

    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key not in excluded}
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, str):
            return value[:2400]
        return value

    return json.dumps(
        clean(result),
        ensure_ascii=False,
        default=str,
    )
