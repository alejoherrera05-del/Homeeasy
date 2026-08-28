import unittest

from hommy_backend.auth import AuthContext
from hommy_backend.realtime import realtime_tools
from hommy_backend.tools import ToolPermissionError, execute_tool, tools_for_context


class FakeData:
    def search_clients(self, query, limit=5):
        return [
            {
                "cedula": "123",
                "nombre": "Cliente Prueba",
                "telefono": "3000000000",
                "email": "cliente@example.com",
                "direccion": "Calle 1",
                "cotizaciones": [
                    {
                        "numero": "C-1",
                        "total": "$500.000",
                        "descripcion": "Cotización privada",
                        "url_pdf": "https://example.com/cot.pdf",
                    }
                ],
                "ordenes": [
                    {
                        "numero": "10",
                        "total": "$900.000",
                        "saldo": "$100.000",
                        "descripcion": "Venta privada",
                        "url_pdf": "https://example.com/op.pdf",
                    }
                ],
            }
        ]


def context(*permissions):
    return AuthContext(
        uid="uid-test",
        name="Alejandro Test",
        email="test@example.com",
        role="TEST",
        permissions=frozenset(permissions),
    )


class HommyRbacTests(unittest.TestCase):
    def setUp(self):
        self.data = FakeData()

    def test_contact_search_never_leaks_commercial_history(self):
        ctx = context("app.access", "clientes.read")
        result = execute_tool("buscar_cliente", {"criterio": "Cliente"}, ctx, self.data)
        self.assertTrue(result["ok"])
        client = result["data"][0]
        self.assertNotIn("ordenes", client)
        self.assertNotIn("cotizaciones", client)
        self.assertEqual(client["telefono"], "3000000000")
        urls = [card.get("url") for card in result["ui"] if card.get("type") == "document"]
        self.assertEqual(urls, [])

    def test_contact_only_role_cannot_use_commercial_history_tool(self):
        ctx = context("app.access", "clientes.read")
        names = {tool["name"] for tool in tools_for_context(ctx)}
        self.assertIn("buscar_cliente", names)
        self.assertNotIn("consultar_historial_cliente", names)
        with self.assertRaises(ToolPermissionError):
            execute_tool("consultar_historial_cliente", {"criterio": "Cliente"}, ctx, self.data)

    def test_sales_role_sees_orders_but_not_quotes(self):
        ctx = context("app.access", "clientes.read", "ventas.read")
        names = {tool["name"] for tool in tools_for_context(ctx)}
        self.assertIn("consultar_historial_cliente", names)
        result = execute_tool("consultar_historial_cliente", {"criterio": "Cliente"}, ctx, self.data)
        self.assertIn("ordenes", result["data"])
        self.assertNotIn("cotizaciones", result["data"])

    def test_quote_role_sees_quotes_but_not_orders(self):
        ctx = context("app.access", "clientes.read", "cotizaciones.read")
        result = execute_tool("consultar_historial_cliente", {"criterio": "Cliente"}, ctx, self.data)
        self.assertIn("cotizaciones", result["data"])
        self.assertNotIn("ordenes", result["data"])

    def test_realtime_gets_same_permission_filtered_toolset(self):
        ctx = context("app.access", "clientes.read")
        text_names = {tool["name"] for tool in tools_for_context(ctx)}
        voice_names = {tool["name"] for tool in realtime_tools(ctx)}
        self.assertEqual(text_names, voice_names)
        self.assertNotIn("consultar_saldos_pendientes", voice_names)
        self.assertNotIn("consultar_historial_cliente", voice_names)


if __name__ == "__main__":
    unittest.main()
