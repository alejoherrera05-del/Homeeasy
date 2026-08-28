from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import gspread
from google.oauth2.service_account import Credentials

from .analytics import (
    compare_sales,
    money_number,
    normalize_op_number,
    normalize_text,
    parse_date,
    quote_sort_key,
    reconcile_order,
    summarize_quotes,
    summarize_sales,
)
from .periods import HOME_EASY_TIMEZONE, ResolvedPeriod, month_comparison_periods


DEFAULT_SHEET_ID = "1hnHAeKhyd9MVCn1bCm8XExl4hdV2ijqdIjCXoJba1iY"
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"


def normalize(value: Any) -> str:
    return normalize_text(value)


def normalize_header(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize_text(value))


def time_sort_key(value: Any) -> tuple[int, int, str]:
    text = normalize_text(value).strip()
    match = re.search(r"(?<!\d)(\d{1,2})(?::(\d{1,2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?", text)
    if not match:
        return 99, 99, text
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = re.sub(r"[^apm]", "", match.group(3) or "")
    if meridiem == "pm" and hour < 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return 99, 99, text
    return hour, minute, text


def cell(row: list[Any], index: int, default: str = "") -> str:
    try:
        value = row[index]
    except (IndexError, TypeError):
        return default
    return str(value if value is not None else default).strip()


class HomeEasyDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class HeaderMap:
    sheet: str
    columns: dict[str, int]

    @classmethod
    def build(
        cls,
        sheet: str,
        headers: Iterable[Any],
        aliases: dict[str, tuple[str, ...]],
        *,
        required: Iterable[str],
    ) -> "HeaderMap":
        positions: dict[str, int] = {}
        duplicates: set[str] = set()
        for index, header in enumerate(headers):
            key = normalize_header(header)
            if not key:
                continue
            if key in positions:
                duplicates.add(str(header))
            else:
                positions[key] = index
        if duplicates:
            raise HomeEasyDataError(
                f"La pestaña {sheet} tiene encabezados duplicados: {', '.join(sorted(duplicates))}."
            )
        columns: dict[str, int] = {}
        for canonical, names in aliases.items():
            matches = {
                positions[key]
                for name in names
                if (key := normalize_header(name)) in positions
            }
            if len(matches) > 1:
                raise HomeEasyDataError(f"La pestaña {sheet} tiene varias columnas para {canonical}.")
            if matches:
                columns[canonical] = next(iter(matches))
        missing = [name for name in required if name not in columns]
        if missing:
            raise HomeEasyDataError(
                f"La pestaña {sheet} no contiene los encabezados requeridos: {', '.join(missing)}."
            )
        return cls(sheet, columns)

    def value(self, row: list[Any], name: str, default: str = "") -> str:
        index = self.columns.get(name)
        return default if index is None else cell(row, index, default)


CLIENT_HEADERS = {
    "cedula": ("Cedula_NIT", "Cedula", "Cedula_Cliente", "Documento"),
    "nombre": ("Nombre_Completo", "Nombre_Cliente", "Nombre"),
    "telefono": ("Telefono", "Celular", "Numero_Telefono"),
    "email": ("Email", "Correo", "Correo_Electronico"),
    "direccion": ("Direccion_Instalacion", "Direccion", "Direccion_Cliente"),
    "fecha_registro": ("Fecha_Registro", "FechaRegistro"),
}

QUOTE_HEADERS = {
    "numero": ("Numero_Cotizacion", "Nro_Cotizacion", "Cotizacion"),
    "fecha": ("Fecha", "Fecha_Cotizacion"),
    "cedula": ("Cedula_Cliente", "Cedula", "Cedula_NIT"),
    "nombre": ("Nombre_Completo", "Nombre_Cliente", "Nombre"),
    "descripcion": ("Descripcion_Items", "Descripcion", "Items"),
    "observaciones": ("Observaciones",),
    "total": ("Total_Cotizado", "Valor_Total", "Total"),
    "url_pdf": ("URL_PDF_Cotizacion", "PDF_Cotizacion"),
    "estado": ("Estado", "Estado_Cotizacion"),
    "notas_seguimiento": ("Notas de Seguimiento", "Notas_Seguimiento"),
}

ORDER_HEADERS = {
    "fecha": ("Fecha", "Fecha_OP", "Fecha_Orden"),
    "numero": ("Numero_OP", "Nro_OP", "OP"),
    "cedula": ("Cedula", "Cedula_Cliente", "Cedula_NIT"),
    "nombre": ("Nombre_Cliente", "Nombre_Completo", "Nombre"),
    "descripcion": ("Descripcion_Detallada", "Descripcion", "Items"),
    "observaciones": ("Observaciones",),
    "total": ("Valor_Total", "Total_OP", "Total"),
    "abono_inicial": ("Abono_Inicial", "Anticipo"),
    "saldo_explicito": ("Saldo_Pendiente", "Saldo_Actual", "Saldo"),
    "estado": ("Estado", "Estado_OP"),
    "url_pdf": ("URL_PDF_OP", "PDF_OP"),
    "estado_abono_inicial": ("Estado_Abono_Inicial",),
    "abono_inicial_afecta_caja": ("Abono_Inicial_Afecta_Caja",),
    "abono_inicial_afecta_saldo": ("Abono_Inicial_Afecta_Saldo",),
    "anulacion_id": ("Anulacion_ID",),
    "tratamiento_financiero": ("Tratamiento_Financiero",),
    "op_destino_credito": ("OP_Destino_Credito",),
    **{f"abono_legacy_{number}": (f"Abono_{number}",) for number in range(2, 11)},
}

