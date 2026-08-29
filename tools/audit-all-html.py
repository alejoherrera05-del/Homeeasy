from pathlib import Path
import re, json, sys
from urllib.parse import urlsplit

ROOT = Path('.').resolve()
HTMLS = sorted(p for p in ROOT.rglob('*.html') if '.git' not in p.parts)
ATTR_RE = re.compile(r'\b(?:src|href)\s*=\s*["\']([^"\']+)["\']', re.I)
ID_RE = re.compile(r'\bid\s*=\s*["\']([^"\']+)["\']', re.I)
VERSION_RE = re.compile(r'(?:VERSI[ÓO]N|Versi[oó]n|Version)\s*2\.0\b|\bv2\.0\b', re.I)
MATERIAL_RE = re.compile(r'material-icons(?:-round)?|material-symbols', re.I)
MATERIAL_FONT_RE = re.compile(r'fonts\.googleapis\.com/.+(?:Material\+Icons|Material\+Symbols)', re.I)
LOCAL_SKIP = ('http://','https://','//','data:','mailto:','tel:','javascript:','#','blob:')

issues=[]
versions=[]
summary=[]
for p in HTMLS:
    rel=p.relative_to(ROOT).as_posix()
    text=p.read_text(encoding='utf-8', errors='replace')
    file_issues=[]
    if '<html' not in text.lower() or '</html>' not in text.lower():
        file_issues.append('missing html root/closing tag')
    if '<title' not in text.lower():
        file_issues.append('missing <title>')
    if text.lower().count('<script') != text.lower().count('</script>'):
        file_issues.append('unbalanced <script> tags')
    if text.lower().count('<style') != text.lower().count('</style>'):
        file_issues.append('unbalanced <style> tags')

    ids=ID_RE.findall(text)
    dup=sorted({x for x in ids if ids.count(x)>1})
    if dup:
        file_issues.append('duplicate ids: '+', '.join(dup[:12]))

    if MATERIAL_RE.search(text) and not MATERIAL_FONT_RE.search(text):
        # Font Awesome classes containing no material text do not count.
        if re.search(r'class=["\'][^"\']*material-(?:icons|symbols)', text, re.I):
            file_issues.append('Material icon classes present without Material font import')

    for raw in ATTR_RE.findall(text):
        raw=raw.strip()
        if not raw or raw.startswith(LOCAL_SKIP):
            continue
        parsed=urlsplit(raw)
        target=parsed.path
        if not target or target.startswith('/'):
            candidate=ROOT/target.lstrip('/')
        else:
            candidate=(p.parent/target).resolve()
        try:
            candidate.relative_to(ROOT)
        except ValueError:
            continue
        if not candidate.exists():
            file_issues.append(f'missing local target: {raw}')

    v=VERSION_RE.findall(text)
    if v:
        versions.append({'file':rel,'count':len(v)})
    if file_issues:
        issues.append({'file':rel,'issues':sorted(set(file_issues))})
    summary.append({'file':rel,'bytes':p.stat().st_size,'version2_hits':len(v),'issues':len(set(file_issues))})

report={'html_count':len(HTMLS),'files':summary,'issues':issues,'version2':versions}
Path('audit-html-static.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'HTML_COUNT={len(HTMLS)}')
print(f'STATIC_ISSUE_FILES={len(issues)}')
print(f'VERSION2_FILES={len(versions)}')
for item in issues:
    print('STATIC_ISSUE',item['file'],'|','; '.join(item['issues']))
for item in versions:
    print('VERSION2',item['file'],item['count'])
# Static issues are reported, not fatal here; browser audit decides production blockers.
