#!/usr/bin/env bash
# One-time private API key setup. Does not restart WAHA or modify client sends.
set -Eeuo pipefail
umask 077
cd /opt/homeeasy-whatsapp || exit 1
if [[ "$EUID" -ne 0 || ! -f .env ]]; then
  echo "Ejecuta con sudo desde el VPS instalado en /opt/homeeasy-whatsapp." >&2
  exit 1
fi
for cmd in docker python3; do
  command -v "$cmd" >/dev/null || { echo "Falta $cmd" >&2; exit 1; }
done
BRIDGE_VERSION="$(docker exec homeeasy-whatsapp-bridge node -p \
  "require('fs').readFileSync('/app/server.js','utf8').match(/BRIDGE_VERSION = '([^']+)'/)[1]" 2>/dev/null || true)"
if [[ "$BRIDGE_VERSION" != "0.30.0" ]]; then
  echo "Primero instala Bridge 0.30.0; instalado: $BRIDGE_VERSION" >&2
  exit 1
fi
echo "Clave OpenAI: la escribirás sin que aparezca en pantalla ni en GitHub."
mkdir -p backups
BACKUP="backups/.env-before-openai-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p .env "$BACKUP"
chmod 600 "$BACKUP"
python3 - <<'PY'
import getpass, os, re, sys, tempfile, urllib.request, urllib.error
from pathlib import Path
p=Path('.env')
key=getpass.getpass('Pega tu clave de OpenAI API y pulsa Enter: ').strip()
if not re.fullmatch(r'sk-[A-Za-z0-9_-]{30,}',key):
    sys.exit('Clave OpenAI API con formato inválido; .env no se modificó.')
try:
    req=urllib.request.Request('https://api.openai.com/v1/models/gpt-5.4-mini',
                               headers={'Authorization':'Bearer '+key})
    with urllib.request.urlopen(req,timeout=22) as answer:
        if answer.status!=200:
            sys.exit('No se verificó el modelo; .env intacto.')
except urllib.error.HTTPError as e:
    sys.exit('OpenAI rechazó el acceso al modelo (HTTP %d); .env intacto.'%e.code)
except (urllib.error.URLError,TimeoutError):
    sys.exit('No se pudo verificar acceso HTTPS a OpenAI; .env intacto.')
values={
 'OPENAI_API_KEY':key,
 'HOMMY_TEAM_AI_PROVIDER':'DIRECT_OPENAI',
 'HOMMY_TEAM_AI_ENABLED':'true',
 'HOMMY_TEAM_OPENAI_MODEL':'gpt-5.4-mini'
}
seen=set()
lines=[]
for raw in p.read_text(encoding='utf-8').splitlines():
    m=re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=',raw)
    name=m.group(1) if m else None
    if name in values:
        if name not in seen:
            lines.append(name+'='+values[name])
            seen.add(name)
    else:
        lines.append(raw)
for name,v in values.items():
    if name not in seen:
        lines.append(name+'='+v)
fd,tmp=tempfile.mkstemp(prefix='.env-direct-',dir='.')
try:
    with os.fdopen(fd,'w',encoding='utf-8') as o:
        o.write('\n'.join(lines)+'\n')
        o.flush()
        os.fchmod(o.fileno(),0o600)
        os.fsync(o.fileno())
    os.replace(tmp,p)
except BaseException:
    try: os.unlink(tmp)
    except FileNotFoundError: pass
    raise
print('Acceso al modelo comprobado; nueva configuración guardada de forma privada.')
PY

# Avoid stale interactive-shell variables overriding .env on docker compose.
unset HOMMY_TEAM_AI_ENABLED HOMMY_TEAM_AI_PROVIDER HOMMY_TEAM_OPENAI_MODEL OPENAI_API_KEY
restore() {
  echo "Falló la activación; restaurando la configuración previa." >&2
  cp -p "$BACKUP" .env
  chmod 600 .env
  docker compose up -d --no-deps --force-recreate bridge >/dev/null || true
  exit 1
}
docker compose config -q || restore
docker compose up -d --no-deps --force-recreate bridge || restore
docker exec -i homeeasy-whatsapp-bridge node - <<'NODE' || restore
const {createTeamAI}=require('/app/team-ai');
const e=process.env;
const ai=createTeamAI({
  enabled:e.HOMMY_TEAM_AI_ENABLED==='true',
  provider:e.HOMMY_TEAM_AI_PROVIDER,
  openaiApiKey:e.OPENAI_API_KEY,
  openaiModel:e.HOMMY_TEAM_OPENAI_MODEL,
  dataDir:e.DATA_DIR||'/app/data'
});
console.log(JSON.stringify({provider:ai.provider,available:ai.available}));
if(ai.provider!=='DIRECT_OPENAI'||!ai.available)process.exit(1);
NODE
echo "Direct OpenAI activo. WAHA y Pentagrama no fueron modificados."
echo "Prueba: docker exec homeeasy-whatsapp-bridge node /app/hommy-self-check.js"
echo "Respaldo: $BACKUP"
