import urllib.request, json, sys
BASE='https://alejoherrera05-del.github.io/Homeeasy/'
checks={
 'homeeasy-core.js':['HomeEasy Core v3.4',"const APP_VERSION = '3.4'",'showIndexConnectionIssue'],
 'homeeasy-page-guard.js':['HomeEasy Page Guard v3.4','showConnectionIssue','homeeasyAccessDenied'],
 'homeeasy-auth.js':['HomeEasy Auth v0.4.1','isTransientError'],
 'login.html':['homeeasy-auth.js?v=3.4','restoreSession({validate:false,homeEasy:false})'],
 'caja.html':['homeeasy-core.js?v=3.4','homeeasy-page-guard.js?v=3.4','HomeEasyCore.goHome'],
 'calendario.html':['homeeasy-core.js?v=3.4','homeeasy-page-guard.js?v=3.4'],
 'ar-homeeasy-v3.html':['./production/ar-ui-v2.css','./production/ar-app-v2.js'],
 'HomeEasy_AR_Placement_V2/ar-homeeasy-placement-v2.html':['Laboratorio de ubicación AR V2','quicklook-placement-v2.js'],
}
assets=['index.html','configuracion.html','documentos.html','production/ar-app-v2.js','production/ar-ui-v2.css','production/studio-core.js','assets/auth/hommy-crossed.png']
errors=[]
print('=== LIVE HOMEEASY 3.4 DEPLOYMENT SMOKE ===')
def fetch(path,binary=False):
    req=urllib.request.Request(BASE+path,headers={'User-Agent':'HomeEasy-QA/3.4','Cache-Control':'no-cache'})
    with urllib.request.urlopen(req,timeout=25) as r:
        raw=r.read(10_000_000)
        print(r.status,path,r.headers.get('content-type',''),len(raw))
        if r.status!=200: raise RuntimeError(f'HTTP {r.status}')
        return raw if binary else raw.decode('utf-8','replace')
for path,needles in checks.items():
    try:
        text=fetch(path)
        for needle in needles:
            if needle not in text: errors.append(f'{path}: missing marker {needle!r}')
        if path=='calendario.html' and text.count('function deshacerBorrado')!=1:
            errors.append(f'calendario.html: deshacerBorrado count={text.count("function deshacerBorrado")}')
    except Exception as e: errors.append(f'{path}: {e}')
for path in assets:
    try: fetch(path,binary=path.endswith('.png'))
    except Exception as e: errors.append(f'{path}: {e}')
backend='https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec?tipo=AUTH_ESTADO'
try:
    req=urllib.request.Request(backend,headers={'User-Agent':'HomeEasy-QA/3.4'})
    with urllib.request.urlopen(req,timeout=25) as r:
        raw=r.read(200000).decode('utf-8','replace')
        print('backend',r.status,raw[:300].replace('\n',' '))
        if r.status!=200: errors.append(f'backend HTTP {r.status}')
        try: json.loads(raw)
        except: errors.append('backend response is not JSON')
except Exception as e: errors.append(f'backend reachability: {e}')
if errors:
    print('LIVE ERRORS:')
    for x in errors: print('ERROR:',x)
    sys.exit(1)
print('LIVE HOMEEASY 3.4 SMOKE PASSED')
