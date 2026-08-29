from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "clientes-conectado-v31.html"
OUTPUT = ROOT / "clientes-production-final.html"
html = SOURCE.read_text(encoding="utf-8")

# Preview builds inline the guard so the alternate preview URL can authenticate.
# Production is the canonical clientes.html route and should use the shared guard,
# exactly like the rest of HomeEasy, so future auth/session fixes propagate.
pattern = re.compile(r'<script id="clientes-v31-inline-guard">[\s\S]*?</script>', re.I)
html, count = pattern.subn('<script src="homeeasy-page-guard.js?v=3.6"></script>', html, count=1)
if count != 1:
    raise SystemExit(f"Expected one inline preview guard, replaced {count}")

# Preview-only permission mapping must not remain embedded in production.
if "'clientes-conectado-v31.html': 'clientes.read'" in html:
    raise SystemExit("Preview permission mapping leaked into production HTML")
if 'clientes-v31-inline-guard' in html:
    raise SystemExit("Inline preview guard still present")
if '<script src="homeeasy-page-guard.js?v=3.6"></script>' not in html:
    raise SystemExit("Shared production guard missing")

OUTPUT.write_text(html, encoding="utf-8")
print(f"Finalized {OUTPUT.name}: {OUTPUT.stat().st_size} bytes")
