from __future__ import annotations

import json
from datetime import date
from typing import Any

from .auth import AuthContext
from .data import HomeEasyDataError, HomeEasyDataStore, money_number


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
        "Busca datos de contacto de un cliente real de HomeEasy por nombre, cédula o teléfono. Esta herramienta no devuelve historial comercial.",
        {"criterio": {"type": "string"}},
        ["criterio"],
    ),
    fn(
        "consultar_historial_cliente",
        "Consulta compras y/o cotizaciones de un cliente real. Úsala para preguntas como qué compró, qué cotizó o cuál fue su última compra.",
        {"criterio": {"type": "string"}},
        ["criterio"],
    ),
    fn(
        "consultar_orden",
        "Consulta una orden de pedido/venta por número OP. Devuelve total, abono y saldo actuales.",
        {"numero_op": {"type": "string"}},
        ["numero_op"],
    ),
    fn(
        "consultar_saldos_pendientes",
        "Obtiene cartera real: órdenes con saldo pendiente, incluyendo el saldo numérico en pesos colombianos.",
        {"limite": {"type": "integer", "minimum": 1, "maximum": 100}},
        ["limite"],
    ),
    fn(
        "consultar_agenda",
        "Consulta la agenda real de HomeEasy para una fecha.",
        {"fecha": {"type": "string", "description": "YYYY-MM-DD"}},
        ["fecha"],
    ),
    fn(
        "obtener_ultimas_ventas",
        "Obtiene las ventas más recientes de HomeEasy. Cada venta incluye OP, cliente, total, abono inicial y saldo actual; úsala también para identificar la OP de una pregunta de seguimiento.",
        {"cantidad": {"type": "integer", "minimum": 1, "maximum": 20}},
        ["cantidad"],
    ),
    fn(
        "generar_reporte_ventas",
        "Calcula ventas y saldos de un rango de fechas usando los datos reales.",
        {
            "fecha_inicio": {"type": "string", "description": "YYYY-MM-DD"},
            "fecha_fin": {"type": "string", "description": "YYYY-MM-DD"},
        },
        ["fecha_inicio", "fecha_fin"],
    ),
    fn(
        "consultar_historial_pagos",
        "Consulta total, saldo y abonos de una OP real. Úsala obligatoriamente para preguntas de seguimiento como '¿cuánto debe?', '¿cuál es el saldo?' o '¿cuánto ha abonado?' sobre una venta mencionada antes.",
        {"numero_op": {"type": "string"}},
        ["numero_op"],
    ),
    fn("obtener_resumen_negocio", "Obtiene métricas generales actuales de HomeEasy.", {}, []),
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
        "Calcula una cotización HomeEasy con la tarifa actual. Nunca calcules precios mentalmente: usa esta herramienta.",
        {
            "sistema": {"type": "string"},
            "tela": {"type": "string"},
            "ancho": {"type": "number", "description": "Metros; también acepta centímetros si el valor es mayor a 10."},
            "alto": {"type": "number", "description": "Metros; también acepta centímetros si el valor es mayor a 10."},
            "cantidad": {"type": "integer", "minimum": 1, "maximum": 50},
            "incluir_lujo": {"type": "boolean"},
            "solo_renueva": {"type": "boolean"},
        },
        ["sistema", "tela", "ancho", "alto", "cantidad", "incluir_lujo", "solo_renueva"],
    ),
]


PERMISSIONS = {
    "buscar_cliente": ("clientes.read",),
    "consultar_orden": ("ventas.read", "pedidos.write"),
    "consultar_saldos_pendientes": ("caja.read", "ventas.read"),
    "consultar_agenda": ("agenda.read",),
    "obtener_ultimas_ventas": ("ventas.read", "reportes.read"),
    "generar_reporte_ventas": ("reportes.read",),
    "consultar_historial_pagos": ("ventas.read", "abonos.write", "caja.read"),
    "obtener_resumen_negocio": ("reportes.read",),
    "consultar_catalogo": ("app.access",),
    "cotizar_producto": ("cotizaciones.write",),
}


