from __future__ import annotations

import json, os, re, threading, time, unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import gspread
from google.oauth2.service_account import Credentials

DEFAULT_SHEET_ID = "1hnHAeKhyd9MVCn1bCm8XExl4hdV2ijqdIjCXoJba1iY"
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip().lower())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def money_number(value: Any) -> float:
    if isinstance(value, (int, float)): return float(value)
    text = str(value or "").strip().replace("$", "").replace(" ", "")
    if not text: return 0.0
    if "." in text and "," in text: text = text.replace(".", "").replace(",", ".")
    elif "." in text and all(len(x) == 3 for x in text.split(".")[1:]): text = text.replace(".", "")
    else: text = text.replace(",", ".")
    try: return float(re.sub(r"[^0-9.\-]", "", text))
    except ValueError: return 0.0


def parse_date(value: Any) -> date | None:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try: return datetime.strptime(text, fmt).date()
        except ValueError: pass
    return None


def cell(row: list[Any], index: int, default: str = "") -> str:
    try: value = row[index]
    except (IndexError, TypeError): return default
    return str(value if value is not None else default).strip()


@dataclass(frozen=True)
class Snapshot:
    loaded_at: float
    clients: dict[str, dict[str, Any]]
    quotes: list[dict[str, Any]]
    orders: list[dict[str, Any]]
    payments: dict[str, list[dict[str, Any]]]
    schedule: list[dict[str, Any]]
    tariffs: list[dict[str, Any]]


class HomeEasyDataError(RuntimeError): pass


