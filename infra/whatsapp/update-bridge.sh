#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/alejoherrera05-del/Homeeasy.git"
INSTALL_DIR="/opt/homeeasy-whatsapp"
TMP_DIR="$(mktemp -d)"
HEALTH_FILE="/tmp/homeeasy-bridge-health.json"
EXPECTED_VERSION="0.6.1"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este actualizador como root."
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "No existe $INSTALL_DIR/.env. Ejecuta primero la instalación de Fase 1."
  exit 1
fi

echo "Descargando Bridge actualizado..."
git clone --depth 1 "$REPO_URL" "$TMP_DIR/repo" >/dev/null 2>&1

cp "$TMP_DIR/repo/infra/whatsapp/bridge/server.js" "$INSTALL_DIR/bridge/server.js"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/auth.js" "$INSTALL_DIR/bridge/auth.js"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/operations.js" "$INSTALL_DIR/bridge/operations.js"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/conversation.js" "$INSTALL_DIR/bridge/conversation.js"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/Dockerfile" "$INSTALL_DIR/bridge/Dockerfile"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/package.json" "$INSTALL_DIR/bridge/package.json"

cd "$INSTALL_DIR"
echo "Reconstruyendo solo el Bridge (WAHA y su sesión no se tocan)..."
docker compose build bridge

echo "Preparando almacenamiento persistente del Bridge..."
mkdir -p "$INSTALL_DIR/data/bridge"
# node:20-alpine usa UID/GID 1000 para el usuario restringido 'node'.
# Ajustamos SOLO el volumen del Bridge. data/sessions de WAHA no se toca.
chown -R 1000:1000 "$INSTALL_DIR/data/bridge"
chmod 750 "$INSTALL_DIR/data/bridge"

echo "Iniciando solo el Bridge..."
docker compose up -d --no-deps bridge

rm -f "$HEALTH_FILE"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health >"$HEALTH_FILE" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ ! -s "$HEALTH_FILE" ]]; then
  echo "El Bridge no respondió al health check."
  echo "Revisa: cd $INSTALL_DIR && docker compose logs bridge"
  exit 1
fi

cat "$HEALTH_FILE" | jq .
VERSION="$(jq -r '.version // empty' "$HEALTH_FILE")"
STORAGE="$(jq -r '.storage // empty' "$HEALTH_FILE")"
if [[ "$VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "El Bridge no quedó en v$EXPECTED_VERSION. Revisa: cd $INSTALL_DIR && docker compose logs bridge"
  exit 1
fi
if [[ "$STORAGE" != "OK" ]]; then
  echo "El Bridge arrancó, pero su almacenamiento persistente no quedó escribible."
  echo "Revisa: cd $INSTALL_DIR && docker compose logs bridge"
  exit 1
fi

echo
echo "Bridge actualizado correctamente a v$EXPECTED_VERSION. Almacenamiento OK. La sesión de WhatsApp permanece intacta."
