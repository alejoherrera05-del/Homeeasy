import time
import unittest
from datetime import date
from unittest.mock import patch

from hommy_backend.data import (
    CLIENT_HEADERS,
    HeaderMap,
    HomeEasyDataError,
    HomeEasyDataStore,
    Snapshot,
)
from hommy_backend.periods import ResolvedPeriod


class _Worksheet:
    def __init__(self, rows):
        self.rows = rows

    def get_all_values(self):
        return self.rows


class _Book:
    def __init__(self, sheets):
        self.sheets = sheets

    def worksheet(self, name):
        return _Worksheet(self.sheets[name])


def synthetic_sheets():
    order_headers = [
        "Fecha", "Numero_OP", "Cedula", "Nombre_Cliente", "Descripcion_Detallada",
        "Observaciones", "Valor_Total", "Abono_Inicial", "Abono_2", "Abono_3",
        "Abono_4", "Abono_5", "Abono_6", "Abono_7", "Abono_8", "Abono_9",
        "Abono_10", "Saldo_Pendiente", "Estado", "URL_PDF_OP", "",
        "Estado_Abono_Inicial", "Abono_Inicial_Afecta_Caja",
        "Abono_Inicial_Afecta_Saldo", "Anulacion_ID", "Tratamiento_Financiero",
        "OP_Destino_Credito",
    ]
    order = [
        "28/08/2026", "OP 38", "900", "Cliente Prueba", "Sheer", "",
        "$2.900.000", "$1.450.000", "", "", "", "", "", "", "", "", "",
        "$1.250.000", "ACTIVO", "https://example.com/op38.pdf", "", "ACTIVO",
        "SI", "SI", "", "NORMAL", "",
    ]
    return {
        "Clientes": [
            ["Cedula_NIT", "Nombre_Completo", "Telefono", "Email", "Direccion_Instalacion", "Fecha_Registro"],
            ["900", "Cliente Prueba", "3000000000", "cliente@example.com", "Calle 1", "01/01/2026"],
        ],
        "Cotizaciones": [
            ["Numero_Cotizacion", "Fecha", "Cedula_Cliente", "Nombre_Completo", "Descripcion_Items", "Observaciones", "Total_Cotizado", "URL_PDF_Cotizacion", "", "Estado", "Notas de Seguimiento"],
            ["104", "28/08/2026", "900", "Cliente Prueba", "Sheer", "", "$1.000.000", "https://example.com/cot104.pdf", "", "PENDIENTE", ""],
        ],
        "Ordenes_Pedido": [order_headers, order],
        "Abonos": [
            ["Numero_Recibo", "Numero_OP", "Cedula", "Nombre_Cliente", "Fecha_Pago", "Valor_Abono", "Medio_Pago", "URL_PDF_Recibo", "Estado_Registro", "Afecta_Caja", "Afecta_Saldo", "Tipo_Registro", "Anulacion_ID", "OP_Origen", "Notas_Ajuste"],
            ["R-1", "38", "900", "Cliente Prueba", "27/08/2026", "$200.000", "TRANSFERENCIA", "", "ACTIVO", "SI", "SI", "ABONO", "", "", ""],
        ],
        "Agenda": [
            ["ID", "Fecha", "Hora", "Categoria", "Titulo", "Cliente", "Referencia - Notas", "Estado"],
            ["A-1", "28/08/2026", "10:00", "VISITA", "Medición", "Cliente Prueba", "", "PENDIENTE"],
        ],
        "Tarifas": [
            ["Sistema", "Colores_Disponibles", "Nombre_Tela", "Precio_M2", "Precio_Renueva_M2", "Privacidad", "Ancho_Minimo", "Ancho_Maximo", "Alto_Maximo", "Cobro_Min_M2", "Cobro_Min_Alto", "Proporcion_Tela", "Espacio_Instalacion_cm", "Garantia", "Apto_Motorizacion", "Recargos_Mecanismo", "Etiqueta_Venta", "Argumento_Venta", "Notas_Tecnicas"],
            ["Sheer Elegance", "Blanco", "Serenade", "100000", "60000", "Media", "0.5", "3", "3", "1.5", "1", "", "", "3 años", "SI", "+ 10000", "Premium", "Elegante", ""],
        ],
    }