class HomeEasyDataStore:
    """Fresh, small TTL snapshot of the operational HomeEasy Google Sheet."""
    def __init__(self) -> None:
        self.sheet_id = os.getenv("HOMEEASY_SHEET_ID", DEFAULT_SHEET_ID).strip()
        self.ttl = max(5, int(os.getenv("HOMMY_DATA_TTL_SECONDS", "30")))
        self._snapshot: Snapshot | None = None
        self._lock = threading.RLock()

    def _credentials(self) -> Credentials:
        raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if raw:
            try: return Credentials.from_service_account_info(json.loads(raw), scopes=[SHEETS_SCOPE])
            except (ValueError, TypeError) as exc: raise HomeEasyDataError("GOOGLE_SERVICE_ACCOUNT_JSON no es válido.") from exc
        candidates = []
        explicit = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if explicit: candidates.append(Path(explicit))
        candidates.append(Path("credenciales.json"))
        for path in candidates:
            if path.exists(): return Credentials.from_service_account_file(str(path), scopes=[SHEETS_SCOPE])
        raise HomeEasyDataError("No hay credenciales de Google Sheets configuradas para Hommy.")

    def _load(self) -> Snapshot:
        book = gspread.authorize(self._credentials()).open_by_key(self.sheet_id)
        values = lambda name: book.worksheet(name).get_all_values()
        client_rows, quote_rows, order_rows, payment_rows, schedule_rows = map(values, ["Clientes", "Cotizaciones", "Ordenes_Pedido", "Abonos", "Agenda"])
        try: tariffs = book.worksheet("Tarifas").get_all_records()
        except Exception: tariffs = []

        clients: dict[str, dict[str, Any]] = {}
        payments: dict[str, list[dict[str, Any]]] = {}
        quotes: list[dict[str, Any]] = []
        orders: list[dict[str, Any]] = []
        schedule: list[dict[str, Any]] = []

        for row in client_rows[1:]:
            cid = cell(row, 0)
            if cid: clients[cid] = {"cedula": cid, "nombre": cell(row,1), "telefono": cell(row,2), "email": cell(row,3), "direccion": cell(row,4), "cotizaciones": [], "ordenes": []}
        for row in payment_rows[1:]:
            op = cell(row, 1)
            if op: payments.setdefault(op, []).append({"recibo": cell(row,0), "numero_op": op, "fecha": cell(row,4), "valor": cell(row,5), "medio": cell(row,6), "url_pdf": cell(row,7)})
        for row in quote_rows[1:]:
            number, cid = cell(row,0), cell(row,2)
            if not number: continue
            item = {"numero":number,"fecha":cell(row,1),"cedula":cid,"nombre":cell(row,3),"descripcion":cell(row,4),"total":cell(row,6),"url_pdf":cell(row,7),"estado":cell(row,9,"COTIZACION")}
            quotes.append(item)
            if cid in clients: clients[cid]["cotizaciones"].append(item)
        for row in order_rows[1:]:
            number, cid = cell(row,1), cell(row,2)
            if not number: continue
            item = {"numero":number,"fecha":cell(row,0),"cedula":cid,"nombre":cell(row,3),"descripcion":cell(row,4),"total":cell(row,6),"abono_inicial":cell(row,7),"saldo":cell(row,10),"estado":cell(row,11,"ACTIVO").upper(),"url_pdf":cell(row,12),"abonos_extra":payments.get(number,[])}
            orders.append(item)
            if cid in clients: clients[cid]["ordenes"].append(item)
        for row in schedule_rows[1:]:
            eid = cell(row,0)
            if eid: schedule.append({"id":eid,"fecha":cell(row,1),"hora":cell(row,2),"categoria":cell(row,3),"titulo":cell(row,4),"cliente":cell(row,5),"estado":cell(row,7)})
        return Snapshot(time.time(), clients, quotes, orders, payments, schedule, [dict(r) for r in tariffs])

    def snapshot(self, *, force: bool = False) -> Snapshot:
        with self._lock:
            current = self._snapshot
            if not force and current and time.time() - current.loaded_at < self.ttl: return current
            try: self._snapshot = self._load()
            except Exception as exc:
                if current and time.time() - current.loaded_at < max(300, self.ttl * 10): return current
                if isinstance(exc, HomeEasyDataError): raise
                raise HomeEasyDataError("No fue posible actualizar los datos de HomeEasy.") from exc
            return self._snapshot

    def search_clients(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        needle = normalize(query)
        if len(needle) < 2: return []
        rows = []
        for cid, client in self.snapshot().clients.items():
            score = max((100 if needle == f else 80 if f.startswith(needle) else 60 if needle in f else 0) for f in map(normalize, [client.get("nombre"), cid, client.get("telefono")]))
            if score: rows.append((score, client))
        rows.sort(key=lambda x: (-x[0], normalize(x[1].get("nombre"))))
        return [self._public_client(row) for _, row in rows[:max(1,min(limit,10))]]

    @staticmethod
    def _public_client(client: dict[str, Any]) -> dict[str, Any]:
        return {"cedula":client.get("cedula",""),"nombre":client.get("nombre",""),"telefono":client.get("telefono",""),"email":client.get("email",""),"direccion":client.get("direccion",""),"cotizaciones":list(client.get("cotizaciones",[]))[-10:],"ordenes":list(client.get("ordenes",[]))[-10:]}

    def get_order(self, number: str) -> dict[str, Any] | None:
        clean = re.sub(r"(?i)^op[\s#_-]*", "", str(number or "").strip())
        return next((dict(o) for o in self.snapshot().orders if str(o.get("numero")) == clean), None)

    def pending_balances(self, limit: int = 30) -> list[dict[str, Any]]:
        rows = [dict(o) for o in self.snapshot().orders if o.get("estado") != "ANULADA" and money_number(o.get("saldo")) > 0]
        rows.sort(key=lambda o: money_number(o.get("saldo")), reverse=True)
        return rows[:max(1,min(limit,100))]

    def schedule_for(self, day: str) -> list[dict[str, Any]]:
        target = parse_date(day)
        return [] if not target else [dict(x) for x in self.snapshot().schedule if parse_date(x.get("fecha")) == target]

    def recent_sales(self, limit: int = 5) -> list[dict[str, Any]]:
        rows = [dict(o) for o in self.snapshot().orders if o.get("estado") != "ANULADA"]
        def key(o):
            try: number = int(re.sub(r"\D", "", str(o.get("numero") or "0")) or 0)
            except ValueError: number = 0
            return parse_date(o.get("fecha")) or date.min, number
        rows.sort(key=key, reverse=True)
        return rows[:max(1,min(limit,20))]

    def sales_report(self, start: str, end: str) -> dict[str, Any]:
        start_d, end_d = parse_date(start), parse_date(end)
        if not start_d or not end_d or start_d > end_d: raise ValueError("Rango de fechas inválido.")
        rows = [dict(o) for o in self.snapshot().orders if o.get("estado") != "ANULADA" and (d:=parse_date(o.get("fecha"))) and start_d <= d <= end_d]
        return {"fecha_inicio":start_d.isoformat(),"fecha_fin":end_d.isoformat(),"cantidad":len(rows),"total_vendido":round(sum(money_number(o.get("total")) for o in rows)),"saldo_pendiente":round(sum(money_number(o.get("saldo")) for o in rows)),"ordenes":rows[:100]}

    def payment_history(self, order_number: str) -> dict[str, Any] | None:
        o = self.get_order(order_number)
        return None if not o else {"numero":o.get("numero"),"cliente":o.get("nombre"),"total":o.get("total"),"abono_inicial":o.get("abono_inicial"),"saldo":o.get("saldo"),"estado":o.get("estado"),"abonos":list(o.get("abonos_extra") or []),"url_pdf":o.get("url_pdf","")}

    def summary(self) -> dict[str, Any]:
        snap = self.snapshot(); orders = [o for o in snap.orders if o.get("estado") != "ANULADA"]
        return {"clientes":len(snap.clients),"cotizaciones":len(snap.quotes),"ventas":len(orders),"ventas_activas":sum(o.get("estado")=="ACTIVO" for o in orders),"ventas_completadas":sum(o.get("estado")=="COMPLETADO" for o in orders),"vendido":round(sum(money_number(o.get("total")) for o in orders)),"pendiente":round(sum(money_number(o.get("saldo")) for o in orders)),"datos_actualizados":datetime.fromtimestamp(snap.loaded_at).isoformat(timespec="seconds")}

    def catalog(self, *, system: str="", fabric: str="", privacy: str="", tag: str="", limit: int=5) -> list[dict[str, Any]]:
        filters = tuple(map(normalize, (system,fabric,privacy,tag))); rows=[]
        for row in self.snapshot().tariffs:
            fields = tuple(normalize(row.get(k)) for k in ("Sistema","Nombre_Tela","Privacidad","Etiqueta_Venta"))
            if all(not wanted or wanted in field for wanted, field in zip(filters,fields)): rows.append(dict(row))
        rows.sort(key=lambda r: money_number(r.get("Precio_M2")))
        return [{"sistema":r.get("Sistema",""),"tela":r.get("Nombre_Tela",""),"precio_m2":money_number(r.get("Precio_M2")),"privacidad":r.get("Privacidad",""),"etiqueta":r.get("Etiqueta_Venta",""),"argumento_venta":r.get("Argumento_Venta",""),"notas_tecnicas":r.get("Notas_Tecnicas",""),"ancho_maximo":money_number(r.get("Ancho_Maximo")),"alto_maximo":money_number(r.get("Alto_Maximo"))} for r in rows[:max(1,min(limit,12))]]

    def quote_product(self, *, system: str, fabric: str, width: float, height: float, quantity: int=1, headrail_upgrade: bool=False, renueva: bool=False) -> dict[str, Any]:
        if width > 10: width /= 100
        if height > 10: height /= 100
        quantity = max(1,min(int(quantity),50))
        if width <= 0 or height <= 0: raise ValueError("Las medidas deben ser mayores a cero.")
        sn, fn = normalize(system), normalize(fabric)
        matches = [r for r in self.snapshot().tariffs if sn in normalize(r.get("Sistema")) and fn in normalize(r.get("Nombre_Tela"))]
        if not matches: return {"ok":False,"code":"TARIFF_NOT_FOUND","suggestions":self.catalog(system=system,fabric=fabric,limit=5)}
        row = matches[0]; price = money_number(row.get("Precio_M2"))
        if renueva:
            price = money_number(row.get("Precio_Renueva_M2"))
            if price <= 0: return {"ok":False,"code":"RENEW_NOT_AVAILABLE"}
        surcharge = 0.0
        if headrail_upgrade and (m:=re.search(r"\+\s*([\d.,]+)", str(row.get("Recargos_Mecanismo") or ""))): surcharge=money_number(m.group(1)); price += surcharge
        min_m2, min_h = money_number(row.get("Cobro_Min_M2")), money_number(row.get("Cobro_Min_Alto"))
        max_w, max_h = money_number(row.get("Ancho_Maximo")) or 99, money_number(row.get("Alto_Maximo")) or 99
        issues=[]
        if width > max_w: issues.append(f"El ancho {width:.2f} m supera el máximo de {max_w:.2f} m para esta referencia.")
        if height > max_h: issues.append(f"El alto {height:.2f} m supera el máximo de {max_h:.2f} m para esta referencia.")
        if "enrollable" in sn and height > width*3: issues.append("La relación alto/ancho presenta riesgo de efecto cono.")
        if "sheer" in sn and height > 3: issues.append("La altura supera 3 m; requiere validación específica de cabezal/mecanismo.")
        if width > max_w or height > max_h: return {"ok":False,"code":"OUTSIDE_TECHNICAL_LIMITS","sistema":row.get("Sistema",system),"tela":row.get("Nombre_Tela",fabric),"medidas":{"ancho_m":width,"alto_m":height},"issues":issues}
        area = max(width*max(height,min_h), min_m2); material = area*price*quantity
        install = money_number(os.getenv("HOMMY_INSTALL_ONDA" if "onda" in sn else "HOMMY_INSTALL_DEFAULT", "50000" if "onda" in sn else "30000"))*quantity
        subtotal=material+install; vat=subtotal*float(os.getenv("HOMMY_VAT_RATE","0.19")); transport=money_number(os.getenv("HOMMY_TRANSPORT","50000")); total=subtotal+vat+transport
        return {"ok":True,"sistema":row.get("Sistema",system),"tela":row.get("Nombre_Tela",fabric),"medidas":{"ancho_m":round(width,3),"alto_m":round(height,3)},"cantidad":quantity,"modalidad":"renueva" if renueva else "completa","cabezal_lujo":bool(headrail_upgrade),"recargo_cabezal_unitario_m2":round(surcharge),"area_cobrada_m2_unitaria":round(area,3),"material":round(material),"instalacion":round(install),"iva":round(vat),"transporte":round(transport),"total":round(total),"observaciones":issues,"tarifa_actualizada":datetime.fromtimestamp(self.snapshot().loaded_at).isoformat(timespec="seconds")}
