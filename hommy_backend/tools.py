from __future__ import annotations

import json
from datetime import date
from typing import Any

from .auth import AuthContext
from .data import HomeEasyDataError, HomeEasyDataStore


class ToolPermissionError(RuntimeError): pass


def fn(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type":"function","name":name,"description":description,"parameters":{"type":"object","properties":properties,"required":required,"additionalProperties":False},"strict":True}


TOOL_SPECS = [
    fn("buscar_cliente", "Busca un cliente real de HomeEasy por nombre, cédula o teléfono. Úsala siempre para datos de un cliente.", {"criterio":{"type":"string"}}, ["criterio"]),
    fn("consultar_orden", "Consulta una orden de pedido/venta por número OP.", {"numero_op":{"type":"string"}}, ["numero_op"]),
    fn("consultar_saldos_pendientes", "Obtiene cartera real: órdenes con saldo pendiente.", {"limite":{"type":"integer","minimum":1,"maximum":100}}, ["limite"]),
    fn("consultar_agenda", "Consulta la agenda real de HomeEasy para una fecha.", {"fecha":{"type":"string","description":"YYYY-MM-DD"}}, ["fecha"]),
    fn("obtener_ultimas_ventas", "Obtiene las ventas más recientes de HomeEasy.", {"cantidad":{"type":"integer","minimum":1,"maximum":20}}, ["cantidad"]),
    fn("generar_reporte_ventas", "Calcula ventas y saldos de un rango de fechas usando los datos reales.", {"fecha_inicio":{"type":"string","description":"YYYY-MM-DD"},"fecha_fin":{"type":"string","description":"YYYY-MM-DD"}}, ["fecha_inicio","fecha_fin"]),
    fn("consultar_historial_pagos", "Consulta total, saldo y abonos de una OP real.", {"numero_op":{"type":"string"}}, ["numero_op"]),
    fn("obtener_resumen_negocio", "Obtiene métricas generales actuales de HomeEasy.", {}, []),
    fn("consultar_catalogo", "Busca referencias y tarifas actuales por sistema, tela, privacidad o etiqueta comercial.", {"sistema":{"type":"string"},"tela":{"type":"string"},"privacidad":{"type":"string"},"etiqueta":{"type":"string"},"limite":{"type":"integer","minimum":1,"maximum":12}}, ["sistema","tela","privacidad","etiqueta","limite"]),
    fn("cotizar_producto", "Calcula una cotización HomeEasy con la tarifa actual. Nunca calcules precios mentalmente: usa esta herramienta.", {"sistema":{"type":"string"},"tela":{"type":"string"},"ancho":{"type":"number","description":"Metros; también acepta centímetros si el valor es mayor a 10."},"alto":{"type":"number","description":"Metros; también acepta centímetros si el valor es mayor a 10."},"cantidad":{"type":"integer","minimum":1,"maximum":50},"incluir_lujo":{"type":"boolean"},"solo_renueva":{"type":"boolean"}}, ["sistema","tela","ancho","alto","cantidad","incluir_lujo","solo_renueva"]),
]

PERMISSIONS = {
    "buscar_cliente": ("clientes.read",),
    "consultar_orden": ("ventas.read","pedidos.write"),
    "consultar_saldos_pendientes": ("caja.read","ventas.read"),
    "consultar_agenda": ("agenda.read",),
    "obtener_ultimas_ventas": ("ventas.read","reportes.read"),
    "generar_reporte_ventas": ("reportes.read",),
    "consultar_historial_pagos": ("ventas.read","abonos.write","caja.read"),
    "obtener_resumen_negocio": ("reportes.read",),
    "consultar_catalogo": ("app.access",),
    "cotizar_producto": ("cotizaciones.write",),
}


def _documents(value: Any) -> list[dict[str, Any]]:
    found=[]
    def walk(node: Any):
        if isinstance(node, dict):
            url=str(node.get("url_pdf") or "").strip()
            if url.startswith("https://"): found.append({"type":"document","title":"Abrir documento","url":url})
            for key, child in node.items():
                if key != "url_pdf": walk(child)
        elif isinstance(node, list):
            for child in node: walk(child)
    walk(value); unique=[]; seen=set()
    for card in found:
        if card["url"] not in seen: seen.add(card["url"]); unique.append(card)
    return unique[:8]


def execute_tool(name: str, arguments: dict[str, Any], context: AuthContext, data: HomeEasyDataStore) -> dict[str, Any]:
    if not context.has_any(PERMISSIONS.get(name, ("app.access",))):
        raise ToolPermissionError("Tu rol no tiene permiso para consultar esa información.")
    ui=[]
    try:
        if name == "buscar_cliente":
            result=data.search_clients(arguments.get("criterio",""),5)
            if len(result)==1:
                c=result[0]; ui.append({"type":"customer","title":c.get("nombre") or "Cliente","subtitle":c.get("telefono") or c.get("email") or "","meta":c.get("direccion") or ""})
        elif name == "consultar_orden":
            result=data.get_order(arguments.get("numero_op",""))
            if result: ui.append({"type":"order","title":f"OP-{result.get('numero','')}","subtitle":result.get("nombre",""),"amount":result.get("total",""),"status":result.get("estado","")})
        elif name == "consultar_saldos_pendientes": result=data.pending_balances(int(arguments.get("limite",20)))
        elif name == "consultar_agenda": result=data.schedule_for(arguments.get("fecha") or date.today().isoformat())
        elif name == "obtener_ultimas_ventas": result=data.recent_sales(int(arguments.get("cantidad",5)))
        elif name == "generar_reporte_ventas":
            result=data.sales_report(arguments.get("fecha_inicio",""),arguments.get("fecha_fin","")); ui.append({"type":"metric","title":"Ventas del periodo","amount":result.get("total_vendido",0),"subtitle":f"{result.get('cantidad',0)} órdenes"})
        elif name == "consultar_historial_pagos":
            result=data.payment_history(arguments.get("numero_op",""))
            if result: ui.append({"type":"balance","title":f"OP-{result.get('numero','')}","subtitle":result.get("cliente",""),"amount":result.get("saldo","")})
        elif name == "obtener_resumen_negocio": result=data.summary()
        elif name == "consultar_catalogo": result=data.catalog(system=arguments.get("sistema",""),fabric=arguments.get("tela",""),privacy=arguments.get("privacidad",""),tag=arguments.get("etiqueta",""),limit=int(arguments.get("limite",5)))
        elif name == "cotizar_producto":
            result=data.quote_product(system=arguments.get("sistema",""),fabric=arguments.get("tela",""),width=float(arguments.get("ancho",0)),height=float(arguments.get("alto",0)),quantity=int(arguments.get("cantidad",1)),headrail_upgrade=bool(arguments.get("incluir_lujo",False)),renueva=bool(arguments.get("solo_renueva",False)))
            if result.get("ok"): ui.append({"type":"quote","title":f"{result.get('sistema')} · {result.get('tela')}","subtitle":f"{result['medidas']['ancho_m']:.2f} × {result['medidas']['alto_m']:.2f} m · {result.get('cantidad',1)} und.","amount":result.get("total",0),"meta":"Incluye IVA, instalación y transporte según configuración vigente."})
        else: return {"ok":False,"code":"UNKNOWN_TOOL","message":"Herramienta no disponible.","ui":[]}
    except (ValueError, HomeEasyDataError) as exc:
        return {"ok":False,"code":"DATA_ERROR","message":str(exc),"ui":[]}
    ui.extend(_documents(result))
    return {"ok":True,"data":result,"ui":ui}


def tool_result_for_model(result: dict[str, Any]) -> str:
    return json.dumps({k:v for k,v in result.items() if k != "ui"}, ensure_ascii=False, default=str)
