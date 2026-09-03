from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from .periods import HOME_EASY_TIMEZONE

DEFAULT_WHATSAPP_BRIDGE = "https://api.homeeasy.com.co"
MAX_WHATSAPP_MESSAGES = 36
MAX_WHATSAPP_ACTIVITY = 30

_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_CO_PHONE_RE = re.compile(r"(?<!\d)(?:\+?57[\s.-]?)?3\d{2}(?:[\s.-]?\d){7}(?!\d)")
_ID_RE = re.compile(r"\b(?:c[eé]dula|cc|nit)\s*[:#-]?\s*[0-9.\-]{6,20}\b", re.IGNORECASE)


def _clean(value: Any, limit: int = 1200) -> str:
    return str(value if value is not None else "").replace("\x00", "").strip()[:limit]


def _phone_digits(value: Any) -> str:
    digits = re.sub(r"\D", "", _clean(value, 80))
    if digits.startswith("00"):
        digits = digits[2:]
    if re.fullmatch(r"3\d{9}", digits):
        digits = "57" + digits
    return digits if re.fullmatch(r"\d{8,15}", digits) else ""


def _redact_text(value: Any) -> str:
    text = _clean(value, 1400)
    if not text:
        return ""
    text = _EMAIL_RE.sub("[correo omitido]", text)
    text = _CO_PHONE_RE.sub("[teléfono omitido]", text)
    text = _ID_RE.sub("[identificación omitida]", text)
    return text


def _parse_datetime(value: Any) -> datetime | None:
    raw = _clean(value, 100)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=HOME_EASY_TIMEZONE)
    return parsed.astimezone(HOME_EASY_TIMEZONE)


def _quote_number(value: Any) -> str:
    raw = _clean(value, 80)
    raw = re.sub(r"^COT\s*[-:#]?\s*", "", raw, flags=re.IGNORECASE)
    return raw.strip()


def _source_phone(detail: dict[str, Any]) -> str:
    client = detail.get("cliente") if isinstance(detail.get("cliente"), dict) else {}
    state = detail.get("seguimiento") if isinstance(detail.get("seguimiento"), dict) else {}
    return _phone_digits(client.get("telefono") or state.get("telefono"))


def _quote_date(detail: dict[str, Any]) -> datetime | None:
    quote_data = detail.get("cotizacion") if isinstance(detail.get("cotizacion"), dict) else {}
    return _parse_datetime(quote_data.get("fecha"))


def _device_headers(session_token: str, client_meta: dict[str, Any] | None) -> dict[str, str]:
    meta = client_meta if isinstance(client_meta, dict) else {}
    device_id = _clean(meta.get("dispositivoId"), 180)
    if not device_id:
        return {}

    def encoded(name: str, limit: int) -> str:
        return quote(_clean(meta.get(name), limit), safe="")

    headers = {
        "Accept": "application/json",
        "X-HomeEasy-Session": _clean(session_token, 4096),
        "X-HomeEasy-Device-Id": quote(device_id, safe=""),
    }
    optional = {
        "X-HomeEasy-Device-Name": encoded("dispositivoNombre", 120),
        "X-HomeEasy-Platform": encoded("plataforma", 80),
        "X-HomeEasy-Browser": encoded("navegador", 80),
    }
    headers.update({key: value for key, value in optional.items() if value})
    return headers


