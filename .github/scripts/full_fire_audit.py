from pathlib import Path
import re, json, subprocess, sys

ROOT=Path('.')
errors=[]; warnings=[]; checks=[]
HTMLS=sorted(ROOT.glob('*.html'))
JS_FILES=sorted([p for p in ROOT.rglob('*.js') if '.github' not in p.parts])

# JS syntax
for p in JS_FILES:
    r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
    if r.returncode: errors.append(f'JS_SYNTAX:{p}:{r.stderr.strip()}')
checks.append(f'js_files={len(JS_FILES)}')

# Inline JS syntax
inline_count=0
for p in HTMLS:
    txt=p.read_text(encoding='utf-8',errors='replace')
    for i,m in enumerate(re.finditer(r'<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>',txt,re.S|re.I),1):
        attrs=m.group('attrs') or ''
        if re.search(r'\bsrc\s*=',attrs,re.I): continue
        typem=re.search(r'\btype\s*=\s*["\']([^"\']+)',attrs,re.I)
        stype=(typem.group(1).lower() if typem else '')
        if stype in ('application/json','importmap'): continue
        body=m.group('body')
        if not body.strip(): continue
        inline_count+=1
        tmp=Path('/tmp')/f'he_inline_{p.stem}_{i}.js'; tmp.write_text(body,encoding='utf-8')
        r=subprocess.run(['node','--check',str(tmp)],capture_output=True,text=True)
        if r.returncode: errors.append(f'INLINE_JS_SYNTAX:{p}#{i}:{r.stderr.strip()}')
checks.append(f'inline_scripts={inline_count}')

# Real static references only: HTML src/href + ES module imports
missing=set()
def check_ref(source, ref):
    clean=ref.split('#')[0].split('?')[0]
    if not clean or clean.startswith(('http://','https://','data:','mailto:','tel:','javascript:','#')): return
    target=(source.parent/clean).resolve()
    try: target.relative_to(ROOT.resolve())
    except Exception: return
    if not target.exists(): missing.add(f'{source}:{clean}')

for p in HTMLS:
    txt=p.read_text(encoding='utf-8',errors='replace')
    for ref in re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)',txt,re.I): check_ref(p,ref)
for p in JS_FILES:
    txt=p.read_text(encoding='utf-8',errors='replace')
    imports=[]
    imports += re.findall(r'\bfrom\s*["\']([^"\']+)["\']',txt)
    imports += re.findall(r'\bimport\s*\(\s*["\']([^"\']+)["\']\s*\)',txt)
    for ref in imports:
        if ref.startswith('.'): check_ref(p,ref)
if missing: errors += [f'MISSING_REF:{x}' for x in sorted(missing)]
checks.append(f'html_files={len(HTMLS)}')

# Static duplicate IDs excluding script/style/template-generated strings
for p in HTMLS:
    txt=p.read_text(encoding='utf-8',errors='replace')
    stripped=re.sub(r'<script\b.*?</script>|<style\b.*?</style>', '', txt, flags=re.S|re.I)
    ids=re.findall(r'\bid\s*=\s*["\']([^"\']+)',stripped,re.I)
    dups=sorted({x for x in ids if ids.count(x)>1})
    if dups: errors.append(f'DUPLICATE_STATIC_IDS:{p}:{dups}')

# Shared auth/core consistency
internal=['index.html','clientes.html','ventas.html','cotizacion.html','seguimiento.html','pedido.html','abono.html','caja.html','documentos.html','calendario.html','reportes.html','configuracion.html','perfil.html','Hommychat.html','asistente.html']
for name in internal:
    p=ROOT/name
    if not p.exists(): errors.append(f'MISSING_INTERNAL_PAGE:{name}'); continue
    txt=p.read_text(encoding='utf-8',errors='replace')
    if 'homeeasy-core.js?v=3.3' not in txt: errors.append(f'STALE_CORE_REF:{name}')
    if name!='index.html' and 'homeeasy-page-guard.js' not in txt: errors.append(f'MISSING_PAGE_GUARD:{name}')

# Navigation regression checks
core=(ROOT/'homeeasy-core.js').read_text(encoding='utf-8')
for needle in ['HomeEasy Core v3.3','function goHome()','installInternalHomeNavigation()','isFastHomeReturn()','#intro-curtain{display:none!important}']:
    if needle not in core: errors.append(f'NAV_CORE_MISSING:{needle}')
box=(ROOT/'caja.html').read_text(encoding='utf-8')
if 'HomeEasyCore.goHome' not in box: errors.append('CAJA_PIN_BACK_NOT_SMART')

# Loader semantics
idx=(ROOT/'index.html').read_text(encoding='utf-8')
if 'APP_INIT_DONE' not in idx: errors.append('INDEX_INTRO_SESSION_MARKER_MISSING')
if 'setTimeout(() => { closeIntro(); }, 5500)' in idx: warnings.append('INDEX_FIRST_ENTRY_INTRO_MAX_5_5S')

# AR critical architecture
ar_required=['ar-homeeasy-v3.html','production/studio-core.js','production/ar-app-v2.js','production/ar-ui-v2.css','production/vendor/model-viewer-4.3.1.min.js','products/sheer/studio-product.js','products/panel/studio-product.js','products/onda/studio-product.js']
for name in ar_required:
    if not (ROOT/name).exists(): errors.append(f'AR_REQUIRED_MISSING:{name}')
ar=(ROOT/'ar-homeeasy-v3.html').read_text(encoding='utf-8',errors='replace')
for needle in ['id="viewer"','id="product"','production/ar-ui-v2.css','production/ar-app-v2.js','ar-placement="wall"','ar-scale="fixed"']:
    if needle not in ar: errors.append(f'AR_HTML_MISSING:{needle}')
studio=(ROOT/'production/studio-core.js').read_text(encoding='utf-8')
for prod in ['sheer','panel','onda']:
    if prod not in studio: errors.append(f'AR_PRODUCT_LOADER_MISSING:{prod}')

# Private key leakage only (Firebase web api key is intentionally public)
for p in [*HTMLS,*JS_FILES]:
    txt=p.read_text(encoding='utf-8',errors='replace')
    if 'BEGIN PRIVATE KEY' in txt: errors.append(f'PRIVATE_KEY_EXPOSED:{p}')

result={'status':'ok' if not errors else 'error','errors':errors,'warnings':warnings,'checks':checks}
Path('FIRE_AUDIT_STATIC.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(result,indent=2,ensure_ascii=False))
sys.exit(1 if errors else 0)
