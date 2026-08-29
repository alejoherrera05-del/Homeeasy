from pathlib import Path
import re

patterns = [
    (re.compile(r'VERSIÓN\s*2\.0\b'), 'VERSIÓN 3.0'),
    (re.compile(r'VERSION\s*2\.0\b'), 'VERSION 3.0'),
    (re.compile(r'Versión\s*2\.0\b'), 'Versión 3.0'),
    (re.compile(r'Version\s*2\.0\b'), 'Version 3.0'),
    (re.compile(r'versión\s*2\.0\b'), 'versión 3.0'),
    (re.compile(r'version\s*2\.0\b'), 'version 3.0'),
    (re.compile(r'\bV2\.0\b'), 'V3.0'),
    (re.compile(r'\bv2\.0\b'), 'v3.0'),
]
changed=[]
for p in sorted(Path('.').rglob('*.html')):
    if '.git' in p.parts:
        continue
    raw=p.read_bytes()
    text=raw.decode('utf-8')
    newline='\r\n' if b'\r\n' in raw else '\n'
    norm=text.replace('\r\n','\n')
    updated=norm
    for rx,repl in patterns:
        updated=rx.sub(repl,updated)
    if updated != norm:
        out=updated if newline=='\n' else updated.replace('\n','\r\n')
        p.write_bytes(out.encode('utf-8'))
        changed.append(p.as_posix())

if not changed:
    raise SystemExit('No visible HomeEasy 2.0 labels found to patch')
print('HOME_EASY_V3_CHANGED='+','.join(changed))
