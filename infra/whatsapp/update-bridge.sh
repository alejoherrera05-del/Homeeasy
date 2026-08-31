#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/alejoherrera05-del/Homeeasy.git"
INSTALL_DIR="/opt/homeeasy-whatsapp"
TMP_DIR="$(mktemp -d)"
HEALTH_FILE="/tmp/homeeasy-bridge-health.json"

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
cp "$TMP_DIR/repo/infra/whatsapp/bridge/Dockerfile" "$INSTALL_DIR/bridge/Dockerfile"
cp "$TMP_DIR/repo/infra/whatsapp/bridge/package.json" "$INSTALL_DIR/bridge/package.json"

cd "$INSTALL_DIR"
echo "Reconstruyendo solo el Bridge (WAHA y su sesión no se tocan)..."
docker compose build bridge

echo "Preparando almacenamiento persistente del Bridge..."
mkdir -p "$INSTALL_DIR/data/bridge"
# La imagen corre como el usuario restringido 'node'. Ajustamos SOLO el volumen
# del Bridge; data/sessions de WAHA no se modifica.
docker compose run --rm --no-deps --user root bridge sh -lc 'mkdir -p /app/data && chown -R node:node /app/data' >/dev/null

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
if [[ "$VERSION" != "0.5.0" ]]; then
  echo "El Bridge no quedó en v0.5.0. Revisa: cd $INSTALL_DIR && docker compose logs bridge"
  exit 1
fi
if [[ "$STORAGE" != "OK" ]]; then
  echo "El Bridge arrancó, pero su almacenamiento persistente no quedó escribible."
  echo "Revisa: cd $INSTALL_DIR && docker compose logs bridge"
  exit 1
fi

echo
echo "Bridge actualizado correctamente a v0.5.0. Almacenamiento OK. La sesión de WhatsApp permanece intacta."
