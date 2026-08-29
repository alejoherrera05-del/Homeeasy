from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "clientes-conectado-v31.html"
html = TARGET.read_text(encoding="utf-8")

replacements = {
    "shell.append(buildContact(c),buildSummary(orders));": "shell.append(buildContact(c));",
    "actions.append(wa,bottomMore);card.append(actions);return card}": "actions.append(wa);card.append(actions);return card}",
}
for old, new in replacements.items():
    if old not in html:
        raise SystemExit(f"No se encontró el patrón esperado: {old}")
    html = html.replace(old, new, 1)

style_marker = '</style>\n\n<script id="clientes-connected-v31-script">'
if style_marker not in html:
    raise SystemExit("No se encontró el cierre del estilo de Clientes 3.1")

refinement_css = r'''
/* --- Auditoría de producto v3.3: menos ruido, acciones inequívocas --- */
.v31-summary{display:none!important}
.v31-contact-actions{grid-template-columns:minmax(0,1fr)!important}
.v31-more-bottom{display:none!important}
.v31-order-actions{grid-template-columns:minmax(280px,420px) 150px!important;justify-content:start!important;align-items:stretch!important;gap:10px!important}
.v31-history-toggle{height:62px!important;justify-content:flex-start!important;padding:0 16px!important;border:1px solid #eadde1!important;background:linear-gradient(180deg,#fffdfd 0%,#fff9fa 100%)!important;border-radius:16px!important;box-shadow:0 5px 16px rgba(178,86,108,.045)!important;gap:11px!important;text-align:left!important}
.v31-history-toggle:hover{background:#fdf4f6!important;border-color:#dfc6cc!important;box-shadow:0 8px 20px rgba(178,86,108,.09)!important;transform:translateY(-1px)}
.v31-history-toggle>i:first-child{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:var(--v31-brand-soft);color:var(--v31-brand);flex:0 0 auto;font-size:14px}
.v31-history-toggle>span:not(.v31-history-count){display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;font-weight:640}
.v31-history-toggle>span:not(.v31-history-count)::after{content:"Ver recibos y movimientos";margin-top:4px;color:var(--v31-muted);font-size:11px;font-weight:450;letter-spacing:0}
.v31-history-count{margin-left:auto!important;min-width:26px!important;height:26px!important;background:#fff!important;border-color:#e8d5da!important;font-size:11px!important}
.v31-history-chevron{margin-left:1px;color:var(--v31-brand);font-size:13px}
.v31-view-op{height:62px!important;border-radius:16px!important;font-weight:610!important}
.v31-history-title{background:#fff!important;font-weight:590!important;color:#555159!important}
.v31-payment-row{min-height:60px!important}
@media(max-width:760px){
  .v31-order-actions{grid-template-columns:minmax(0,1fr) 118px!important}
  .v31-history-toggle{height:58px!important;padding:0 13px!important;gap:9px!important}
  .v31-view-op{height:58px!important}
  .v31-history-toggle>span:not(.v31-history-count)::after{font-size:10.5px}
}
@media(max-width:390px){
  .v31-order-actions{grid-template-columns:1fr!important}
  .v31-view-op{height:50px!important}
}
'''
html = html.replace(style_marker, refinement_css + '\n' + style_marker, 1)

# Safety assertions for the visible product surface.
assert "shell.append(buildContact(c));" in html
assert "shell.append(buildContact(c),buildSummary(orders));" not in html
assert "actions.append(wa);card.append(actions);return card}" in html
assert "actions.append(wa,bottomMore)" not in html
assert ".v31-summary{display:none!important}" in html
assert "Ver recibos y movimientos" in html

TARGET.write_text(html, encoding="utf-8")
print(f"Refined {TARGET.name}: {TARGET.stat().st_size} bytes")
