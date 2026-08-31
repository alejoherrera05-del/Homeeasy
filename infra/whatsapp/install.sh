#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/alejoherrera05-del/Homeeasy.git"
INSTALL_DIR="/opt/homeeasy-whatsapp"
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador con sudo/root."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git openssl jq

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando Docker..."
  curl -fsSL https://get.docker.com -o "$TMP_DIR/get-docker.sh"
  sh "$TMP_DIR/get-docker.sh"
fi

systemctl enable --now docker

echo "Descargando infraestructura HomeEasy..."
git clone --depth 1 "$REPO_URL" "$TMP_DIR/repo" >/dev/null 2>&1
mkdir -p "$INSTALL_DIR"
cp -a "$TMP_DIR/repo/infra/whatsapp/." "$INSTALL_DIR/"
cd "$INSTALL_DIR"
mkdir -p data/sessions data/bridge backups

if [[ ! -f .env ]]; then
  WAHA_KEY="$(openssl rand -hex 32)"
  DASHBOARD_PASSWORD="$(openssl rand -hex 24)"
  BRIDGE_TOKEN="$(openssl rand -hex 32)"

  cat > .env <<EOF
WAHA_API_KEY=${WAHA_KEY}
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
WAHA_SESSION=homeeasy
BRIDGE_TOKEN=${BRIDGE_TOKEN}
BRIDGE_PORT=8080
MAX_BODY_MB=18
TZ=America/Bogota
EOF
  chmod 600 .env
else
  echo "Se conserva el .env existente."
fi

# shellcheck disable=SC1091
source .env

cat > ACCESS.txt <<EOF
HOMEEASY WHATSAPP - ACCESO LOCAL DEL VPS
=========================================

WAHA Dashboard (solo localhost): http://127.0.0.1:3000/dashboard
Usuario dashboard: ${WAHA_DASHBOARD_USERNAME}
Password dashboard: ${WAHA_DASHBOARD_PASSWORD}

Bridge local: http://127.0.0.1:${BRIDGE_PORT}
Bridge token: ${BRIDGE_TOKEN}

WAHA API key: ${WAHA_API_KEY}
Sesión: ${WAHA_SESSION}

IMPORTANTE: este archivo contiene secretos. No copiar a GitHub ni compartir públicamente.
EOF
chmod 600 ACCESS.txt

echo "Validando configuración Docker..."
docker compose config >/dev/null
echo "Descargando WAHA y construyendo Bridge..."
docker compose pull waha
docker compose build bridge

echo "Preparando almacenamiento persistente del Bridge..."
# El Bridge corre como usuario restringido 'node'. Ajustamos solo su volumen,
# nunca la carpeta de sesión de WAHA.
docker compose run --rm --no-deps --user root bridge sh -lc 'mkdir -p /app/data && chown -R node:node /app/data' >/dev/null

echo "Iniciando servicios..."
docker compose up -d

for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
  echo "El Bridge no respondió. Revisa: cd ${INSTALL_DIR} && docker compose logs"
  exit 1
fi

curl -fsS -X POST \
  -H "X-HomeEasy-Token: ${BRIDGE_TOKEN}" \
  "http://127.0.0.1:${BRIDGE_PORT}/api/whatsapp/bootstrap" \
  | jq . || true

echo
echo "============================================================"
echo "HomeEasy WhatsApp Fase 1 instalada."
echo "============================================================"
echo "Carpeta: ${INSTALL_DIR}"
echo "Credenciales: ${INSTALL_DIR}/ACCESS.txt"
echo
echo "Para ver el QR de vinculación en la consola ejecuta:"
echo "  cd ${INSTALL_DIR} && docker compose logs -f waha"
echo
echo "En WhatsApp Business: Dispositivos vinculados > Vincular dispositivo."
echo "Cuando veas WORKING, la sesión quedó conectada."
echo
echo "Comprobar estado:"
echo "  cd ${INSTALL_DIR} && source .env && curl -s -H \"X-HomeEasy-Token: \$BRIDGE_TOKEN\" http://127.0.0.1:${BRIDGE_PORT}/api/whatsapp/status | jq ."
echo
