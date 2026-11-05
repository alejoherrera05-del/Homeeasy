#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/alejoherrera05-del/Homeeasy.git"
SOURCE_REF="${HOMEEASY_SOURCE_REF:-main}"
INSTALL_DIR="${HOMEEASY_INSTALL_DIR:-/opt/homeeasy-whatsapp}"
TMP_DIR="$(mktemp -d)"
HEALTH_FILE="$(mktemp)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$INSTALL_DIR/backups/bridge-$RELEASE_ID"
ROLLBACK_IMAGE="homeeasy-whatsapp-bridge:rollback-$RELEASE_ID"
EXPECTED_VERSION=""
ROLLBACK_READY=false
BRIDGE_LOCAL_PORT=""

BRIDGE_FILES=(
  server.js
  auth.js
  operations.js
  conversation.js
  inbox.js
  intelligence.js
  maintenance.js
  Dockerfile
  package.json
)

cleanup() {
  rm -rf -- "$TMP_DIR"
  rm -f -- "$HEALTH_FILE"
}

restore_files() {
  local file
  for file in "${BRIDGE_FILES[@]}"; do
    if [[ -f "$BACKUP_DIR/bridge/$file" ]]; then
      cp -a -- "$BACKUP_DIR/bridge/$file" "$INSTALL_DIR/bridge/$file"
    else
      rm -f -- "$INSTALL_DIR/bridge/$file"
    fi
  done
}

rollback() {
  trap - ERR
  set +e
  echo "Restaurando Bridge anterior desde $BACKUP_DIR..." >&2
  restore_files
  docker image tag "$ROLLBACK_IMAGE" homeeasy-whatsapp-bridge:local
  cd "$INSTALL_DIR"
  docker compose up -d --no-deps --force-recreate bridge
  set -e
}

on_error() {
  local line="$1"
  echo "Falló la actualización del Bridge en la línea $line." >&2
  if [[ "$ROLLBACK_READY" == "true" ]]; then
    rollback
    echo "Rollback automático ejecutado. Revisa: docker compose logs --tail=100 bridge" >&2
  fi
  exit 1
}

trap cleanup EXIT
trap 'on_error $LINENO' ERR

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este actualizador como root."
  exit 1
fi

for command in git docker curl jq openssl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Falta el comando requerido: $command"
    exit 1
  fi
done

