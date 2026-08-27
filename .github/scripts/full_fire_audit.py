from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import re, subprocess, tempfile, json, sys

ROOT = Path('.').resolve()
PROTECTED = {
 'clientes.html','ventas.html','cotizacion.html','seguimiento.html','pedido.html','abono.html','caja.html',
 'documentos.html','calendario.html','reportes.html','configuracion.html','perfil.html','Hommychat.html','asistente.html'
}
AR_REQUIRED_IDS = {
 'viewer','ar-button','status','stage-overlay','ready-pill','product','preview-title','preview-subtitle',
 'sheer-swatches','sheer-width','sheer-height','panel-swatches','panel-width','panel-height','panel-layout',
 'panel-recommendation','onda-family','onda-collection','onda-color-count','onda-swatches','onda-width','onda-height'
}
errors=[]; warnings=[]; info=[]

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.ids=[]; self.refs=[]; self.inline=[]; self._script=None; self._attrs={}; self._buf=[]
    def handle_starttag(self, tag, attrs):
        d=dict(attrs); 
        if 'id' in d: self.ids.append(d['id'])
        for a in ('src','href','poster'):
            if a in d: self.refs.append((tag,a,d[a]))
        if tag=='script' and 'src' not in d:
            self._script=True; self._attrs=d; self._buf=[]
    def handle_endtag(self, tag):
        if tag=='script' and self._script:
            typ=(self._attrs.get('type') or '').lower()
            if not typ or 'javascript' in typ or typ=='module': self.inline.append(''.join(self._buf))
            self._script=None; self._buf=[]; self._attrs={}
    def handle_data(self, data):
        if self._script: self._buf.append(data)

def local_target(base, value):
    v=(value or '').strip()
    if not v or v.startswith(('#','data:','mailto:','tel:','javascript:','blob:','//')): return None
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', v): return None
    clean=urlsplit(v).path
    if not clean: return None
    return (base.parent / clean).resolve()

def node_check(code, label):
    if not code.strip(): return
    with tempfile.NamedTemporaryFile('w',suffix='.mjs',delete=False,encoding='utf-8') as f:
        f.write(code); name=f.name
    r=subprocess.run(['node','--check',name],text=True,capture_output=True)
    Path(name).unlink(missing_ok=True)
    if r.returncode: errors.append(f'JS syntax {label}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "error"}')

htmls=sorted(ROOT.glob('*.html'))
jsfiles=sorted([p for p in ROOT.rglob('*.js') if '.git' not in p.parts and 'node_modules' not in p.parts])
all_files={p.resolve() for p in ROOT.rglob('*') if p.is_file()}

for p in htmls:
    text=p.read_text(encoding='utf-8',errors='replace'); parser=Parser(); parser.feed(text)
    dup=sorted({x for x in parser.ids if parser.ids.count(x)>1})
    if dup: warnings.append(f'{p.name}: duplicate static ids {dup}')
    for tag,a,v in parser.refs:
        t=local_target(p,v)
        if t and t not in all_files: errors.append(f'{p.name}: broken local {a}={v}')
    for i,code in enumerate(parser.inline,1): node_check(code,f'{p.name} inline#{i}')
    if p.name in PROTECTED:
        if 'homeeasy-core.js?v=3.3' not in text: errors.append(f'{p.name}: not loading Core 3.3')
        if 'homeeasy-page-guard.js?v=3.2' not in text: warnings.append(f'{p.name}: guard cache key is not 3.2')
    if 'href="index.html"' in text and p.name!='index.html' and 'homeeasy-core.js?v=3.3' not in text:
        errors.append(f'{p.name}: links Home but cannot use Core 3.3 navigation')

for p in jsfiles:
    r=subprocess.run(['node','--check',str(p)],text=True,capture_output=True)
    if r.returncode: errors.append(f'JS syntax {p}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "error"}')
    text=p.read_text(encoding='utf-8',errors='replace')
    for spec in re.findall(r'(?:from\s+|import\s*\()?["\'](\.{1,2}/[^"\']+)["\']',text):
        t=local_target(p,spec)
        if t and t not in all_files: errors.append(f'{p}: broken import {spec}')

core=(ROOT/'homeeasy-core.js').read_text(encoding='utf-8')
guard=(ROOT/'homeeasy-page-guard.js').read_text(encoding='utf-8')
auth=(ROOT/'homeeasy-auth.js').read_text(encoding='utf-8')
if 'HomeEasy Core v3.3' not in core: errors.append('Core internal version is not 3.3')
if 'HomeEasy Page Guard v3.2' not in guard: errors.append('Page Guard internal version is not 3.2')
if "versionApp: '3.1'" in guard: warnings.append('Page Guard still reports versionApp 3.1')
if "versionApp: '3.1'" in auth: warnings.append('Auth still reports versionApp 3.1')
if '.catch(() => redirectIndexToLogin())' in core: warnings.append('Index background auth revalidation logs out on any error, including network errors')
if '.catch(() => redirectToLogin())' in guard: warnings.append('Module background auth revalidation redirects on any error, including network errors')

ar=ROOT/'ar-homeeasy-v3.html'
if ar.exists():
    txt=ar.read_text(encoding='utf-8'); par=Parser(); par.feed(txt); ids=set(par.ids)
    missing=sorted(AR_REQUIRED_IDS-ids)
    if missing: errors.append(f'AR missing required ids: {missing}')
    for req in ('./production/ar-ui-v2.css','./production/ar-app-v2.js','./production/vendor/model-viewer-4.3.1.min.js'):
        if req not in txt: errors.append(f'AR missing dependency {req}')

large=[]
for p in sorted(all_files):
    try: size=p.stat().st_size
    except: continue
    if size>2_000_000: large.append((str(p.relative_to(ROOT)),size))
info.append(f'HTML files: {len(htmls)}; JS files: {len(jsfiles)}; files >2MB: {len(large)}')
if large: info.append('Large assets: '+', '.join(f'{n}={s/1024/1024:.1f}MB' for n,s in large[:12]))

print('=== HOMEEASY STATIC FIRE AUDIT ===')
for x in info: print('INFO:',x)
for x in warnings: print('WARN:',x)
for x in errors: print('ERROR:',x)
print(json.dumps({'errors':len(errors),'warnings':len(warnings),'info':info},ensure_ascii=False))
if errors: sys.exit(1)
