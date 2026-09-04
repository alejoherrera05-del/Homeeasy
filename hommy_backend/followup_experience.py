from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from .periods import HOME_EASY_TIMEZONE

_HONORIFICS = ("doña", "don", "señora", "señor", "sra.", "sr.")
_PAYMENT_COMPLETION_RE = re.compile(
    r"\b(?:ya\s+)?(?:(?:me|nos|te|le|les)\s+)?(?:pagaron|consignaron|depositaron)\b|"
    r"\b(?:ya\s+)?(?:recib[ií]|recibimos|recibiste|recibieron)\s+(?:el\s+)?pago\b",
    re.IGNORECASE,
)


def _clean(value: Any, limit: int = 1200) -> str:
    return str(value if value is not None else "").replace("\x00", "").strip()[:limit]


def _parse_date(value: Any) -> datetime | None:
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


def _outgoing_texts(whatsapp: dict[str, Any]) -> list[str]:
    rows = whatsapp.get("messages") if isinstance(whatsapp.get("messages"), list) else []
    return [
        _clean(item.get("text"), 1200)
        for item in rows
        if isinstance(item, dict)
        and _clean(item.get("direction"), 20).upper() == "OUTGOING"
        and _clean(item.get("text"), 1200)
    ][-18:]


def infer_conversation_style(quote: dict[str, Any], whatsapp: dict[str, Any]) -> dict[str, Any]:
    """Infer only observable address/register conventions from recent outgoing WhatsApp copy.

    This is deliberately conservative: honorifics are never invented. The result is advisory
    evidence for the model and deterministic first-follow-up copy.
    """
    first_name = _clean(quote.get("firstName"), 80)
    outgoing = _outgoing_texts(whatsapp)
    preferred = first_name
    honorific_observed = False

    if first_name:
        first_re = re.escape(first_name)
        honorific_re = re.compile(
            rf"\b({'|'.join(re.escape(item) for item in _HONORIFICS)})\s+({first_re})\b",
            re.IGNORECASE,
        )
        for text in reversed(outgoing):
            match = honorific_re.search(text)
            if match:
                honorific = match.group(1).lower()
                preferred = f"{honorific} {first_name}"
                honorific_observed = True
                break

    usted_score = 0
    tu_score = 0
    for text in outgoing:
        lowered = f" {text.casefold()} "
        if re.search(r"\busted\b", lowered):
            usted_score += 4
        if re.search(r"\b(?:le|su|sus)\b", lowered):
            usted_score += 1
        if re.search(r"\b(?:quiere|puede|alcanzó|pudo|prefiere)\b", lowered):
            usted_score += 1
        if re.search(r"\b(?:tú|tu|tus|te)\b", lowered):
            tu_score += 1
        if re.search(r"\b(?:quieres|puedes|alcanzaste|pudiste|prefieres)\b", lowered):
            tu_score += 2

    register = "UNKNOWN"
    if usted_score >= tu_score + 2 and usted_score >= 2:
        register = "USTED"
    elif tu_score >= usted_score + 2 and tu_score >= 2:
        register = "TU"

    return {
        "preferredAddress": preferred or "Cliente",
        "honorificObserved": honorific_observed,
        "register": register,
        "evidence": "recent_outgoing_whatsapp" if outgoing else "none",
        "rule": (
            "Preservar la forma de trato observada. No quitar un honorífico usado de forma consistente "
            "y no inventar honoríficos que no aparezcan en la conversación."
        ),
    }


def preferred_address(context: dict[str, Any]) -> str:
    style = context.get("conversationStyle") if isinstance(context.get("conversationStyle"), dict) else {}
    address = _clean(style.get("preferredAddress"), 100)
    if address:
        return address
    quote = context.get("quote") if isinstance(context.get("quote"), dict) else {}
    return _clean(quote.get("firstName"), 80) or "Cliente"


def conversation_register(context: dict[str, Any]) -> str:
    style = context.get("conversationStyle") if isinstance(context.get("conversationStyle"), dict) else {}
    value = _clean(style.get("register"), 20).upper()
    return value if value in {"TU", "USTED"} else "UNKNOWN"


def natural_product_subject(value: Any) -> str:
    """Turn storage-style quote description into a short human phrase, or return blank if complex."""
    raw = re.sub(r"\s+", " ", _clean(value, 320)).strip(" /,;.-")
    if not raw:
        return ""
    # Multiple slash-separated items should not be echoed into WhatsApp.
    if "/" in raw or ";" in raw:
        return ""
    raw = re.sub(r"^\s*\d+\s*[x×]\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s+", " ", raw).strip(" /,;.-")
    if not raw or len(raw.split()) > 10 or len(raw) > 100:
        return ""
    return raw