if [[ ! -f "$INSTALL_DIR/.env" || ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  echo "No existe una instalación completa en $INSTALL_DIR."
  exit 1
fi

if [[ ! -d "$INSTALL_DIR/bridge" || ! -d "$INSTALL_DIR/data/bridge" ]]; then
  echo "Faltan el Bridge o su volumen persistente en $INSTALL_DIR."
  exit 1
fi

cd "$INSTALL_DIR"
# shellcheck disable=SC1091
source .env

SESSION_NAME="${WAHA_SESSION:-homeeasy}"
BRIDGE_LOCAL_PORT="${BRIDGE_PORT:-8080}"
if [[ ! "$SESSION_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "WAHA_SESSION contiene caracteres no permitidos."
  exit 1
fi
if [[ -z "${WAHA_API_KEY:-}" || -z "${BRIDGE_TOKEN:-}" ]]; then
  echo "WAHA_API_KEY o BRIDGE_TOKEN no están configurados en .env."
  exit 1
fi
if [[ "${HOMMY_INTELLIGENCE_ENABLED:-false}" == "true" ]]; then
  echo "HOMMY_INTELLIGENCE_ENABLED ya está activo. El despliegue inicial exige false o variable ausente."
  exit 1
fi

echo "Preflight de producción (sin cambios)..."
docker compose config >/dev/null
docker compose ps
echo "WAHA en ejecución: $(docker inspect homeeasy-waha --format '{{.Config.Image}}')"
echo "Bridge actual: $(docker inspect homeeasy-whatsapp-bridge --format '{{.Config.Image}}')"
df -h "$INSTALL_DIR"

AVAILABLE_KB="$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print $4}')"
if [[ ! "$AVAILABLE_KB" =~ ^[0-9]+$ ]] || (( AVAILABLE_KB < 1048576 )); then
  echo "Se requiere al menos 1 GiB libre para construir y conservar la imagen de rollback."
  exit 1
fi

WAHA_STATE="$(curl -fsS \
  -H "X-Api-Key: $WAHA_API_KEY" \
  "http://127.0.0.1:3000/api/sessions/$SESSION_NAME")"
echo "$WAHA_STATE" | jq '{name, status, engine: (.engine.engine // .engine)}'
if [[ "$(echo "$WAHA_STATE" | jq -r '.status // empty')" != "WORKING" ]]; then
  echo "La sesión WAHA no está WORKING. No se modifica el Bridge."
  exit 1
fi

echo "Descargando Bridge desde $SOURCE_REF..."
git clone --depth 1 --branch "$SOURCE_REF" "$REPO_URL" "$TMP_DIR/repo" >/dev/null 2>&1
SOURCE_COMMIT="$(git -C "$TMP_DIR/repo" rev-parse HEAD)"
SOURCE_BRIDGE="$TMP_DIR/repo/infra/whatsapp/bridge"

for file in "${BRIDGE_FILES[@]}"; do
  if [[ ! -f "$SOURCE_BRIDGE/$file" ]]; then
    echo "El release no contiene infra/whatsapp/bridge/$file."
    exit 1
  fi
done

EXPECTED_VERSION="$(sed -n "s/^const BRIDGE_VERSION = '\([^']*\)';/\1/p" "$SOURCE_BRIDGE/server.js" | head -n 1)"
if [[ -z "$EXPECTED_VERSION" ]]; then
  echo "No se pudo determinar BRIDGE_VERSION desde $SOURCE_REF."
  exit 1
fi

echo "Preparando respaldo recuperable en $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR/bridge"
chmod 700 "$BACKUP_DIR"
cp -a -- "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
cp -a -- "$INSTALL_DIR/docker-compose.yml" "$BACKUP_DIR/docker-compose.yml"
if [[ -f "$INSTALL_DIR/docker-compose.override.yml" ]]; then
  cp -a -- "$INSTALL_DIR/docker-compose.override.yml" "$BACKUP_DIR/docker-compose.override.yml"
fi
for file in "${BRIDGE_FILES[@]}"; do
  if [[ -f "$INSTALL_DIR/bridge/$file" ]]; then
    cp -a -- "$INSTALL_DIR/bridge/$file" "$BACKUP_DIR/bridge/$file"
  fi
done
if [[ -d "$INSTALL_DIR/data/bridge/hommy-inbox" ]]; then
  tar -czf "$BACKUP_DIR/hommy-inbox.tar.gz" -C "$INSTALL_DIR/data/bridge" hommy-inbox
fi
if [[ -d "$INSTALL_DIR/data/bridge/hommy-intelligence" ]]; then
  tar -czf "$BACKUP_DIR/hommy-intelligence.tar.gz" -C "$INSTALL_DIR/data/bridge" hommy-intelligence
fi
find "$INSTALL_DIR/data/bridge" -maxdepth 2 -type f -printf '%P\t%s bytes\n' \
  >"$BACKUP_DIR/data-bridge-manifest.txt"
printf '%s\n' "$SOURCE_REF" >"$BACKUP_DIR/source-ref.txt"
printf '%s\n' "$SOURCE_COMMIT" >"$BACKUP_DIR/source-commit.txt"

CURRENT_IMAGE_ID="$(docker inspect homeeasy-whatsapp-bridge --format '{{.Image}}')"
docker image tag "$CURRENT_IMAGE_ID" "$ROLLBACK_IMAGE"
printf '%s\n' "$CURRENT_IMAGE_ID" >"$BACKUP_DIR/previous-image-id.txt"
printf '%s\n' "$ROLLBACK_IMAGE" >"$BACKUP_DIR/rollback-image.txt"

cat >"$BACKUP_DIR/rollback.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_DIR="$INSTALL_DIR"
BACKUP_DIR="$BACKUP_DIR"
ROLLBACK_IMAGE="$ROLLBACK_IMAGE"
BRIDGE_LOCAL_PORT="$BRIDGE_LOCAL_PORT"
BRIDGE_FILES=(server.js auth.js operations.js conversation.js inbox.js maintenance.js Dockerfile package.json)
for file in "\${BRIDGE_FILES[@]}"; do
  if [[ -f "\$BACKUP_DIR/bridge/\$file" ]]; then
    cp -a -- "\$BACKUP_DIR/bridge/\$file" "\$INSTALL_DIR/bridge/\$file"
  else
    rm -f -- "\$INSTALL_DIR/bridge/\$file"
  fi
done
docker image tag "\$ROLLBACK_IMAGE" homeeasy-whatsapp-bridge:local
cd "\$INSTALL_DIR"
docker compose up -d --no-deps --force-recreate bridge
curl -fsS "http://127.0.0.1:\$BRIDGE_LOCAL_PORT/health" | jq .
EOF
chmod 700 "$BACKUP_DIR/rollback.sh"
ROLLBACK_READY=true

echo "Copiando exclusivamente archivos raíz del Bridge..."
for file in "${BRIDGE_FILES[@]}"; do
  cp -a -- "$SOURCE_BRIDGE/$file" "$INSTALL_DIR/bridge/$file"
done

echo "Preparando almacenamiento privado del inbox..."
mkdir -p "$INSTALL_DIR/data/bridge/hommy-inbox"
chown 1000:1000 "$INSTALL_DIR/data/bridge" "$INSTALL_DIR/data/bridge/hommy-inbox"
chmod 750 "$INSTALL_DIR/data/bridge"
chmod 700 "$INSTALL_DIR/data/bridge/hommy-inbox"

echo "Construyendo únicamente homeeasy-whatsapp-bridge:local..."
docker compose build bridge

echo "Reemplazando únicamente el contenedor Bridge; WAHA no se recrea ni reinicia..."
docker compose up -d --no-deps --force-recreate bridge

rm -f -- "$HEALTH_FILE"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$BRIDGE_LOCAL_PORT/health" >"$HEALTH_FILE" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ ! -s "$HEALTH_FILE" ]]; then
  echo "El Bridge nuevo no respondió al health check." >&2
  false
fi

VERSION="$(jq -r '.version // empty' "$HEALTH_FILE")"
STORAGE="$(jq -r '.storage // empty' "$HEALTH_FILE")"
if [[ "$VERSION" != "$EXPECTED_VERSION" || "$STORAGE" != "OK" ]]; then
  echo "Health check inválido: versión=$VERSION almacenamiento=$STORAGE" >&2
  false
fi

STATUS="$(curl -fsS \
  -H "X-HomeEasy-Token: $BRIDGE_TOKEN" \
  "http://127.0.0.1:$BRIDGE_LOCAL_PORT/api/whatsapp/status")"
echo "$STATUS" | jq '{ok, whatsapp: {status: .whatsapp.status, ready: .whatsapp.ready, engine: .whatsapp.engine}, bridge: .bridge, inbox: .inbox}'

if [[ "$(echo "$STATUS" | jq -r '.whatsapp.status // empty')" != "WORKING" ]]; then
  echo "WhatsApp dejó de estar WORKING después del reemplazo del Bridge." >&2
  false
fi
if [[ "$(echo "$STATUS" | jq -r '.inbox.enabled // false')" != "false" ]]; then
  echo "El inbox debe quedar desactivado en el primer despliegue." >&2
  false
fi
if ! echo "$STATUS" | jq -e '.inbox | type == "object"' >/dev/null; then
  echo "El Bridge no expuso el estado del inbox esperado." >&2
  false
fi

trap - ERR
ROLLBACK_READY=false

echo
echo "Bridge actualizado correctamente desde $SOURCE_REF ($SOURCE_COMMIT)."
echo "WAHA y Pentagrama no fueron modificados. Inbox SHADOW permanece desactivado."
echo "Respaldo: $BACKUP_DIR"
echo "Rollback: $BACKUP_DIR/rollback.sh"
echo
echo "La activación del webhook requiere una operación separada y autorizada sobre WAHA."
