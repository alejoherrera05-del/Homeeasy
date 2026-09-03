from pathlib import Path

page_path = Path('seguimiento.html')
page = page_path.read_text(encoding='utf-8')
old = "retry.src = 'seguimiento-hommy.js?v=10c2-retry';"
new = "retry.src = 'seguimiento-hommy.js?v=10d1-retry';"
if old in page:
    page = page.replace(old, new, 1)
elif new not in page:
    raise SystemExit('Seguimiento retry anchor not found')
page_path.write_text(page, encoding='utf-8')

workflow = '''name: Seguimiento Hommy QA

on:
  push:
    branches:
      - main
      - hommy-followup-ui-10b
      - seguimiento-hommy-loader-10c2
      - seguimiento-review-send-ui-10d
    paths:
      - 'seguimiento.html'
      - 'seguimiento-hommy.js'
      - 'homeeasy-whatsapp-client.js'
      - 'tests/seguimiento-hommy-10b-qa.mjs'
      - '.github/workflows/seguimiento-hommy-qa.yml'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  qa:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Validate extension syntax
        run: |
          node --check seguimiento-hommy.js
          node --check homeeasy-whatsapp-client.js

      - name: Install ephemeral browser-test dependency
        run: npm install --no-save --no-package-lock jsdom@24.1.3

      - name: Run Seguimiento Hommy browser contract
        run: node tests/seguimiento-hommy-10b-qa.mjs

      - name: Verify REVIEW-only human-send boundary
        run: |
          python - <<'PY'
          from pathlib import Path
          page = Path('seguimiento.html').read_text(encoding='utf-8')
          source = Path('seguimiento-hommy.js').read_text(encoding='utf-8')
          client = Path('homeeasy-whatsapp-client.js').read_text(encoding='utf-8')
          tag = '<script src="seguimiento-hommy.js?v=10d1" defer></script>'
          assert page.count(tag) == 1
          assert 'seguimiento-hommy.js?v=10d1-retry' in page
          assert 'homeeasy-whatsapp-client.js?v=0.6.0' in page
          assert 'const REQUEST_TIMEOUT_MS = 90_000;' in source
          assert '/api/hommy/followup/plan' in source
          assert "hasPermission('cotizaciones.write')" in source
          assert "sendLabel.textContent = 'Revisar y enviar'" in source
          assert "tipo: 'ACTUALIZAR_ESTADO_SEGUIMIENTO_IA'" in source
          assert "tipo: 'REGISTRAR_EVENTO_SEGUIMIENTO'" in source
          assert "eventType: 'MESSAGE_SENT'" in source
          assert "request('/api/whatsapp/send-followup'" in client
          start = client.index('function sendFollowup(options)')
          end = client.index('function connectedPhone', start)
          assert 'phone:' not in client[start:end]
          assert 'setInterval(' not in source
          print('Seguimiento Hommy 10D REVIEW-only contract: PASS')
          PY

      - name: Diff hygiene
        run: git diff --check HEAD^ HEAD
'''
Path('.github/workflows/seguimiento-hommy-qa.yml').write_text(workflow, encoding='utf-8')
print('Seguimiento 10D QA fix applied')
