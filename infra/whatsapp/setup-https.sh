#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="/opt/homeeasy-whatsapp"
PUBLIC_IP="${1:-}"
WEBROOT="/var/www/letsencrypt"
NGINX_SITE="/etc/nginx/sites-available/homeeasy-whatsapp"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador como root."
  exit 1
fi

if [[ -z "$PUBLIC_IP" || ! "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Uso: bash setup-https.sh IP_PUBLICA"
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "No existe $INSTALL_DIR/.env. Completa primero la Fase 1."
  exit 1
fi

# shellcheck disable=SC1091
source "$INSTALL_DIR/.env"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx snapd ca-certificates curl jq
systemctl enable --now nginx
systemctl enable --now snapd.socket >/dev/null 2>&1 || true

mkdir -p "$WEBROOT/.well-known/acme-challenge"
rm -f /etc/nginx/sites-enabled/default

# Configuración temporal para que Let's Encrypt pueda validar la IP por HTTP-01.
cat > "$NGINX_SITE" <<EOF
server {
    listen 80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 404;
    }
}
EOF
ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/homeeasy-whatsapp
nginx -t
systemctl reload nginx

if ! command -v certbot >/dev/null 2>&1 || ! certbot --help all 2>/dev/null | grep -q -- '--ip-address'; then
  echo "Instalando Certbot actual con soporte para certificados de IP..."
  snap install core >/dev/null 2>&1 || true
  snap refresh core >/dev/null 2>&1 || true
  snap install --classic certbot
  ln -sfn /snap/bin/certbot /usr/local/bin/certbot
fi

if ! certbot --help all 2>/dev/null | grep -q -- '--ip-address'; then
  echo "Esta versión de Certbot todavía no expone --ip-address. Versión actual:"
  certbot --version || true
  exit 1
fi

echo "Solicitando certificado público HTTPS para $PUBLIC_IP..."
certbot certonly \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path "$WEBROOT" \
  --ip-address "$PUBLIC_IP"

CERT_DIR="/etc/letsencrypt/live/$PUBLIC_IP"
if [[ ! -s "$CERT_DIR/fullchain.pem" || ! -s "$CERT_DIR/privkey.pem" ]]; then
  echo "No se encontraron los certificados esperados en $CERT_DIR"
  exit 1
fi

cat > "$NGINX_SITE" <<EOF
server {
    listen 80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 301 https://$PUBLIC_IP\$request_uri;
    }
}

server {
    listen 443 ssl default_server;
    server_name _;
    server_tokens off;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:HE_TLS:10m;
    ssl_session_timeout 10m;

    client_max_body_size 20m;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Cache-Control "no-store" always;

    location = /health {
        proxy_pass http://127.0.0.1:8080/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_connect_timeout 10s;
        proxy_read_timeout 20s;
    }

    location ^~ /api/whatsapp/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 10s;
        proxy_send_timeout 100s;
        proxy_read_timeout 100s;
    }

    location / {
        return 404;
    }
}
EOF

cat > /etc/letsencrypt/renewal-hooks/deploy/reload-homeeasy-nginx.sh <<'EOF'
#!/usr/bin/env bash
set -e
nginx -t >/dev/null
systemctl reload nginx
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-homeeasy-nginx.sh

nginx -t
systemctl reload nginx
systemctl enable --now snap.certbot.renew.timer >/dev/null 2>&1 || true

sleep 2

echo "Comprobando HTTPS..."
curl -fsS "https://$PUBLIC_IP/health" | jq .

UNAUTH_CODE="$(curl -sS -o /tmp/homeeasy-https-unauth.json -w '%{http_code}' "https://$PUBLIC_IP/api/whatsapp/status")"
if [[ "$UNAUTH_CODE" != "401" ]]; then
  echo "La protección externa no respondió 401 sin token (respondió $UNAUTH_CODE)."
  cat /tmp/homeeasy-https-unauth.json || true
  exit 1
fi

curl -fsS \
  -H "X-HomeEasy-Token: $BRIDGE_TOKEN" \
  "https://$PUBLIC_IP/api/whatsapp/status" | jq .

echo
echo "============================================================"
echo "HTTPS de HomeEasy WhatsApp listo"
echo "============================================================"
echo "URL pública del Bridge: https://$PUBLIC_IP"
echo "WAHA sigue privado en 127.0.0.1:3000"
echo "Bridge interno sigue privado en 127.0.0.1:8080"
echo "Certificado: Let's Encrypt short-lived IP certificate"
echo "Renovación: automática mediante Certbot"
echo
