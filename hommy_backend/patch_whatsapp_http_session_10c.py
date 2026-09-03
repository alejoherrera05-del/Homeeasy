from pathlib import Path

context_path = Path('hommy_backend/whatsapp_context.py')
context = context_path.read_text(encoding='utf-8')
old_init = '''        raw_timeout = timeout if timeout is not None else int(os.getenv("HOMMY_WHATSAPP_CONTEXT_TIMEOUT_SECONDS", "18"))\n        self.timeout = max(5, min(int(raw_timeout), 40))\n'''
new_init = old_init + '''        self.http = requests.Session()\n'''
if 'self.http = requests.Session()' not in context:
    if old_init not in context:
        raise SystemExit('WhatsApp client init anchor missing')
    context = context.replace(old_init, new_init, 1)
context = context.replace(
    '''            response = requests.get(\n''',
    '''            response = self.http.get(\n''',
    1,
)
context_path.write_text(context, encoding='utf-8')

test_path = Path('tests/test_hommy_whatsapp_context.py')
tests = test_path.read_text(encoding='utf-8')
tests = tests.replace(
    '''        with patch("hommy_backend.whatsapp_context.requests.get", return_value=response) as get:\n            result = client.context(\n''',
    '''        with patch.object(client.http, "get", return_value=response) as get:\n            result = client.context(\n''',
    1,
)
tests = tests.replace(
    '''        with patch("hommy_backend.whatsapp_context.requests.get") as get:\n            result = client.context(\n''',
    '''        with patch.object(client.http, "get") as get:\n            result = client.context(\n''',
    1,
)
test_path.write_text(tests, encoding='utf-8')
