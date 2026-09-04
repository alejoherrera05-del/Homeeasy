from pathlib import Path

server_path = Path('servidor.py')
followup_path = Path('hommy_backend/followup.py')
test_path = Path('tests/test_hommy_followup.py')

server = server_path.read_text(encoding='utf-8')
if 'import hashlib\n' not in server:
    server = server.replace('import os\n', 'import hashlib\nimport os\n', 1)

old_import = 'from hommy_backend.auth import HommyAuthError, SessionValidator, decode_client_meta, safety_identifier'
new_import = 'from hommy_backend.auth import AuthContext, HommyAuthError, SessionValidator, decode_client_meta, safety_identifier'
if old_import in server:
    server = server.replace(old_import, new_import, 1)
elif new_import not in server:
    raise SystemExit('Could not find Hommy auth import')

auth_anchor = '''def auth_context():\n    return validator.validate(\n        request.headers.get("X-HomeEasy-Session", ""),\n        client_meta=decode_client_meta(request.headers.get("X-HomeEasy-Meta", "")),\n    )\n\n\n'''
followup_auth = '''def followup_auth_context():\n    """Create a local read-only identity; HomeEasy detail remains the authoritative auth gate.\n\n    Follow-up analysis used to validate the same HomeEasy session twice in sequence:\n    AUTH_VALIDAR_SESION and then protected GET_SEGUIMIENTO_DETALLE. The first call\n    added a 12-second failure point without granting access to any data. This context\n    contains no customer identity and no write capability. The planner's first external\n    data operation is GET_SEGUIMIENTO_DETALLE, which validates the opaque session and\n    cotizaciones.read inside HomeEasy before any commercial or WhatsApp context exists.\n    """\n    token = str(request.headers.get("X-HomeEasy-Session", "") or "").strip()\n    if not token:\n        raise HommyAuthError("Tu sesión de HomeEasy no está disponible.", "AUTH_REQUIRED", 401)\n    salt = os.getenv("HOMMY_SAFETY_SALT", "homeeasy-hommy-v2")\n    uid = "followup:" + hashlib.sha256(f"{salt}:followup:{token}".encode("utf-8")).hexdigest()\n    return AuthContext(\n        uid=uid,\n        name="",\n        email="",\n        role="FOLLOWUP_READ",\n        permissions=frozenset({"app.access", "cotizaciones.read"}),\n    )\n\n\n'''
if 'def followup_auth_context():' not in server:
    if auth_anchor not in server:
        raise SystemExit('Could not find auth_context anchor')
    server = server.replace(auth_anchor, auth_anchor + followup_auth, 1)

route_anchor = '''@app.post("/api/hommy/followup/plan", provide_automatic_options=False)\ndef hommy_followup_plan():\n    started = time.perf_counter()\n    auth_started = time.perf_counter()\n    context = auth_context()\n'''
route_replacement = '''@app.post("/api/hommy/followup/plan", provide_automatic_options=False)\ndef hommy_followup_plan():\n    started = time.perf_counter()\n    auth_started = time.perf_counter()\n    # Do not call AUTH_VALIDAR_SESION here. GET_SEGUIMIENTO_DETALLE below is already\n    # protected by HomeEasy and is the single authoritative read-session gate.\n    context = followup_auth_context()\n'''
if route_anchor in server:
    server = server.replace(route_anchor, route_replacement, 1)
elif 'context = followup_auth_context()' not in server:
    raise SystemExit('Could not find follow-up route auth anchor')
server_path.write_text(server, encoding='utf-8')

followup = followup_path.read_text(encoding='utf-8')
old_timeout = 'self.timeout = max(5, min(int(os.getenv("HOMMY_FOLLOWUP_HOME_EASY_TIMEOUT_SECONDS", "18")), 45))'
new_timeout = 'self.timeout = max(5, min(int(os.getenv("HOMMY_FOLLOWUP_HOME_EASY_TIMEOUT_SECONDS", "25")), 45))'
if old_timeout in followup:
    followup = followup.replace(old_timeout, new_timeout, 1)
elif new_timeout not in followup:
    raise SystemExit('Could not find HomeEasy follow-up timeout')
followup_path.write_text(followup, encoding='utf-8')