def tool_is_allowed(name: str, context: AuthContext) -> bool:
    if name == "consultar_historial_cliente":
        commercial_read = context.has("ventas.read") or context.has_any(("cotizaciones.read", "cotizaciones.write"))
        return context.has("clientes.read") and commercial_read
    return context.has_any(PERMISSIONS.get(name, ("app.access",)))


def tools_for_context(context: AuthContext) -> list[dict[str, Any]]:
    return [tool for tool in TOOL_SPECS if tool_is_allowed(str(tool.get("name") or ""), context)]


def _contact_only(client: dict[str, Any]) -> dict[str, Any]:
    return {
        "cedula": client.get("cedula", ""),
        "nombre": client.get("nombre", ""),
        "telefono": client.get("telefono", ""),
        "email": client.get("email", ""),
        "direccion": client.get("direccion", ""),
    }


def _cop_number(value: Any) -> int:
    return int(round(money_number(value)))


def _cop_text(value: Any) -> str:
    return "$" + f"{_cop_number(value):,}".replace(",", ".")


def _payment_payload(payment: dict[str, Any]) -> dict[str, Any]:
    result = dict(payment)
    result["valor_cop"] = _cop_number(payment.get("valor"))
    return result


def _order_payload(order: dict[str, Any]) -> dict[str, Any]:
    result = dict(order)
    result["total_cop"] = _cop_number(order.get("total"))
    result["abono_inicial_cop"] = _cop_number(order.get("abono_inicial"))
    result["saldo_cop"] = _cop_number(order.get("saldo"))
    result["abonos_extra"] = [_payment_payload(item) for item in (order.get("abonos_extra") or [])]
    return result


def _order_card(order: dict[str, Any]) -> dict[str, Any]:
    number = str(order.get("numero") or "").strip()
    name = str(order.get("nombre") or "Cliente").strip()
    description = str(order.get("descripcion") or "").strip()
    day = str(order.get("fecha") or "").strip()
    meta_parts = []
    if order.get("abono_inicial"):
        meta_parts.append(f"Abono {_cop_text(order.get('abono_inicial'))}")
    if order.get("saldo") != "":
        meta_parts.append(f"Saldo {_cop_text(order.get('saldo'))}")
    return {
        "type": "order",
        "title": f"OP {number} · {name}" if number else name,
        "subtitle": " · ".join(part for part in (day, description) if part),
        "amount": _cop_number(order.get("total")),
        "meta": " · ".join(meta_parts),
        "status": str(order.get("estado") or "").strip(),
    }


def _balance_card(order: dict[str, Any]) -> dict[str, Any]:
    number = str(order.get("numero") or "").strip()
    return {
        "type": "balance",
        "title": f"OP {number} · {order.get('nombre') or 'Cliente'}",
        "subtitle": str(order.get("descripcion") or "").strip(),
        "amount": _cop_number(order.get("saldo")),
        "meta": f"Total {_cop_text(order.get('total'))}",
        "status": "Saldo pendiente",
    }


def _documents(value: Any) -> list[dict[str, Any]]:
    found = []

    def walk(node: Any):
        if isinstance(node, dict):
            url = str(node.get("url_pdf") or "").strip()
            if url.startswith("https://"):
                number = str(node.get("numero") or node.get("numero_op") or "").strip()
                label = f"OP {number} · Ver documento" if number else "Ver documento"
                found.append({"type": "document", "title": label, "url": url})
            for key, child in node.items():
                if key != "url_pdf":
                    walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    unique = []
    seen = set()
    for card in found:
        if card["url"] not in seen:
            seen.add(card["url"])
            unique.append(card)
    return unique[:8]