PAYMENT_HEADERS = {
    "recibo": ("Numero_Recibo", "Nro_Recibo", "Recibo"),
    "numero_op": ("Numero_OP", "Nro_OP", "OP"),
    "cedula": ("Cedula", "Cedula_Cliente", "Cedula_NIT"),
    "nombre": ("Nombre_Cliente", "Nombre_Completo", "Nombre"),
    "fecha": ("Fecha_Pago", "Fecha"),
    "valor": ("Valor_Abono", "Valor", "Monto"),
    "medio": ("Medio_Pago", "Medio"),
    "url_pdf": ("URL_PDF_Recibo", "PDF_Recibo"),
    "estado_registro": ("Estado_Registro", "Estado_Abono", "Estado"),
    "afecta_caja": ("Afecta_Caja", "Impacta_Caja"),
    "afecta_saldo": ("Afecta_Saldo", "Impacta_Saldo"),
    "tipo_registro": ("Tipo_Registro", "Tipo_Abono"),
    "anulacion_id": ("Anulacion_ID",),
    "op_origen": ("OP_Origen",),
    "notas_ajuste": ("Notas_Ajuste",),
}

SCHEDULE_HEADERS = {
    "id": ("ID", "ID_Evento"),
    "fecha": ("Fecha",),
    "hora": ("Hora",),
    "categoria": ("Categoria",),
    "titulo": ("Titulo",),
    "cliente": ("Cliente", "Nombre_Cliente"),
    "notas": ("Referencia - Notas", "Referencia_Notas", "Notas"),
    "estado": ("Estado",),
}

TARIFF_HEADERS = {
    "sistema": ("Sistema",),
    "colores": ("Colores_Disponibles", "Colores"),
    "tela": ("Nombre_Tela", "Tela"),
    "precio_m2": ("Precio_M2", "Valor_M2"),
    "precio_renueva_m2": ("Precio_Renueva_M2", "Valor_Renueva_M2"),
    "privacidad": ("Privacidad",),
    "ancho_minimo": ("Ancho_Minimo",),
    "ancho_maximo": ("Ancho_Maximo",),
    "alto_maximo": ("Alto_Maximo",),
    "cobro_min_m2": ("Cobro_Min_M2",),
    "cobro_min_alto": ("Cobro_Min_Alto",),
    "proporcion_tela": ("Proporcion_Tela",),
    "espacio_instalacion_cm": ("Espacio_Instalacion_cm",),
    "garantia": ("Garantia",),
    "apto_motorizacion": ("Apto_Motorizacion",),
    "recargos_mecanismo": ("Recargos_Mecanismo",),
    "etiqueta_venta": ("Etiqueta_Venta",),
    "argumento_venta": ("Argumento_Venta",),
    "notas_tecnicas": ("Notas_Tecnicas",),
}


@dataclass(frozen=True)
class Snapshot:
    loaded_at: float
    clients: dict[str, dict[str, Any]]
    quotes: list[dict[str, Any]]
    orders: list[dict[str, Any]]
    payments: dict[str, list[dict[str, Any]]]
    schedule: list[dict[str, Any]]
    tariffs: list[dict[str, Any]]
    loaded_at_iso: str = ""
    stale: bool = False