tests = test_path.read_text(encoding='utf-8')
old_permission_test = '''    def test_requires_quote_permission(self):\n        denied = AuthContext("u2", "Asesor", "a@example.invalid", "ASESOR", frozenset({"app.access"}))\n        with patch.object(servidor, "auth_context", return_value=denied):\n            response = self.client.post(\n                "/api/hommy/followup/plan", json={"numero": "32"},\n                headers={"X-HomeEasy-Session": "test-session"},\n            )\n        self.assertEqual(response.status_code, 403)\n        self.assertEqual(response.get_json()["error"]["code"], "PERMISSION_DENIED")\n\n'''
new_permission_test = '''    def test_followup_local_context_is_read_only_opaque_and_skips_duplicate_auth(self):\n        planner = Mock()\n        planner.plan.return_value = {\n            "quoteNumber": "32", "planId": "FUP-TEST",\n            "generatedAt": "2026-09-03T14:00:00-05:00", "sourceStateVersion": 3,\n            "playbookVersion": "1.0", "schemaVersion": "1", "stage": "10B",\n            "model": "fake", "reviewOnly": True, "analysisMs": 1.0, "plan": valid_plan(),\n        }\n        with patch.object(servidor.validator, "validate", side_effect=AssertionError("duplicate auth called")), patch.object(\n            servidor, "get_followup_planner", return_value=planner\n        ):\n            response = self.client.post(\n                "/api/hommy/followup/plan", json={"numero": "32"},\n                headers={"X-HomeEasy-Session": "test-session"},\n            )\n        self.assertEqual(response.status_code, 200)\n        context = planner.plan.call_args.args[1]\n        self.assertEqual(context.permissions, frozenset({"app.access", "cotizaciones.read"}))\n        self.assertFalse(context.has("cotizaciones.write"))\n        self.assertTrue(context.uid.startswith("followup:"))\n        self.assertNotIn("test-session", context.uid)\n\n'''
if old_permission_test in tests:
    tests = tests.replace(old_permission_test, new_permission_test, 1)
elif 'test_followup_local_context_is_read_only_opaque_and_skips_duplicate_auth' not in tests:
    raise SystemExit('Could not find old follow-up permission HTTP test')

tests = tests.replace('with patch.object(servidor, "auth_context", return_value=self.ctx), patch.object(\n            servidor, "get_followup_planner", return_value=planner\n        ):', 'with patch.object(servidor, "followup_auth_context", return_value=self.ctx), patch.object(\n            servidor, "get_followup_planner", return_value=planner\n        ):', 1)

insert_anchor = '''    def test_homeeasy_client_only_reads_detail_route(self):\n'''
new_gate_tests = '''    def test_homeeasy_detail_remains_authoritative_permission_gate(self):\n        client = HomeEasyFollowupClient()\n        response = Mock()\n        response.raise_for_status.return_value = None\n        response.json.return_value = {\n            "status": "error", "code": "PERMISSION_DENIED",\n            "msg": "Sin permiso cotizaciones.read",\n        }\n        from hommy_backend.followup import FollowupPermissionError\n        with patch("hommy_backend.followup.requests.post", return_value=response):\n            with self.assertRaises(FollowupPermissionError):\n                client.detail("32", session_token="invalid-for-read", client_meta={})\n\n    def test_homeeasy_detail_rejects_expired_session_without_fail_open(self):\n        client = HomeEasyFollowupClient()\n        response = Mock()\n        response.raise_for_status.return_value = None\n        response.json.return_value = {\n            "status": "error", "code": "APP_SESSION_EXPIRED",\n            "msg": "La sesión venció.",\n        }\n        from hommy_backend.followup import FollowupUpstreamError\n        with patch("hommy_backend.followup.requests.post", return_value=response):\n            with self.assertRaises(FollowupUpstreamError) as raised:\n                client.detail("32", session_token="expired", client_meta={})\n        self.assertEqual(raised.exception.status_code, 401)\n        self.assertEqual(raised.exception.code, "APP_SESSION_EXPIRED")\n\n'''
if 'test_homeeasy_detail_remains_authoritative_permission_gate' not in tests:
    if insert_anchor not in tests:
        raise SystemExit('Could not find HomeEasy client test anchor')
    tests = tests.replace(insert_anchor, new_gate_tests + insert_anchor, 1)

test_path.write_text(tests, encoding='utf-8')
print('Hommy follow-up auth resilience 10D.2 patch applied')
