#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/alejoherrera05-del/Homeeasy.git"
INSTALL_DIR="/opt/homeeasy-whatsapp"
TMP_DIR="$(mktemp -d)"

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
cp "$TMP_DIR/repo/infra/whatsapp/bridge/Dockerfile" "$INSTALL_DIR/bridge/Dockerfile"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/package.json" "$INSTALL_DIR/bridge/package.json"

cd "$INSTALL_DIR"
echo "Reconstruyendo solo el Bridge (WAHA y su sesión no se tocan)..."
docker compose build bridge
docker compose up -d --no-deps bridge

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health >/tmp/homeeasy-bridge-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

cat /tmp/homeeasy-bridge-health.json | jq .
VERSION="$(jq -r '.version // empty' /tmp/homeeasy-bridge-health.json)"
if [[ "$VERSION" != "0.4.0" ]]; then
  echo "El Bridge no quedó en v0.4.0. Revisa: cd $INSTALL_DIR && docker compose logs bridge"
  exit 1
fi

echo
echo "Bridge actualizado correctamente a v0.4.0. La sesión de WhatsApp permanece intacta."
