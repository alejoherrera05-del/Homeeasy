#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${1:-api.homeeasy.com.co}"
EXPECTED_IP="${2:-168.119.191.42}"
INSTALL_DIR="/opt/homeeasy-whatsapp"
REPO_URL="https://github.com/alejoherrera05-del/Homeeasy.git"
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador como root."
  exit 1
fi

if [[ ! -d "$INSTALL_DIR" || ! -f "$INSTALL_DIR/.env" ]]; then
  echo "No se encontró HomeEasy WhatsApp en $INSTALL_DIR"
  exit 1
fi

echo "1/5 · Descargando la versión validada de HomeEasy WhatsApp..."
git clone --depth 1 "$REPO_URL" "$TMP_DIR/repo" >/dev/null 2>&1

echo "2/5 · Actualizando únicamente el Bridge (se conservan sesión y secretos)..."
cp "$TMP_DIR/repo/infra/whatsapp/bridge/server.js" "$INSTALL_DIR/bridge/server.js"
cp "$TMP_DIR/repo/infra/whatsapp/install-https-domain.sh" "$INSTALL_DIR/install-https-domain.sh"
chmod +x "$INSTALL_DIR/install-https-domain.sh"

cd "$INSTALL_DIR"
docker compose build bridge
docker compose up -d bridge

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health >/tmp/homeeasy-bridge-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -fsS http://127.0.0.1:8080/health >/tmp/homeeasy-bridge-health.json 2>/dev/null; then
  echo "El Bridge actualizado no respondió. No se configura HTTPS."
  docker compose logs --tail=80 bridge
  exit 2
fi

echo "3/5 · Confirmando que WhatsApp sigue conectado..."
# shellcheck disable=SC1091
source .env
STATUS="$(curl -fsS -H "X-HomeEasy-Token: $BRIDGE_TOKEN" http://127.0.0.1:8080/api/whatsapp/status)"
printf '%s\n' "$STATUS" | jq .
READY="$(printf '%s' "$STATUS" | jq -r '.whatsapp.ready // false')"
if [[ "$READY" != "true" ]]; then
  echo "WhatsApp no está WORKING. Se detiene antes de exponer HTTPS."
  exit 3
fi

echo "4/5 · Configurando HTTPS para $DOMAIN..."
"$INSTALL_DIR/install-https-domain.sh" "$DOMAIN" "$EXPECTED_IP"

echo "5/5 · Comprobando seguridad pública..."
PUBLIC_HEALTH="$(curl -fsS --connect-timeout 8 "https://${DOMAIN}/health")"
printf '%s\n' "$PUBLIC_HEALTH" | jq .
UNAUTH_CODE="$(curl -sS -o /tmp/homeeasy-unauth.json -w '%{http_code}' --connect-timeout 8 "https://${DOMAIN}/api/whatsapp/status")"
if [[ "$UNAUTH_CODE" != "401" ]]; then
  echo "La comprobación de autenticación pública devolvió HTTP $UNAUTH_CODE en vez de 401."
  exit 4
fi

echo
echo "============================================================"
echo "FASE 2 BASE LISTA"
echo "============================================================"
echo "Bridge: actualizado"
echo "WhatsApp: WORKING"
echo "HTTPS: https://${DOMAIN}"
echo "Endpoint sin token: protegido (401)"
echo "WAHA: privado en 127.0.0.1:3000"
echo "Bridge directo: privado en 127.0.0.1:8080"
echo