def followup_attempt_count(context: dict[str, Any]) -> int:
    followup = context.get("followup") if isinstance(context.get("followup"), dict) else {}
    try:
        stored = max(0, int(followup.get("attempts") or 0))
    except (TypeError, ValueError):
        stored = 0
    timeline = context.get("timeline") if isinstance(context.get("timeline"), list) else []
    sent_events = 0
    for event in timeline:
        if not isinstance(event, dict):
            continue
        event_type = _clean(event.get("eventType"), 80).upper()
        channel = _clean(event.get("channel"), 40).upper()
        if event_type in {"MESSAGE_SENT", "WHATSAPP_SENT"} and channel == "WHATSAPP":
            sent_events += 1
    return max(stored, sent_events)


def _source_text(context: dict[str, Any]) -> str:
    chunks: list[str] = []
    quote = context.get("quote") if isinstance(context.get("quote"), dict) else {}
    chunks.append(_clean(quote.get("manualNote"), 1800))
    for event in context.get("timeline") or []:
        if isinstance(event, dict):
            chunks.append(_clean(event.get("text"), 900))
    whatsapp = context.get("whatsapp") if isinstance(context.get("whatsapp"), dict) else {}
    for message in whatsapp.get("messages") or []:
        if isinstance(message, dict):
            chunks.append(_clean(message.get("text"), 1200))
    return "\n".join(item for item in chunks if item)


def has_unverified_payment_completion_claim(message: Any, context: dict[str, Any]) -> bool:
    """Block Hommy from turning an awaited payment/payday into a completed fact."""
    text = _clean(message, 1600)
    if not text or not _PAYMENT_COMPLETION_RE.search(text):
        return False
    evidence = _source_text(context)
    return not bool(_PAYMENT_COMPLETION_RE.search(evidence))


def build_followup_history(detail: dict[str, Any], whatsapp: dict[str, Any], *, limit: int = 60) -> list[dict[str, Any]]:
    """Build a compact, PII-light commercial history for the card accordion."""
    out: list[dict[str, Any]] = []
    timeline = detail.get("timeline") if isinstance(detail.get("timeline"), list) else []
    for item in timeline[-60:]:
        if not isinstance(item, dict):
            continue
        event_type = _clean(item.get("eventType"), 80).upper()
        actor_type = _clean(item.get("actorType"), 40).upper()
        channel = _clean(item.get("channel"), 40).upper()
        kind = "STATUS"
        if event_type == "QUOTE_CREATED":
            kind = "QUOTE_CREATED"
        elif event_type in {"MESSAGE_SENT", "WHATSAPP_SENT"}:
            kind = "OUTGOING"
        elif event_type in {"MESSAGE_RECEIVED", "WHATSAPP_RECEIVED", "CLIENT_REPLY"}:
            kind = "INCOMING"
        elif event_type == "MANUAL_NOTE":
            kind = "NOTE"
        elif event_type in {"ARCHIVED", "CONVERTED", "STOPPED"}:
            kind = "CLOSED"
        out.append({
            "at": _clean(item.get("fecha"), 100),
            "kind": kind,
            "source": "HOME_EASY",
            "actorType": actor_type,
            "channel": channel,
            "eventType": event_type,
            "text": _clean(item.get("text"), 1400),
        })

    evidence = whatsapp.get("evidence") if isinstance(whatsapp.get("evidence"), dict) else {}
    delivery = evidence.get("quoteDelivery") if isinstance(evidence.get("quoteDelivery"), dict) else None
    if delivery:
        out.append({
            "at": _clean(delivery.get("at"), 100),
            "kind": "QUOTE_SENT",
            "source": "WHATSAPP",
            "actorType": "HUMAN",
            "channel": "WHATSAPP",
            "eventType": "QUOTE_SENT",
            "text": "Cotización enviada por WhatsApp.",
        })

    messages = whatsapp.get("messages") if isinstance(whatsapp.get("messages"), list) else []
    for item in messages[-36:]:
        if not isinstance(item, dict):
            continue
        direction = _clean(item.get("direction"), 20).upper()
        if direction not in {"OUTGOING", "INCOMING"}:
            continue
        out.append({
            "at": _clean(item.get("at"), 100),
            "kind": direction,
            "source": "WHATSAPP",
            "actorType": "CLIENT" if direction == "INCOMING" else "HUMAN",
            "channel": "WHATSAPP",
            "eventType": "MESSAGE_RECEIVED" if direction == "INCOMING" else "MESSAGE_SENT",
            "text": _clean(item.get("text"), 1400),
        })

    def sort_key(item: dict[str, Any]) -> float:
        parsed = _parse_date(item.get("at"))
        return parsed.timestamp() if parsed else 0.0

    out.sort(key=sort_key)

    # Remove obvious duplicates produced when a sent message exists in both HomeEasy timeline and WAHA.
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for item in out:
        parsed = _parse_date(item.get("at"))
        minute = int(parsed.timestamp() // 60) if parsed else 0
        text_key = re.sub(r"\s+", " ", _clean(item.get("text"), 500)).casefold()
        kind = _clean(item.get("kind"), 40).upper()
        key = (kind, text_key, minute)
        if text_key and key in seen:
            continue
        if text_key:
            seen.add(key)
        deduped.append(item)
    return deduped[-max(1, min(int(limit or 60), 80)):]
