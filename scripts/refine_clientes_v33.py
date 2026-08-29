from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "clientes-conectado-v31.html"
html = TARGET.read_text(encoding="utf-8")

replacements = {
    "shell.append(buildContact(client),buildSummary(orders));": "shell.append(buildContact(client));",
    "actions.append(wa,bottomMore);card.append(actions);return card}": "actions.append(wa);card.append(actions);return card}",
}
for old, new in replacements.items():
    if old in html:
        html = html.replace(old, new, 1)

# Remove JS that became unreachable after the approved UI simplification.
html, removed_summary = re.subn(
    r"\nfunction buildSummary\(orders\)\{.*?\}\nfunction statusClass",
    "\nfunction statusClass",
    html,
    count=1,
)
html, removed_bottom_more = re.subn(
    r"const bottomMore=el\('button','v31-more-bottom'\);.*?bottomMore\.onclick=\(\)=>openClientMenu\(c\);actions\.append\(wa\);",
    "actions.append(wa);",
    html,
    count=1,
)
html, removed_active_items = re.subn(
    r",activeItems=items=>\(Array\.isArray\(items\)\?items:\[\]\)\.filter\(i=>!/ANUL/i\.test\(clean\(i\?\.estado\)\)\)",
    "",
    html,
    count=1,
)

script_marker = '<script id="clientes-connected-v31-script">'
script_pos = html.find(script_marker)
if script_pos < 0:
    raise SystemExit("No se encontró el script visual de Clientes 3.1")
style_pos = html.rfind('</style>', 0, script_pos)
if style_pos < 0:
    raise SystemExit("No se encontró el cierre del estilo de Clientes 3.1")

refinement_css = r'''
/* --- Auditoría de producto v3.3: menos ruido, acciones inequívocas --- */
.v31-summary{display:none!important}
.v31-contact{position:relative!important}
.v31-identity{grid-template-columns:76px minmax(0,1fr)!important;padding-right:54px!important}
.v31-more{position:absolute!important;right:22px!important;top:22px!important;z-index:2}
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
@media(max-width:520px){
  .v31-identity{grid-template-columns:70px minmax(0,1fr)!important;padding-right:48px!important}
  .v31-more{right:18px!important;top:20px!important}
  .v31-title{font-size:16.5px!important;letter-spacing:-.02em!important}
}
@media(max-width:390px){
  .v31-order-actions{grid-template-columns:1fr!important}
  .v31-view-op{height:50px!important}
}
'''
# The generated file may already contain this refinement when rebuilding from a promoted source.
if '/* --- Auditoría de producto v3.3: menos ruido, acciones inequívocas --- */' not in html:
    html = html[:style_pos] + refinement_css + '\n' + html[style_pos:]

# Title requested for the final product surface.
html = html.replace("el('span','', 'Clientes')", "el('span','', 'Base de datos clientes')", 1)

# Safety assertions for the visible and executable surface.
assert "shell.append(buildContact(client));" in html
assert "shell.append(buildContact(client),buildSummary(orders));" not in html
assert "actions.append(wa);card.append(actions);return card}" in html
assert "actions.append(wa,bottomMore)" not in html
assert "function buildSummary(orders)" not in html
assert "const bottomMore=" not in html
assert "activeItems=items=>" not in html
assert "Base de datos clientes" in html
assert "Ver recibos y movimientos" in html

TARGET.write_text(html, encoding="utf-8")
print(
    f"Refined {TARGET.name}: {TARGET.stat().st_size} bytes; "
    f"dead-summary={removed_summary}, dead-menu={removed_bottom_more}, dead-helper={removed_active_items}"
)
