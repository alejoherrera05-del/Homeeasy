#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${1:-api.homeeasy.com.co}"
INSTALL_DIR="/opt/homeeasy-whatsapp"
EXPECTED_IP="${2:-168.119.191.42}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador como root."
  exit 1
fi

if [[ ! -d "$INSTALL_DIR" || ! -f "$INSTALL_DIR/.env" ]]; then
  echo "No se encontró la instalación de HomeEasy WhatsApp en $INSTALL_DIR"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https dnsutils

RESOLVED_IP="$(dig +short A "$DOMAIN" | tail -n1 | tr -d '[:space:]')"
if [[ -z "$RESOLVED_IP" ]]; then
  echo "DNS todavía no resuelve $DOMAIN. Espera unos minutos y vuelve a ejecutar."
  exit 2
fi

if [[ "$RESOLVED_IP" != "$EXPECTED_IP" ]]; then
  echo "DNS de $DOMAIN apunta a $RESOLVED_IP, pero esperamos $EXPECTED_IP."
  echo "No se modifica HTTPS hasta que el DNS sea correcto."
  exit 3
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "Instalando Caddy..."
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    encode zstd gzip

    reverse_proxy 127.0.0.1:8080

    header {
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        X-Frame-Options "DENY"
        -Server
    }
}
EOF

caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

for i in $(seq 1 45); do
  if curl -fsS --connect-timeout 5 "https://${DOMAIN}/health" >/tmp/homeeasy-https-health.json 2>/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS --connect-timeout 5 "https://${DOMAIN}/health" >/tmp/homeeasy-https-health.json 2>/dev/null; then
  echo "Caddy está instalado, pero HTTPS todavía no respondió."
  echo "Revisa: journalctl -u caddy --no-pager -n 80"
  exit 4
fi

echo
echo "============================================================"
echo "HomeEasy WhatsApp HTTPS listo"
echo "============================================================"
echo "Dominio: https://${DOMAIN}"
echo "Health:  https://${DOMAIN}/health"
echo "WAHA sigue privado en 127.0.0.1:3000"
echo "Bridge sigue privado en 127.0.0.1:8080 y se publica solo vía Caddy."
echo
echo "Respuesta pública de salud:"
cat /tmp/homeeasy-https-health.json
echo