class HeaderDrivenDataTests(unittest.TestCase):
    def test_header_map_handles_aliases_and_reordering(self):
        mapping = HeaderMap.build(
            "Clientes",
            ["Correo Electrónico", "nombre cliente", "DOCUMENTO", "Celular"],
            CLIENT_HEADERS,
            required=("cedula", "nombre"),
        )
        row = ["test@example.com", "Cliente", "123", "3000000000"]
        self.assertEqual(mapping.value(row, "cedula"), "123")
        self.assertEqual(mapping.value(row, "nombre"), "Cliente")
        self.assertEqual(mapping.value(row, "telefono"), "3000000000")

    def test_missing_required_header_fails_closed(self):
        with self.assertRaises(HomeEasyDataError):
            HeaderMap.build("Clientes", ["Telefono"], CLIENT_HEADERS, required=("cedula", "nombre"))

    def test_payment_controls_are_required_to_reconcile_finances(self):
        sheets = synthetic_sheets()
        sheets["Abonos"][0] = sheets["Abonos"][0][:8]
        sheets["Abonos"][1] = sheets["Abonos"][1][:8]
        store = HomeEasyDataStore()
        with patch.object(store, "_credentials", return_value=object()), patch(
            "hommy_backend.data.gspread.authorize"
        ) as authorize:
            authorize.return_value.open_by_key.return_value = _Book(sheets)
            with self.assertRaises(HomeEasyDataError):
                store._load()

    def test_order_financial_controls_are_required(self):
        sheets = synthetic_sheets()
        for header in ("Estado_Abono_Inicial", "Abono_Inicial_Afecta_Saldo", "Anulacion_ID"):
            index = sheets["Ordenes_Pedido"][0].index(header)
            sheets["Ordenes_Pedido"][0][index] = f"Cabecera cambiada {header}"
        store = HomeEasyDataStore()
        with patch.object(store, "_credentials", return_value=object()), patch(
            "hommy_backend.data.gspread.authorize"
        ) as authorize:
            authorize.return_value.open_by_key.return_value = _Book(sheets)
            with self.assertRaises(HomeEasyDataError):
                store._load()

    def test_tariff_calculation_headers_are_required(self):
        sheets = synthetic_sheets()
        for header in ("Precio_Renueva_M2", "Ancho_Maximo", "Alto_Maximo", "Cobro_Min_M2", "Cobro_Min_Alto"):
            index = sheets["Tarifas"][0].index(header)
            sheets["Tarifas"][0][index] = f"Cabecera cambiada {header}"
        store = HomeEasyDataStore()
        with patch.object(store, "_credentials", return_value=object()), patch(
            "hommy_backend.data.gspread.authorize"
        ) as authorize:
            authorize.return_value.open_by_key.return_value = _Book(sheets)
            with self.assertRaises(HomeEasyDataError):
                store._load()

    def test_sheets_client_uses_bounded_connect_and_read_timeouts(self):
        store = HomeEasyDataStore()
        store.sheets_connect_timeout = 4.0
        store.sheets_read_timeout = 19.0
        with patch.object(store, "_credentials", return_value=object()), patch(
            "hommy_backend.data.gspread.authorize"
        ) as authorize:
            authorize.return_value.open_by_key.return_value = _Book(synthetic_sheets())
            store._load()
        authorize.return_value.http_client.set_timeout.assert_called_once_with((4.0, 19.0))

    def test_live_layout_positions_are_parsed_by_header_and_reconciled(self):
        store = HomeEasyDataStore()
        book = _Book(synthetic_sheets())
        with patch.object(store, "_credentials", return_value=object()), patch(
            "hommy_backend.data.gspread.authorize"
        ) as authorize:
            authorize.return_value.open_by_key.return_value = book
            snapshot = store._load()
        order = snapshot.orders[0]
        self.assertEqual(order["numero"], "38")
        self.assertEqual(order["saldo_explicito_cop"], 1_250_000)
        self.assertEqual(order["abonado_total_cop"], 1_650_000)
        self.assertEqual(order["saldo_cop"], 1_250_000)
        self.assertEqual(order["estado_financiero"], "ABONADO")
        self.assertTrue(order["integrity_ok"])
        self.assertEqual(order["url_pdf"], "https://example.com/op38.pdf")
        self.assertEqual(snapshot.quotes[0]["numero"], "104")
        self.assertEqual(snapshot.tariffs[0]["tela"], "Serenade")

    def test_client_latest_order_uses_numeric_op_order_on_same_date(self):
        client = {
            "cedula": "900",
            "nombre": "Cliente Prueba",
            "ordenes": [
                {"numero": "OP 10", "fecha": "2026-08-28", "total": "$10", "saldo": "$0"},
                {"numero": "OP 9", "fecha": "2026-08-28", "total": "$9", "saldo": "$0"},
            ],
        }

        result = HomeEasyDataStore._public_client(client)

        self.assertEqual(result["resumen_compras"]["ultima_compra"]["numero"], "10")

    def test_client_search_normalizes_phone_and_document_punctuation(self):
        store = HomeEasyDataStore()
        store._snapshot = Snapshot(
            loaded_at=time.time(),
            clients={"10.530.101": {"cedula": "10.530.101", "nombre": "Cliente Prueba", "telefono": "300 123 4567"}},
            quotes=[], orders=[], payments={}, schedule=[], tariffs=[],
        )

        self.assertEqual(store.search_clients("3001234567")[0]["cedula"], "10.530.101")
        self.assertEqual(store.search_clients("10530101")[0]["telefono"], "300 123 4567")

    def test_agenda_orders_non_padded_and_meridiem_hours_chronologically(self):
        store = HomeEasyDataStore()
        store._snapshot = Snapshot(
            loaded_at=time.time(), clients={}, quotes=[], orders=[], payments={}, tariffs=[],
            schedule=[
                {"fecha": "2026-08-28", "hora": "10:00", "titulo": "Segundo"},
                {"fecha": "2026-08-28", "hora": "9:00", "titulo": "Primero"},
                {"fecha": "2026-08-28", "hora": "1:00 p. m.", "titulo": "Tercero"},
            ],
        )

        expected = ["Primero", "Segundo", "Tercero"]
        self.assertEqual([row["titulo"] for row in store.schedule_for("2026-08-28")], expected)
        period = ResolvedPeriod("hoy", "hoy", date(2026, 8, 28), date(2026, 8, 28))
        self.assertEqual([row["titulo"] for row in store.schedule_between(period)], expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