def _minimize_bridge_payload(payload: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    raw_messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    raw_activity = payload.get("activity") if isinstance(payload.get("activity"), list) else []
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), dict) else {}

    messages: list[dict[str, Any]] = []
    for item in raw_messages[-MAX_WHATSAPP_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        direction = _clean(item.get("direction"), 20).upper()
        if direction not in {"OUTGOING", "INCOMING"}:
            continue
        text = _redact_text(item.get("text"))
        media = _clean(item.get("media"), 220)
        if not text and not media:
            continue
        messages.append(
            {
                "at": _clean(item.get("at"), 100),
                "direction": direction,
                "text": text or media,
                "hasMedia": bool(item.get("hasMedia")),
                "media": media,
                "ack": _clean(item.get("ack"), 40).upper(),
            }
        )

    activity: list[dict[str, Any]] = []
    for item in raw_activity[-MAX_WHATSAPP_ACTIVITY:]:
        if not isinstance(item, dict):
            continue
        activity.append(
            {
                "at": _clean(item.get("at"), 100),
                "state": _clean(item.get("state"), 40).upper(),
                "documentType": _clean(item.get("documentType"), 40).lower(),
                "reference": _clean(item.get("reference"), 120),
                "referenceMatch": bool(item.get("referenceMatch")),
                "filename": _clean(item.get("filename"), 220),
                "source": _clean(item.get("source"), 60),
            }
        )

    last_outgoing = _parse_datetime(evidence.get("lastOutgoingAt"))
    last_incoming = _parse_datetime(evidence.get("lastIncomingAt"))
    quote_delivery_raw = evidence.get("quoteDelivery") if isinstance(evidence.get("quoteDelivery"), dict) else None
    quote_delivery = None
    if quote_delivery_raw:
        quote_delivery = {
            "at": _clean(quote_delivery_raw.get("at"), 100),
            "state": _clean(quote_delivery_raw.get("state"), 40).upper(),
            "reference": _clean(quote_delivery_raw.get("reference"), 120),
            "filename": _clean(quote_delivery_raw.get("filename"), 220),
        }

    hours_since_outgoing = None
    if last_outgoing:
        delta = now - last_outgoing
        hours_since_outgoing = max(0, round(delta.total_seconds() / 3600, 1))

    return {
        "available": True,
        "source": "WAHA_WEBJS",
        "messages": messages,
        "activity": activity,
        "evidence": {
            "messageCount": int(evidence.get("messageCount") or len(messages)),
            "incomingCount": int(evidence.get("incomingCount") or 0),
            "outgoingCount": int(evidence.get("outgoingCount") or 0),
            "lastIncomingAt": last_incoming.isoformat(timespec="seconds") if last_incoming else None,
            "lastOutgoingAt": last_outgoing.isoformat(timespec="seconds") if last_outgoing else None,
            "hoursSinceLastOutgoing": hours_since_outgoing,
            "customerRepliedAfterLastOutgoing": bool(evidence.get("customerRepliedAfterLastOutgoing")),
            "quoteDelivery": quote_delivery,
            "customerRepliedAfterQuote": bool(evidence.get("customerRepliedAfterQuote")),
        },
    }


class WhatsAppConversationClient:
    def __init__(self, bridge_url: str | None = None, timeout: int | None = None) -> None:
        self.bridge_url = (bridge_url or os.getenv("HOMMY_WHATSAPP_BRIDGE_URL", DEFAULT_WHATSAPP_BRIDGE)).strip().rstrip("/")
        raw_timeout = timeout if timeout is not None else int(os.getenv("HOMMY_WHATSAPP_CONTEXT_TIMEOUT_SECONDS", "18"))
        self.timeout = max(5, min(int(raw_timeout), 40))
        self.http = httpx.Client(timeout=self.timeout, follow_redirects=True)

    def context(
        self,
        quote_number: str,
        detail: dict[str, Any],
        *,
        session_token: str,
        client_meta: dict[str, Any] | None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        local_now = (now or datetime.now(HOME_EASY_TIMEZONE)).astimezone(HOME_EASY_TIMEZONE)
        phone = _source_phone(detail)
        if not phone:
            return {"available": False, "reason": "MISSING_OR_INVALID_PHONE", "messages": [], "activity": [], "evidence": {}}

        headers = _device_headers(session_token, client_meta)
        if not headers or not headers.get("X-HomeEasy-Session"):
            return {"available": False, "reason": "DEVICE_CONTEXT_UNAVAILABLE", "messages": [], "activity": [], "evidence": {}}

        quote_date = _quote_date(detail)
        since = (quote_date - timedelta(days=7)) if quote_date else (local_now - timedelta(days=30))
        params = {
            "phone": phone,
            "reference": f"COT-{_quote_number(quote_number)}",
            "since": since.isoformat(timespec="seconds"),
            "limit": "60",
        }
        try:
            response = self.http.get(
                f"{self.bridge_url}/api/whatsapp/conversation",
                params=params,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException:
            return {"available": False, "reason": "WHATSAPP_CONTEXT_TIMEOUT", "messages": [], "activity": [], "evidence": {}}
        except (httpx.HTTPError, ValueError):
            return {"available": False, "reason": "WHATSAPP_CONTEXT_UNAVAILABLE", "messages": [], "activity": [], "evidence": {}}

        if not isinstance(payload, dict) or payload.get("ok") is not True:
            return {"available": False, "reason": "WHATSAPP_CONTEXT_INVALID", "messages": [], "activity": [], "evidence": {}}
        return _minimize_bridge_payload(payload, now=local_now)


__all__ = ["WhatsAppConversationClient", "DEFAULT_WHATSAPP_BRIDGE"]
