import os
import sys
import time
import types
import unittest

if 'requests' not in sys.modules:
    requests = types.ModuleType('requests')
    class RequestException(Exception): pass
    class Timeout(RequestException): pass
    requests.RequestException = RequestException
    requests.Timeout = Timeout
    requests.post = lambda *a, **k: None
    sys.modules['requests'] = requests
if 'gspread' not in sys.modules:
    gspread = types.ModuleType('gspread'); gspread.authorize = lambda creds: None; sys.modules['gspread'] = gspread
if 'google' not in sys.modules:
    google = types.ModuleType('google'); oauth2 = types.ModuleType('google.oauth2'); service_account = types.ModuleType('google.oauth2.service_account')
    class Credentials:
        @classmethod
        def from_service_account_info(cls, *a, **k): return cls()
        @classmethod
        def from_service_account_file(cls, *a, **k): return cls()
    service_account.Credentials = Credentials; google.oauth2 = oauth2; oauth2.service_account = service_account
    sys.modules['google'] = google; sys.modules['google.oauth2'] = oauth2; sys.modules['google.oauth2.service_account'] = service_account
if 'openai' not in sys.modules:
    openai = types.ModuleType('openai')
    class OpenAI:
        def __init__(self, *a, **k): pass
    openai.OpenAI = OpenAI; sys.modules['openai'] = openai

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, ROOT)
from hommy_backend.auth import AuthContext
from hommy_backend.data import HomeEasyDataStore, Snapshot, money_number
from hommy_backend.engine import ConversationSigner
from hommy_backend.tools import ToolPermissionError, execute_tool


def make_store():
    store = HomeEasyDataStore(); store.ttl = 99999
    store._snapshot = Snapshot(time.time(), {
        '123': {'cedula':'123','nombre':'Andrea López','telefono':'3001112233','email':'andrea@example.com','direccion':'Centro','cotizaciones':[],'ordenes':[]},
        '456': {'cedula':'456','nombre':'Carlos Pérez','telefono':'3115556677','email':'carlos@example.com','direccion':'Norte','cotizaciones':[],'ordenes':[]},
    }, [], [
        {'numero':'10','fecha':'2026-08-20','cedula':'123','nombre':'Andrea López','descripcion':'Sheer','total':'$1.000.000','abono_inicial':'$300.000','saldo':'$700.000','estado':'ACTIVO','url_pdf':'https://example.com/op10.pdf','abonos_extra':[]},
        {'numero':'11','fecha':'2026-08-21','cedula':'456','nombre':'Carlos Pérez','descripcion':'Panel','total':'$900.000','abono_inicial':'$900.000','saldo':'$0','estado':'COMPLETADO','url_pdf':'','abonos_extra':[]},
    ], {}, [{'id':'1','fecha':'2026-08-27','hora':'10:00','categoria':'Visita','titulo':'Medición','cliente':'Andrea López','estado':'PENDIENTE'}], [{
        'Sistema':'Sheer Elegance','Nombre_Tela':'Serenade','Precio_M2':'100000','Precio_Renueva_M2':'60000','Recargos_Mecanismo':'+ 10000','Cobro_Min_M2':'1.5','Cobro_Min_Alto':'1.0','Ancho_Maximo':'3.0','Alto_Maximo':'3.0','Privacidad':'Media','Etiqueta_Venta':'Premium','Argumento_Venta':'Elegante','Notas_Tecnicas':'',
    }])
    return store


class BackendContractTests(unittest.TestCase):
    def setUp(self):
        os.environ['HOMMY_CONVERSATION_SECRET'] = 'test-secret-never-production'
        self.store = make_store()
        self.full = AuthContext('u1','Alejandro Herrera','a@example.com','ADMIN',frozenset({'app.access','clientes.read','ventas.read','caja.read','agenda.read','reportes.read','cotizaciones.write'}))
        self.limited = AuthContext('u2','Asesor','b@example.com','ASESOR',frozenset({'app.access'}))

    def test_colombian_money_parser(self):
        self.assertEqual(money_number('$1.250.000'), 1250000); self.assertEqual(money_number('1.250.000,50'), 1250000.5)

    def test_client_search_is_precise(self):
        rows = self.store.search_clients('Andrea'); self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['cedula'], '123')

    def test_permissions_block_business_data(self):
        with self.assertRaises(ToolPermissionError): execute_tool('buscar_cliente', {'criterio':'Andrea'}, self.limited, self.store)

    def test_quote_rejects_outside_limits(self):
        self.assertTrue(self.store.quote_product(system='Sheer Elegance', fabric='Serenade', width=2, height=2)['ok'])
        bad = self.store.quote_product(system='Sheer Elegance', fabric='Serenade', width=3.5, height=2); self.assertFalse(bad['ok']); self.assertEqual(bad['code'], 'OUTSIDE_TECHNICAL_LIMITS'); self.assertNotIn('total', bad)

    def test_tool_returns_structured_quote_card(self):
        result = execute_tool('cotizar_producto', {'sistema':'Sheer Elegance','tela':'Serenade','ancho':2.0,'alto':2.0,'cantidad':1,'incluir_lujo':False,'solo_renueva':False}, self.full, self.store)
        self.assertTrue(result['ok']); self.assertEqual(result['ui'][0]['type'], 'quote')

    def test_conversation_token_is_bound_to_user(self):
        signer = ConversationSigner(); token = signer.sign('conv_abc123', 'u1'); self.assertEqual(signer.verify(token, 'u1'), 'conv_abc123'); self.assertIsNone(signer.verify(token, 'u2'))
        payload, signature = token.split('.', 1); tampered = ('A' if payload[0] != 'A' else 'B') + payload[1:]; self.assertIsNone(signer.verify(tampered + '.' + signature, 'u1'))


if __name__ == '__main__': unittest.main(verbosity=2)
