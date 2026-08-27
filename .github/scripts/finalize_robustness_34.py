from pathlib import Path
import subprocess

EXPECTED={
 'login.html':'374a34b585fdaa5cabf69e11188f3eae05748dd0',
 'calendario.html':'148984cc155154b9e06f239e7c25755dc6786ea3',
 'homeeasy-page-guard.js':'bef92f4237c723472e0e9171ebf4dc0cce682e80',
}
def sha(p): return subprocess.check_output(['git','hash-object',p],text=True).strip()
def once(text,old,new,label):
    if old not in text: raise SystemExit('Missing expected block: '+label)
    return text.replace(old,new,1)
for p,s in EXPECTED.items():
    if sha(p)!=s: raise SystemExit(f'{p} changed unexpectedly: {sha(p)} != {s}')

# Login: Firebase identity alone must never auto-enter HomeEasy.
p=Path('login.html'); t=p.read_text(encoding='utf-8')
old="""async function initializeLogin(){if(!auth){configNotice.classList.add('visible');configNotice.innerHTML='<strong>Archivo central no disponible</strong>No se pudo cargar homeeasy-auth.js.';submitButton.disabled=true;return}if(!auth.isConfigured()){configNotice.classList.add('visible');submitButton.disabled=true;emailInput.disabled=true;passwordInput.disabled=true;rememberInput.disabled=true;return}setBusy(true,'Comprobando sesión');try{const user=await auth.restoreSession({validate:false});if(user){location.replace(returnUrl);return}}catch(e){}setBusy(false);setTimeout(()=>emailInput.focus(),120)}"""
new="""async function initializeLogin(){if(!auth){configNotice.classList.add('visible');configNotice.innerHTML='<strong>Archivo central no disponible</strong>No se pudo cargar homeeasy-auth.js.';submitButton.disabled=true;return}if(!auth.isConfigured()){configNotice.classList.add('visible');submitButton.disabled=true;emailInput.disabled=true;passwordInput.disabled=true;rememberInput.disabled=true;return}setBusy(true,'Comprobando sesión');try{let appSession=auth.getCachedHomeEasySession?auth.getCachedHomeEasySession():null;if(appSession){location.replace(returnUrl);return}const user=await auth.restoreSession({validate:false});appSession=auth.getCachedHomeEasySession?auth.getCachedHomeEasySession():null;if(appSession){location.replace(returnUrl);return}if(user&&user.email&&!emailInput.value)emailInput.value=user.email||''}catch(e){}setBusy(false);setTimeout(()=>passwordInput.focus(),120)}"""
t=once(t,old,new,'login initialization')
p.write_text(t,encoding='utf-8')

# Guard: stable semantic id for the denied-state screen.
p=Path('homeeasy-page-guard.js'); t=p.read_text(encoding='utf-8')
t=once(t,'<main style="min-height:100svh;','<main id="homeeasyAccessDenied" role="alert" style="min-height:100svh;','denied screen id')
p.write_text(t,encoding='utf-8')

# Calendar: remove an exact duplicate undo function. Preserve CRLF/bytes elsewhere.
p=Path('calendario.html'); data=p.read_bytes()
block=(b'       async function deshacerBorrado() {\r\n'
       b'        if (!ultimoEventoBorrado) return;\r\n'
       b'        const btnUndo = document.getElementById("undoContainer");\r\n'
       b'        btnUndo.style.display = "none"; clearTimeout(undoTimeout);\r\n\r\n'
       b'        eventosGlobales.push(ultimoEventoBorrado);\r\n'
       b'        localStorage.setItem("CACHE_EVENTOS", JSON.stringify(eventosGlobales));\r\n\r\n'
       b'        try { await fetch(WEBAPP_URL, { method: "POST", body: JSON.stringify({ tipo: "restaurar_evento", ...ultimoEventoBorrado }) }); } catch(e) {}\r\n'
       b'        ultimoEventoBorrado = null; procesarEventosLocales(); \r\n'
       b'    }\r\n')
if data.count(block)!=1: raise SystemExit(f'Expected one first-form duplicate, got {data.count(block)}')
data=data.replace(block,b'',1)
p.write_bytes(data)

print('Final robustness 3.4 cleanup applied')
