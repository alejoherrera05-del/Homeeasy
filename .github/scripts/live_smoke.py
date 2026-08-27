import urllib.request, urllib.error, json, sys, time
BASE='https://alejoherrera05-del.github.io/Homeeasy/'
paths=['login.html','index.html','caja.html','configuracion.html','documentos.html','ar-homeeasy-v3.html','homeeasy-core.js','homeeasy-page-guard.js','production/ar-app-v2.js','production/ar-ui-v2.css','production/studio-core.js','assets/auth/hommy-crossed.png']
errors=[]
print('=== LIVE GITHUB PAGES SMOKE ===')
for p in paths:
    url=BASE+p
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'HomeEasy-QA/1.0'})
        with urllib.request.urlopen(req,timeout=20) as r:
            code=r.status; ct=r.headers.get('content-type',''); length=r.headers.get('content-length','?')
            print(code,p,ct,length)
            if code!=200: errors.append(f'{p}: HTTP {code}')
    except Exception as e: errors.append(f'{p}: {e}')
backend='https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec?tipo=AUTH_ESTADO'
try:
    req=urllib.request.Request(backend,headers={'User-Agent':'HomeEasy-QA/1.0'})
    with urllib.request.urlopen(req,timeout=25) as r:
        raw=r.read(200000).decode('utf-8','replace')
        print('backend',r.status,raw[:300].replace('\n',' '))
        if r.status!=200: errors.append(f'backend HTTP {r.status}')
        try: json.loads(raw)
        except: errors.append('backend response is not JSON')
except Exception as e: errors.append(f'backend: {e}')
if errors:
    print('LIVE ERRORS:'); [print('ERROR:',x) for x in errors]; sys.exit(1)
print('LIVE SMOKE PASSED')
