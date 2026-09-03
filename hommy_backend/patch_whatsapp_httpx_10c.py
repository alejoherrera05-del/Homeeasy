from pathlib import Path

path = Path('hommy_backend/whatsapp_context.py')
text = path.read_text(encoding='utf-8')
text = text.replace('import requests\n', 'import httpx\n', 1)
text = text.replace('self.http = requests.Session()', 'self.http = httpx.Client(timeout=self.timeout, follow_redirects=True)', 1)
text = text.replace(
    '''            response = self.http.get(\n                f"{self.bridge_url}/api/whatsapp/conversation",\n                params=params,\n                headers=headers,\n                timeout=self.timeout,\n                allow_redirects=True,\n            )\n''',
    '''            response = self.http.get(\n                f"{self.bridge_url}/api/whatsapp/conversation",\n                params=params,\n                headers=headers,\n            )\n''',
    1,
)
text = text.replace('except requests.Timeout:', 'except httpx.TimeoutException:', 1)
text = text.replace('except (requests.RequestException, ValueError):', 'except (httpx.HTTPError, ValueError):', 1)
path.write_text(text, encoding='utf-8')
