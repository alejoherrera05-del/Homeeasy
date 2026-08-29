#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="/opt/homeeasy-whatsapp"
TEST_PDF="/tmp/homeeasy-whatsapp-test.pdf"

cd "$INSTALL_DIR"
# shellcheck disable=SC1091
source .env

STATUS_JSON="$(curl -fsS -H "X-HomeEasy-Token: $BRIDGE_TOKEN" http://127.0.0.1:8080/api/whatsapp/status)"
READY="$(printf '%s' "$STATUS_JSON" | jq -r '.whatsapp.ready // false')"
PHONE="$(printf '%s' "$STATUS_JSON" | jq -r '.whatsapp.me.id // empty' | sed 's/@c.us$//')"

if [[ "$READY" != "true" || -z "$PHONE" ]]; then
  echo "WhatsApp no está listo. Estado actual:"
  printf '%s\n' "$STATUS_JSON" | jq .
  exit 1
fi

python3 - "$TEST_PDF" <<'PY'
from pathlib import Path
import sys

out = Path(sys.argv[1])
content = "BT /F1 19 Tf 72 720 Td (HomeEasy WhatsApp PDF test OK) Tj ET"
objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    f"<< /Length {len(content.encode('ascii'))} >>\nstream\n{content}\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]

pdf = bytearray(b"%PDF-1.4\n")
offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{i} 0 obj\n{obj}\nendobj\n".encode("ascii"))

xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects)+1}\n".encode("ascii"))
pdf.extend(b"0000000000 65535 f \n")
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
pdf.extend(
    f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
)
out.write_bytes(pdf)
PY

PDF64="$(base64 -w0 "$TEST_PDF")"
PAYLOAD="$(jq -nc \
  --arg phone "$PHONE" \
  --arg pdfBase64 "$PDF64" \
  --arg filename "HomeEasy-Prueba-WhatsApp.pdf" \
  --arg caption "Prueba PDF HomeEasy ✅ Documento enviado por el Bridge." \
  --arg idempotencyKey "smoke-pdf-$(date +%s)" \
  '{phone:$phone,pdfBase64:$pdfBase64,filename:$filename,caption:$caption,idempotencyKey:$idempotencyKey}')"

curl -fsS -X POST \
  -H "X-HomeEasy-Token: $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8080/api/whatsapp/send-document \
  -d "$PAYLOAD" | jq .

echo
echo "PDF de prueba enviado a $PHONE"