class HomeEasyDataStore:
    """Header-driven, read-only snapshot with controlled stale-while-revalidate."""

    def __init__(self) -> None:
        self.sheet_id = os.getenv("HOMEEASY_SHEET_ID", DEFAULT_SHEET_ID).strip()
        self.ttl = max(5, int(os.getenv("HOMMY_DATA_TTL_SECONDS", "30")))
        self.stale_ttl = max(self.ttl, int(os.getenv("HOMMY_DATA_STALE_SECONDS", "180")))
        self.refresh_wait_timeout = max(5.0, min(float(os.getenv("HOMMY_DATA_REFRESH_WAIT_SECONDS", "30")), 120.0))
        self.sheets_connect_timeout = max(2.0, min(float(os.getenv("HOMMY_SHEETS_CONNECT_TIMEOUT_SECONDS", "5")), 30.0))
        self.sheets_read_timeout = max(5.0, min(float(os.getenv("HOMMY_SHEETS_READ_TIMEOUT_SECONDS", "20")), 60.0))
        self._snapshot: Snapshot | None = None
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._refreshing = False
        self._last_refresh_error: Exception | None = None

    def _credentials(self) -> Credentials:
        raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if raw:
            try:
                return Credentials.from_service_account_info(json.loads(raw), scopes=[SHEETS_SCOPE])
            except (ValueError, TypeError) as exc:
                raise HomeEasyDataError("GOOGLE_SERVICE_ACCOUNT_JSON no es válido.") from exc
        candidates = []
        explicit = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if explicit:
            candidates.append(Path(explicit))
        candidates.append(Path("credenciales.json"))
        for path in candidates:
            if path.exists():
                return Credentials.from_service_account_file(str(path), scopes=[SHEETS_SCOPE])
        raise HomeEasyDataError("No hay credenciales de Google Sheets configuradas para Hommy.")

    @staticmethod
    def _mapping(
        sheet: str,
        rows: list[list[Any]],
        aliases: dict[str, tuple[str, ...]],
        required: Iterable[str],
    ) -> HeaderMap:
        if not rows:
            raise HomeEasyDataError(f"La pestaña {sheet} no contiene encabezados.")
        return HeaderMap.build(sheet, rows[0], aliases, required=required)

    @staticmethod
    def _client_lookup_key(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", "", normalize_text(value))

    def _load(self) -> Snapshot:
        client = gspread.authorize(self._credentials())
        http_client = getattr(client, "http_client", None)
        if callable(getattr(http_client, "set_timeout", None)):
            http_client.set_timeout((self.sheets_connect_timeout, self.sheets_read_timeout))
        book = client.open_by_key(self.sheet_id)

        def values(name: str) -> list[list[Any]]:
            return book.worksheet(name).get_all_values()

        client_rows = values("Clientes")
        quote_rows = values("Cotizaciones")
        order_rows = values("Ordenes_Pedido")
        payment_rows = values("Abonos")
        schedule_rows = values("Agenda")
        tariff_rows = values("Tarifas")

        client_map = self._mapping("Clientes", client_rows, CLIENT_HEADERS, ("cedula", "nombre"))
        quote_map = self._mapping("Cotizaciones", quote_rows, QUOTE_HEADERS, ("numero", "fecha", "total"))
        order_map = self._mapping(
            "Ordenes_Pedido",
            order_rows,
            ORDER_HEADERS,
            (
                "fecha", "numero", "total", "abono_inicial", "saldo_explicito", "estado", "url_pdf",
                "estado_abono_inicial", "abono_inicial_afecta_saldo", "anulacion_id",
            ),
        )
        payment_map = self._mapping(
            "Abonos",
            payment_rows,
            PAYMENT_HEADERS,
            ("recibo", "numero_op", "fecha", "valor", "estado_registro", "afecta_saldo", "tipo_registro", "anulacion_id"),
        )
        schedule_map = self._mapping("Agenda", schedule_rows, SCHEDULE_HEADERS, ("id", "fecha", "titulo", "estado"))
        tariff_map = self._mapping(
            "Tarifas",
            tariff_rows,
            TARIFF_HEADERS,
            (
                "sistema", "tela", "precio_m2", "precio_renueva_m2",
                "cobro_min_m2", "cobro_min_alto", "ancho_maximo", "alto_maximo",
            ),
        )

        clients: dict[str, dict[str, Any]] = {}
        client_keys: dict[str, str] = {}
        payments: dict[str, list[dict[str, Any]]] = {}
        quotes: list[dict[str, Any]] = []
        orders: list[dict[str, Any]] = []
        schedule: list[dict[str, Any]] = []
        tariffs: list[dict[str, Any]] = []

        for row in client_rows[1:]:
            cid = client_map.value(row, "cedula")
            if not cid:
                continue
            clients[cid] = {
                "cedula": cid,
                "nombre": client_map.value(row, "nombre"),
                "telefono": client_map.value(row, "telefono"),
                "email": client_map.value(row, "email"),
                "direccion": client_map.value(row, "direccion"),
                "fecha_registro": client_map.value(row, "fecha_registro"),
                "cotizaciones": [],
                "ordenes": [],
            }
            client_keys[self._client_lookup_key(cid)] = cid

        for row in payment_rows[1:]:
            op = normalize_op_number(payment_map.value(row, "numero_op"))
            if not op:
                continue
            item = {
                "recibo": payment_map.value(row, "recibo"),
                "numero_op": op,
                "cedula": payment_map.value(row, "cedula"),
                "nombre": payment_map.value(row, "nombre"),
                "fecha": payment_map.value(row, "fecha"),
                "valor": payment_map.value(row, "valor"),
                "medio": payment_map.value(row, "medio"),
                "url_pdf": payment_map.value(row, "url_pdf"),
                "estado_registro": payment_map.value(row, "estado_registro"),
                "afecta_caja": payment_map.value(row, "afecta_caja"),
                "afecta_saldo": payment_map.value(row, "afecta_saldo"),
                "tipo_registro": payment_map.value(row, "tipo_registro"),
                "anulacion_id": payment_map.value(row, "anulacion_id"),
                "op_origen": payment_map.value(row, "op_origen"),
                "notas_ajuste": payment_map.value(row, "notas_ajuste"),
            }
            payments.setdefault(op, []).append(item)

        for row in quote_rows[1:]:
            number = quote_map.value(row, "numero")
            if not number:
                continue
            cid = quote_map.value(row, "cedula")
            item = {
                "numero": number,
                "fecha": quote_map.value(row, "fecha"),
                "cedula": cid,
                "nombre": quote_map.value(row, "nombre"),
                "descripcion": quote_map.value(row, "descripcion"),
                "observaciones": quote_map.value(row, "observaciones"),
                "total": quote_map.value(row, "total"),
                "url_pdf": quote_map.value(row, "url_pdf"),
                "estado": (quote_map.value(row, "estado") or "COTIZACION").upper(),
                "notas_seguimiento": quote_map.value(row, "notas_seguimiento"),
            }
            quotes.append(item)
            client_id = client_keys.get(self._client_lookup_key(cid))
            if client_id:
                clients[client_id]["cotizaciones"].append(item)

        for row in order_rows[1:]:
            number = normalize_op_number(order_map.value(row, "numero"))
            if not number:
                continue
            cid = order_map.value(row, "cedula")
            item = {
                "numero": number,
                "fecha": order_map.value(row, "fecha"),
                "cedula": cid,
                "nombre": order_map.value(row, "nombre"),
                "descripcion": order_map.value(row, "descripcion"),
                "observaciones": order_map.value(row, "observaciones"),
                "total": order_map.value(row, "total"),
                "abono_inicial": order_map.value(row, "abono_inicial"),
                "saldo_explicito": order_map.value(row, "saldo_explicito"),
                "saldo": order_map.value(row, "saldo_explicito"),
                "estado": (order_map.value(row, "estado") or "ACTIVO").upper(),
                "url_pdf": order_map.value(row, "url_pdf"),
                "estado_abono_inicial": order_map.value(row, "estado_abono_inicial"),
                "abono_inicial_afecta_caja": order_map.value(row, "abono_inicial_afecta_caja"),
                "abono_inicial_afecta_saldo": order_map.value(row, "abono_inicial_afecta_saldo"),
                "anulacion_id": order_map.value(row, "anulacion_id"),
                "tratamiento_financiero": order_map.value(row, "tratamiento_financiero"),
                "op_destino_credito": order_map.value(row, "op_destino_credito"),
                "abonos_legacy": [order_map.value(row, f"abono_legacy_{index}") for index in range(2, 11)],
            }
            item = reconcile_order(item, payments.get(number, []))
            orders.append(item)
            client_id = client_keys.get(self._client_lookup_key(cid))
            if client_id:
                clients[client_id]["ordenes"].append(item)

        for row in schedule_rows[1:]:
            event_id = schedule_map.value(row, "id")
            if event_id:
                schedule.append(
                    {
                        "id": event_id,
                        "fecha": schedule_map.value(row, "fecha"),
                        "hora": schedule_map.value(row, "hora"),
                        "categoria": schedule_map.value(row, "categoria"),
                        "titulo": schedule_map.value(row, "titulo"),
                        "cliente": schedule_map.value(row, "cliente"),
                        "notas": schedule_map.value(row, "notas"),
                        "estado": schedule_map.value(row, "estado"),
                    }
                )

        for row in tariff_rows[1:]:
            system = tariff_map.value(row, "sistema")
            fabric = tariff_map.value(row, "tela")
            if not system and not fabric:
                continue
            tariffs.append({key: tariff_map.value(row, key) for key in TARIFF_HEADERS})

        loaded_at = time.time()
        loaded_iso = datetime.fromtimestamp(loaded_at, HOME_EASY_TIMEZONE).isoformat(timespec="seconds")
        return Snapshot(loaded_at, clients, quotes, orders, payments, schedule, tariffs, loaded_iso, False)

    def _background_refresh(self) -> None:
        try:
            loaded = self._load()
        except Exception as exc:
            with self._condition:
                self._last_refresh_error = exc
                self._refreshing = False
                self._condition.notify_all()
            return
        with self._condition:
            self._snapshot = loaded
            self._last_refresh_error = None
            self._refreshing = False
            self._condition.notify_all()

    def _start_background_refresh_locked(self) -> None:
        if self._refreshing:
            return
        self._refreshing = True
        threading.Thread(
            target=self._background_refresh,
            name="hommy-sheet-refresh",
            daemon=True,
        ).start()

    @staticmethod
    def _as_stale(snapshot: Snapshot, stale: bool) -> Snapshot:
        return snapshot if snapshot.stale is stale else replace(snapshot, stale=stale)

    @staticmethod
    def _raise_load_error(exc: Exception | None) -> None:
        if isinstance(exc, HomeEasyDataError):
            raise exc
        raise HomeEasyDataError("No fue posible actualizar los datos de HomeEasy.") from exc

    def _blocking_refresh(self, current: Snapshot | None, *, allow_stale: bool) -> Snapshot:
        with self._condition:
            if self._refreshing:
                deadline = time.monotonic() + self.refresh_wait_timeout
                while self._refreshing:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        candidate = self._snapshot
                        if allow_stale and candidate and time.time() - candidate.loaded_at < self.stale_ttl:
                            return self._as_stale(candidate, True)
                        raise HomeEasyDataError("La actualización de Google Sheets superó el tiempo de espera seguro.")
                    self._condition.wait(timeout=min(remaining, 5.0))
                candidate = self._snapshot
                if candidate is not None and candidate is not current:
                    return self._as_stale(candidate, False)
                if allow_stale and candidate and time.time() - candidate.loaded_at < self.stale_ttl:
                    return self._as_stale(candidate, True)
                self._raise_load_error(self._last_refresh_error)
            self._refreshing = True
        try:
            loaded = self._load()
        except Exception as exc:
            with self._condition:
                self._last_refresh_error = exc
                self._refreshing = False
                self._condition.notify_all()
            if allow_stale and current and time.time() - current.loaded_at < self.stale_ttl:
                return self._as_stale(current, True)
            self._raise_load_error(exc)
        with self._condition:
            self._snapshot = loaded
            self._last_refresh_error = None
            self._refreshing = False
            self._condition.notify_all()
        return loaded

    def snapshot(self, *, force: bool = False, require_fresh: bool = False) -> Snapshot:
        with self._condition:
            current = self._snapshot
            age = time.time() - current.loaded_at if current else float("inf")
            if current and not force and age < self.ttl:
                return self._as_stale(current, False)
            if current and not force and not require_fresh and age < self.stale_ttl:
                self._start_background_refresh_locked()
                return self._as_stale(current, True)
        return self._blocking_refresh(current, allow_stale=not force and not require_fresh)

    @staticmethod
    def _updated_at(snapshot: Snapshot) -> str:
        return snapshot.loaded_at_iso or datetime.fromtimestamp(
            snapshot.loaded_at, HOME_EASY_TIMEZONE
        ).isoformat(timespec="seconds")

    def cache_status(self, snapshot: Snapshot | None = None) -> dict[str, Any]:
        with self._condition:
            current = snapshot or self._snapshot
            refreshing = self._refreshing
        return {
            "ready": current is not None,
            "dataUpdatedAt": self._updated_at(current) if current else None,
            "stale": bool(current.stale) if current else False,
            "ageSeconds": round(max(0, time.time() - current.loaded_at), 1) if current else None,
            "refreshing": refreshing,
        }

    def bootstrap(self) -> dict[str, Any]:
        return self.cache_status(self.snapshot())

    @staticmethod
    def _reconciled_orders(snapshot: Snapshot) -> list[dict[str, Any]]:
        return [
            reconcile_order(order, snapshot.payments.get(normalize_op_number(order.get("numero")), []))
            for order in snapshot.orders
        ]

    def search_clients(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        needle = normalize(query)
        if len(needle) < 2:
            return []
        needle_digits = re.sub(r"\D", "", str(query or ""))
        rows = []
        for cid, client in self.snapshot().clients.items():
            score = max(
                100 if needle == field else 80 if field.startswith(needle) else 60 if needle in field else 0
                for field in map(normalize, [client.get("nombre"), cid, client.get("telefono")])
            )
            if len(needle_digits) >= 2:
                for value in (cid, client.get("telefono")):
                    field_digits = re.sub(r"\D", "", str(value or ""))
                    score = max(
                        score,
                        100 if needle_digits == field_digits else 80 if field_digits.startswith(needle_digits) else 60 if needle_digits in field_digits else 0,
                    )
            if score:
                rows.append((score, client))
        rows.sort(key=lambda item: (-item[0], normalize(item[1].get("nombre"))))
        return [self._public_client(row) for _, row in rows[: max(1, min(limit, 10))]]

    @staticmethod
    def _public_client(client: dict[str, Any]) -> dict[str, Any]:
        all_orders = [reconcile_order(row) for row in list(client.get("ordenes", []))]
        active_orders = [row for row in all_orders if row.get("estado_financiero") != "ANULADO"]

        def order_key(row: dict[str, Any]) -> tuple[date, int, str]:
            number = normalize_op_number(row.get("numero"))
            digits = re.sub(r"\D", "", number)
            return parse_date(row.get("fecha")) or date.min, int(digits or 0), number

        active_orders.sort(
            key=order_key
        )
        latest = active_orders[-1] if active_orders else None
        return {
            "cedula": client.get("cedula", ""),
            "nombre": client.get("nombre", ""),
            "telefono": client.get("telefono", ""),
            "email": client.get("email", ""),
            "direccion": client.get("direccion", ""),
            "cotizaciones": list(client.get("cotizaciones", []))[-10:],
            "ordenes": active_orders[-10:],
            "resumen_compras": {
                "cantidad_ordenes": len(active_orders),
                "total_comprado_cop": sum(int(row.get("total_cop") or 0) for row in active_orders),
                "total_abonado_cop": sum(int(row.get("abonado_total_cop") or 0) for row in active_orders),
                "saldo_total_cop": sum(int(row.get("saldo_cop") or 0) for row in active_orders),
                "ordenes_en_revision": sum(row.get("estado_financiero") == "REVISAR" for row in active_orders),
                "ultima_compra": None
                if latest is None
                else {
                    "numero": latest.get("numero", ""),
                    "fecha": latest.get("fecha", ""),
                    "total_cop": int(latest.get("total_cop") or 0),
                    "saldo_cop": int(latest.get("saldo_cop") or 0),
                    "estado_financiero": latest.get("estado_financiero", ""),
                },
            },
        }

    def get_order(self, number: str, *, require_fresh: bool = False) -> dict[str, Any] | None:
        clean = normalize_op_number(number)
        snapshot = self.snapshot(require_fresh=require_fresh)
        order = next((row for row in snapshot.orders if normalize_op_number(row.get("numero")) == clean), None)
        return None if order is None else reconcile_order(order, snapshot.payments.get(clean, []))

    def pending_balances(self, limit: int = 30, *, require_fresh: bool = False) -> list[dict[str, Any]]:
        snapshot = self.snapshot(require_fresh=require_fresh)
        rows = [
            row
            for row in self._reconciled_orders(snapshot)
            if row.get("estado_financiero") != "ANULADO" and int(row.get("saldo_cop") or 0) > 0
        ]
        rows.sort(key=lambda row: int(row.get("saldo_cop") or 0), reverse=True)
        return rows[: max(1, min(limit, 100))]

    def pending_balances_summary(self, limit: int = 20, *, require_fresh: bool = False) -> dict[str, Any]:
        """Return a deterministic portfolio total plus a bounded display list."""

        snapshot = self.snapshot(require_fresh=require_fresh)
        rows = [
            row
            for row in self._reconciled_orders(snapshot)
            if row.get("estado_financiero") != "ANULADO" and int(row.get("saldo_cop") or 0) > 0
        ]
        rows.sort(key=lambda row: int(row.get("saldo_cop") or 0), reverse=True)
        bounded = rows[: max(1, min(limit, 100))]
        return {
            "total_pendiente_cop": sum(int(row.get("saldo_cop") or 0) for row in rows),
            "cantidad": len(rows),
            "ordenes_en_revision": sum(row.get("estado_financiero") == "REVISAR" for row in rows),
            "mayor_saldo": dict(rows[0]) if rows else None,
            "ordenes": [dict(row) for row in bounded],
            "datos_actualizados": self._updated_at(snapshot),
            "stale": snapshot.stale,
        }

    def schedule_for(self, day: str) -> list[dict[str, Any]]:
        target = parse_date(day)
        rows = [] if not target else [
            dict(item) for item in self.snapshot().schedule if parse_date(item.get("fecha")) == target
        ]
        rows.sort(key=lambda item: time_sort_key(item.get("hora")))
        return rows

    def schedule_between(self, period: ResolvedPeriod) -> list[dict[str, Any]]:
        rows = [
            dict(item)
            for item in self.snapshot().schedule
            if (day := parse_date(item.get("fecha"))) and period.start <= day <= period.end
        ]
        rows.sort(key=lambda item: (parse_date(item.get("fecha")) or date.min, *time_sort_key(item.get("hora"))))
        return rows

    def recent_sales(self, limit: int = 5, *, require_fresh: bool = False) -> list[dict[str, Any]]:
        snapshot = self.snapshot(require_fresh=require_fresh)
        rows = [row for row in self._reconciled_orders(snapshot) if row.get("estado_financiero") != "ANULADO"]

        def key(order: dict[str, Any]) -> tuple[date, int]:
            digits = re.sub(r"\D", "", str(order.get("numero") or ""))
            return parse_date(order.get("fecha")) or date.min, int(digits or 0)

        rows.sort(key=key, reverse=True)
        return rows[: max(1, min(limit, 20))]

    def analyze_sales_period(
        self,
        period: ResolvedPeriod,
        *,
        require_fresh: bool = False,
        include_orders: bool = True,
    ) -> dict[str, Any]:
        snapshot = self.snapshot(require_fresh=require_fresh)
        result = summarize_sales(
            self._reconciled_orders(snapshot),
            period,
            data_updated_at=self._updated_at(snapshot),
        )
        result["stale"] = snapshot.stale
        if not include_orders:
            result.pop("ordenes", None)
        return result

    def sales_report(self, start: str, end: str) -> dict[str, Any]:
        start_date, end_date = parse_date(start), parse_date(end)
        if not start_date or not end_date or start_date > end_date:
            raise ValueError("Rango de fechas inválido.")
        period = ResolvedPeriod("rango_personalizado", "rango solicitado", start_date, end_date)
        result = self.analyze_sales_period(period)
        result["fecha_inicio"] = start_date.isoformat()
        result["fecha_fin"] = end_date.isoformat()
        return result

    def compare_current_month(self, *, now: date | datetime | None = None) -> dict[str, Any]:
        periods = month_comparison_periods(now)
        snapshot = self.snapshot()
        orders = self._reconciled_orders(snapshot)
        updated_at = self._updated_at(snapshot)
        current = summarize_sales(orders, periods.current, data_updated_at=updated_at)
        previous_full = summarize_sales(orders, periods.previous_full, data_updated_at=updated_at)
        previous_same = summarize_sales(orders, periods.previous_same_days, data_updated_at=updated_at)
        for summary in (current, previous_full, previous_same):
            summary.pop("ordenes", None)
        result = compare_sales(current, previous_full, previous_same)
        result["stale"] = snapshot.stale
        return result

    def payment_history(self, order_number: str) -> dict[str, Any] | None:
        order = self.get_order(order_number, require_fresh=True)
        if not order:
            return None
        return {
            "numero": order.get("numero"),
            "cliente": order.get("nombre"),
            "fecha": order.get("fecha"),
            "descripcion": order.get("descripcion"),
            "total": order.get("total"),
            "abono_inicial": order.get("abono_inicial"),
            "total_cop": order.get("total_cop", 0),
            "abono_inicial_cop": order.get("abono_inicial_cop", 0),
            "abonos_extra_cop": order.get("abonos_extra_cop", 0),
            "abonado_total_cop": order.get("abonado_total_cop", 0),
            "saldo_cop": order.get("saldo_cop", 0),
            "saldo_explicito_cop": order.get("saldo_explicito_cop"),
            "estado": order.get("estado"),
            "estado_financiero": order.get("estado_financiero"),
            "integrity_ok": order.get("integrity_ok", True),
            "integrity_warnings": list(order.get("integrity_warnings") or []),
            "abonos": list(order.get("abonos_extra") or []),
            "url_pdf": order.get("url_pdf", ""),
        }

    def latest_quote(self, *, require_fresh: bool = False) -> dict[str, Any] | None:
        rows = sorted(
            (dict(row) for row in self.snapshot(require_fresh=require_fresh).quotes),
            key=quote_sort_key,
            reverse=True,
        )
        return rows[0] if rows else None

    def recent_quotes(self, limit: int = 5) -> list[dict[str, Any]]:
        rows = sorted((dict(row) for row in self.snapshot().quotes), key=quote_sort_key, reverse=True)
        return rows[: max(1, min(limit, 20))]

    def query_quotes(
        self,
        *,
        period: ResolvedPeriod | None = None,
        client: str = "",
        state: str = "",
        limit: int = 5,
        require_fresh: bool = False,
    ) -> list[dict[str, Any]]:
        client_filter, state_filter = normalize(client), normalize(state)
        rows = []
        for quote in self.snapshot(require_fresh=require_fresh).quotes:
            day = parse_date(quote.get("fecha"))
            if period and (not day or day < period.start or day > period.end):
                continue
            if client_filter and not any(
                client_filter in normalize(value) for value in (quote.get("nombre"), quote.get("cedula"))
            ):
                continue
            if state_filter and state_filter not in normalize(quote.get("estado")):
                continue
            rows.append(dict(quote))
        rows.sort(key=quote_sort_key, reverse=True)
        return rows[: max(1, min(limit, 50))]

    def analyze_quotes_period(self, period: ResolvedPeriod) -> dict[str, Any]:
        snapshot = self.snapshot()
        result = summarize_quotes(snapshot.quotes, period, data_updated_at=self._updated_at(snapshot))
        result["stale"] = snapshot.stale
        return result

    def summary(self) -> dict[str, Any]:
        snapshot = self.snapshot()
        orders = [row for row in self._reconciled_orders(snapshot) if row.get("estado_financiero") != "ANULADO"]
        return {
            "clientes": len(snapshot.clients),
            "cotizaciones": len(snapshot.quotes),
            "ventas": len(orders),
            "ventas_activas": sum(normalize(row.get("estado")) == "activo" for row in orders),
            "ventas_completadas": sum(normalize(row.get("estado")) in {"completado", "completada"} for row in orders),
            "vendido": sum(int(row.get("total_cop") or 0) for row in orders),
            "abonado": sum(int(row.get("abonado_total_cop") or 0) for row in orders),
            "pendiente": sum(int(row.get("saldo_cop") or 0) for row in orders),
            "datos_actualizados": self._updated_at(snapshot),
            "stale": snapshot.stale,
        }

    @staticmethod
    def _tariff_value(row: dict[str, Any], canonical: str, legacy: str) -> Any:
        return row.get(canonical, row.get(legacy, ""))

    def catalog(
        self,
        *,
        system: str = "",
        fabric: str = "",
        privacy: str = "",
        tag: str = "",
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        filters = tuple(map(normalize, (system, fabric, privacy, tag)))
        rows = []
        for row in self.snapshot().tariffs:
            fields = (
                normalize(self._tariff_value(row, "sistema", "Sistema")),
                normalize(self._tariff_value(row, "tela", "Nombre_Tela")),
                normalize(self._tariff_value(row, "privacidad", "Privacidad")),
                normalize(self._tariff_value(row, "etiqueta_venta", "Etiqueta_Venta")),
            )
            if all(not wanted or wanted in field for wanted, field in zip(filters, fields)):
                rows.append(dict(row))
        rows.sort(key=lambda row: money_number(self._tariff_value(row, "precio_m2", "Precio_M2")))
        return [
            {
                "sistema": self._tariff_value(row, "sistema", "Sistema"),
                "tela": self._tariff_value(row, "tela", "Nombre_Tela"),
                "precio_m2": money_number(self._tariff_value(row, "precio_m2", "Precio_M2")),
                "privacidad": self._tariff_value(row, "privacidad", "Privacidad"),
                "etiqueta": self._tariff_value(row, "etiqueta_venta", "Etiqueta_Venta"),
                "argumento_venta": self._tariff_value(row, "argumento_venta", "Argumento_Venta"),
                "notas_tecnicas": self._tariff_value(row, "notas_tecnicas", "Notas_Tecnicas"),
                "ancho_maximo": money_number(self._tariff_value(row, "ancho_maximo", "Ancho_Maximo")),
                "alto_maximo": money_number(self._tariff_value(row, "alto_maximo", "Alto_Maximo")),
            }
            for row in rows[: max(1, min(limit, 12))]
        ]

    def quote_product(
        self,
        *,
        system: str,
        fabric: str,
        width: float,
        height: float,
        quantity: int = 1,
        headrail_upgrade: bool = False,
        renueva: bool = False,
    ) -> dict[str, Any]:
        if width > 10:
            width /= 100
        if height > 10:
            height /= 100
        quantity = max(1, min(int(quantity), 50))
        if width <= 0 or height <= 0:
            raise ValueError("Las medidas deben ser mayores a cero.")
        system_filter, fabric_filter = normalize(system), normalize(fabric)
        if not system_filter or not fabric_filter:
            return {
                "ok": False,
                "code": "MISSING_TARIFF_REFERENCE",
                "suggestions": self.catalog(system=system, fabric=fabric, limit=5),
            }
        matches = [
            row
            for row in self.snapshot().tariffs
            if system_filter in normalize(self._tariff_value(row, "sistema", "Sistema"))
            and fabric_filter in normalize(self._tariff_value(row, "tela", "Nombre_Tela"))
        ]
        if not matches:
            return {"ok": False, "code": "TARIFF_NOT_FOUND", "suggestions": self.catalog(system=system, fabric=fabric, limit=5)}
        exact_matches = [
            row
            for row in matches
            if system_filter == normalize(self._tariff_value(row, "sistema", "Sistema"))
            and fabric_filter == normalize(self._tariff_value(row, "tela", "Nombre_Tela"))
        ]
        if exact_matches:
            matches = exact_matches
        reference_keys = {
            (
                normalize(self._tariff_value(candidate, "sistema", "Sistema")),
                normalize(self._tariff_value(candidate, "tela", "Nombre_Tela")),
                money_number(self._tariff_value(candidate, "precio_m2", "Precio_M2")),
                money_number(self._tariff_value(candidate, "precio_renueva_m2", "Precio_Renueva_M2")),
                money_number(self._tariff_value(candidate, "cobro_min_m2", "Cobro_Min_M2")),
                money_number(self._tariff_value(candidate, "cobro_min_alto", "Cobro_Min_Alto")),
                money_number(self._tariff_value(candidate, "ancho_maximo", "Ancho_Maximo")),
                money_number(self._tariff_value(candidate, "alto_maximo", "Alto_Maximo")),
                normalize(self._tariff_value(candidate, "recargos_mecanismo", "Recargos_Mecanismo")),
            )
            for candidate in matches
        }
        if len(reference_keys) > 1:
            return {
                "ok": False,
                "code": "AMBIGUOUS_TARIFF",
                "suggestions": self.catalog(system=system, fabric=fabric, limit=5),
            }
        row = matches[0]
        price = money_number(self._tariff_value(row, "precio_m2", "Precio_M2"))
        if price <= 0:
            return {"ok": False, "code": "INVALID_TARIFF_PRICE"}
        if renueva:
            price = money_number(self._tariff_value(row, "precio_renueva_m2", "Precio_Renueva_M2"))
            if price <= 0:
                return {"ok": False, "code": "RENEW_NOT_AVAILABLE"}
        surcharge = 0.0
        surcharge_text = str(self._tariff_value(row, "recargos_mecanismo", "Recargos_Mecanismo") or "")
        if headrail_upgrade and (match := re.search(r"\+\s*([\d.,]+)", surcharge_text)):
            surcharge = money_number(match.group(1))
            price += surcharge
        min_area = money_number(self._tariff_value(row, "cobro_min_m2", "Cobro_Min_M2"))
        min_height = money_number(self._tariff_value(row, "cobro_min_alto", "Cobro_Min_Alto"))
        max_width = money_number(self._tariff_value(row, "ancho_maximo", "Ancho_Maximo"))
        max_height = money_number(self._tariff_value(row, "alto_maximo", "Alto_Maximo"))
        if max_width <= 0 or max_height <= 0:
            return {"ok": False, "code": "INVALID_TARIFF_LIMITS"}
        issues = []
        if width > max_width:
            issues.append(f"El ancho {width:.2f} m supera el máximo de {max_width:.2f} m para esta referencia.")
        if height > max_height:
            issues.append(f"El alto {height:.2f} m supera el máximo de {max_height:.2f} m para esta referencia.")
        if "enrollable" in system_filter and height > width * 3:
            issues.append("La relación alto/ancho presenta riesgo de efecto cono.")
        if "sheer" in system_filter and height > 3:
            issues.append("La altura supera 3 m; requiere validación específica de cabezal/mecanismo.")
        system_name = self._tariff_value(row, "sistema", "Sistema") or system
        fabric_name = self._tariff_value(row, "tela", "Nombre_Tela") or fabric
        if width > max_width or height > max_height:
            return {
                "ok": False,
                "code": "OUTSIDE_TECHNICAL_LIMITS",
                "sistema": system_name,
                "tela": fabric_name,
                "medidas": {"ancho_m": width, "alto_m": height},
                "issues": issues,
            }
        area = max(width * max(height, min_height), min_area)
        material = area * price * quantity
        install = money_number(
            os.getenv(
                "HOMMY_INSTALL_ONDA" if "onda" in system_filter else "HOMMY_INSTALL_DEFAULT",
                "50000" if "onda" in system_filter else "30000",
            )
        ) * quantity
        subtotal = material + install
        vat = subtotal * float(os.getenv("HOMMY_VAT_RATE", "0.19"))
        transport = money_number(os.getenv("HOMMY_TRANSPORT", "50000"))
        total = subtotal + vat + transport
        snapshot = self.snapshot()
        return {
            "ok": True,
            "sistema": system_name,
            "tela": fabric_name,
            "medidas": {"ancho_m": round(width, 3), "alto_m": round(height, 3)},
            "cantidad": quantity,
            "modalidad": "renueva" if renueva else "completa",
            "cabezal_lujo": bool(headrail_upgrade),
            "recargo_cabezal_unitario_m2": round(surcharge),
            "area_cobrada_m2_unitaria": round(area, 3),
            "material": round(material),
            "instalacion": round(install),
            "iva": round(vat),
            "transporte": round(transport),
            "total": round(total),
            "advertencias_tecnicas": issues,
            "tarifa_actualizada": self._updated_at(snapshot),
            "stale": snapshot.stale,
        }