def execute_tool(name: str, arguments: dict[str, Any], context: AuthContext, data: HomeEasyDataStore) -> dict[str, Any]:
    if not tool_is_allowed(name, context):
        raise ToolPermissionError("Tu rol no tiene permiso para consultar esa información.")

    ui: list[dict[str, Any]] = []
    try:
        if name == "buscar_cliente":
            raw_matches = data.search_clients(arguments.get("criterio", ""), 5)
            result = [_contact_only(client) for client in raw_matches]
            if len(result) == 1:
                client = result[0]
                ui.append(
                    {
                        "type": "customer",
                        "title": client.get("nombre") or "Cliente",
                        "subtitle": client.get("telefono") or client.get("email") or "",
                        "meta": client.get("direccion") or "",
                    }
                )

        elif name == "consultar_historial_cliente":
            raw_matches = data.search_clients(arguments.get("criterio", ""), 5)
            contacts = [_contact_only(client) for client in raw_matches]
            if len(raw_matches) != 1:
                result = {
                    "coincidencias": contacts,
                    "requiere_precision": len(raw_matches) > 1,
                    "encontrado": bool(raw_matches),
                }
            else:
                client = raw_matches[0]
                result = {"cliente": _contact_only(client)}
                if context.has("ventas.read"):
                    result["ordenes"] = [_order_payload(item) for item in list(client.get("ordenes") or [])[-10:]]
                if context.has_any(("cotizaciones.read", "cotizaciones.write")):
                    result["cotizaciones"] = list(client.get("cotizaciones") or [])[-10:]
                ui.append(
                    {
                        "type": "customer",
                        "title": client.get("nombre") or "Cliente",
                        "subtitle": client.get("cedula") or "",
                        "meta": "Historial comercial autorizado",
                    }
                )

        elif name == "consultar_orden":
            raw = data.get_order(arguments.get("numero_op", ""))
            result = _order_payload(raw) if raw else None
            if result:
                ui.append(_order_card(result))

        elif name == "consultar_saldos_pendientes":
            result = [_order_payload(item) for item in data.pending_balances(int(arguments.get("limite", 20)))]
            ui.extend(_balance_card(item) for item in result[:8])

        elif name == "consultar_agenda":
            result = data.schedule_for(arguments.get("fecha") or date.today().isoformat())

        elif name == "obtener_ultimas_ventas":
            result = [_order_payload(item) for item in data.recent_sales(int(arguments.get("cantidad", 5)))]
            ui.extend(_order_card(item) for item in result[:8])

        elif name == "generar_reporte_ventas":
            result = data.sales_report(arguments.get("fecha_inicio", ""), arguments.get("fecha_fin", ""))
            ui.append(
                {
                    "type": "metric",
                    "title": "Ventas del periodo",
                    "amount": result.get("total_vendido", 0),
                    "subtitle": f"{result.get('cantidad', 0)} órdenes",
                }
            )

        elif name == "consultar_historial_pagos":
            raw = data.payment_history(arguments.get("numero_op", ""))
            if raw:
                result = dict(raw)
                result["total_cop"] = _cop_number(raw.get("total"))
                result["abono_inicial_cop"] = _cop_number(raw.get("abono_inicial"))
                result["saldo_cop"] = _cop_number(raw.get("saldo"))
                result["abonos"] = [_payment_payload(item) for item in (raw.get("abonos") or [])]
            else:
                result = None
            if result:
                ui.append(
                    {
                        "type": "balance",
                        "title": f"OP {result.get('numero', '')} · {result.get('cliente', '')}",
                        "subtitle": f"Total {_cop_text(result.get('total'))} · Abono inicial {_cop_text(result.get('abono_inicial'))}",
                        "amount": result.get("saldo_cop", 0),
                        "meta": "Saldo actual",
                        "status": result.get("estado", ""),
                    }
                )

        elif name == "obtener_resumen_negocio":
            result = data.summary()

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
                ui.append(
                    {
                        "type": "quote",
                        "title": f"{result.get('sistema')} · {result.get('tela')}",
                        "subtitle": f"{result['medidas']['ancho_m']:.2f} × {result['medidas']['alto_m']:.2f} m · {result.get('cantidad', 1)} und.",
                        "amount": result.get("total", 0),
                        "meta": "Incluye IVA, instalación y transporte según configuración vigente.",
                    }
                )

        else:
            return {"ok": False, "code": "UNKNOWN_TOOL", "message": "Herramienta no disponible.", "ui": []}

    except (ValueError, HomeEasyDataError) as exc:
        return {"ok": False, "code": "DATA_ERROR", "message": str(exc), "ui": []}

    ui.extend(_documents(result))
    return {"ok": True, "data": result, "ui": ui}


def tool_result_for_model(result: dict[str, Any]) -> str:
    return json.dumps({key: value for key, value in result.items() if key != "ui"}, ensure_ascii=False, default=str)
