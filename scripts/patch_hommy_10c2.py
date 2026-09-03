from pathlib import Path

followup_path = Path('hommy_backend/followup.py')
tests_path = Path('tests/test_hommy_whatsapp_context.py')
render_path = Path('render.yaml')

source = followup_path.read_text(encoding='utf-8')
source = source.replace('from datetime import datetime\n', 'from datetime import datetime, timedelta\n', 1)
source = source.replace('PLAYBOOK_VERSION = "1.1"\nFOLLOWUP_STAGE = "10C"', 'PLAYBOOK_VERSION = "1.2"\nFOLLOWUP_STAGE = "10C2"', 1)

anchor = '''def deterministic_followup_plan(context: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any] | None:\n'''
helper = r'''def _first_silence_followup_plan(context: dict[str, Any], *, now: datetime) -> dict[str, Any] | None:
    quote = context.get("quote") if isinstance(context.get("quote"), dict) else {}
    followup = context.get("followup") if isinstance(context.get("followup"), dict) else {}
    whatsapp = context.get("whatsapp") if isinstance(context.get("whatsapp"), dict) else {}
    if whatsapp.get("available") is not True:
        return None
    evidence = whatsapp.get("evidence") if isinstance(whatsapp.get("evidence"), dict) else {}
    delivery = evidence.get("quoteDelivery") if isinstance(evidence.get("quoteDelivery"), dict) else None
    if not delivery:
        return None
    delivery_state = _clean(delivery.get("state"), 40).upper()
    if delivery_state not in {"SENT", "DELIVERED", "READ", "PLAYED"}:
        return None
    if bool(evidence.get("customerRepliedAfterQuote")):
        return None
    try:
        attempts = int(followup.get("attempts") or 0)
    except (TypeError, ValueError):
        attempts = 0
    if attempts > 0:
        return None

    last_outgoing = _parse_iso(evidence.get("lastOutgoingAt")) or _parse_iso(delivery.get("at"))
    if not last_outgoing:
        return None
    hours = max(0.0, (now - last_outgoing).total_seconds() / 3600.0)
    minimum_hours = 36.0
    if hours < minimum_hours:
        next_at = last_outgoing + timedelta(hours=minimum_hours)
        return _base_plan(
            decision="WAIT",
            reason_code="NO_NEW_VALUE",
            intent="NO_RESPONSE",
            temperature="WAITING",
            summary="La cotización fue enviada por WhatsApp y aún es pronto para un primer seguimiento.",
            objective="Dar espacio al cliente antes de retomar la conversación.",
            message=None,
            next_action_at=next_at.isoformat(timespec="seconds"),
            confidence=0.99,
            needs_human_review=False,
            stop_reason=None,
            explanation="WhatsApp confirma el envío, pero todavía no ha transcurrido una ventana prudente para retomar el contacto.",
        )

    first_name = _clean(quote.get("firstName"), 80) or "Cliente"
    description = re.sub(r"\\s+", " ", _clean(quote.get("description"), 180)).strip(" .,-")
    product_phrase = f" la propuesta de {description}" if description else " la propuesta que te enviamos"
    message = (
        f"Hola {first_name} 😊 Quería saber si alcanzaste a revisar{product_phrase}. "
        "Si te quedó alguna duda sobre la tela, las medidas o algún ajuste, con gusto te ayudo a revisarlo. "
        "¿Hay algún detalle que quieras que revisemos?"
    )
    if len(message.split()) > 90:
        message = (
            f"Hola {first_name} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos. "
            "Si te quedó alguna duda sobre la tela, las medidas o algún ajuste, con gusto te ayudo a revisarlo. "
            "¿Hay algún detalle que quieras que revisemos?"
        )
    return _base_plan(
        decision="SEND",
        reason_code="FOLLOWUP_DUE",
        intent="NO_RESPONSE",
        temperature="ACTIVE",
        summary="La cotización fue enviada por WhatsApp y no existe una respuesta posterior del cliente.",
        objective="Confirmar que pudo revisar la propuesta y abrir una ayuda concreta sin presión.",
        message=message,
        next_action_at=None,
        confidence=0.99,
        needs_human_review=False,
        stop_reason=None,
        explanation="WhatsApp confirma el envío y no registra respuesta posterior; corresponde un primer seguimiento liviano.",
    )


'''
if helper not in source:
    source = source.replace(anchor, helper + anchor, 1)

before_guard = '''    if not has_meaningful_followup_evidence(context):\n'''
fast_call = '''    first_silence = _first_silence_followup_plan(context, now=local_now)\n    if first_silence is not None:\n        return first_silence\n\n'''
if fast_call not in source:
    source = source.replace(before_guard, fast_call + before_guard, 1)

source = source.replace(
    'timeout = max(10.0, min(float(os.getenv("HOMMY_OPENAI_TIMEOUT_SECONDS", "55")), 80.0))\n        max_retries = max(0, min(int(os.getenv("HOMMY_OPENAI_MAX_RETRIES", "1")), 2))',
    'timeout = max(10.0, min(float(os.getenv("HOMMY_FOLLOWUP_OPENAI_TIMEOUT_SECONDS", "45")), 60.0))\n        max_retries = max(0, min(int(os.getenv("HOMMY_FOLLOWUP_OPENAI_MAX_RETRIES", "0")), 1))',
    1,
)
followup_path.write_text(source, encoding='utf-8')

tests = tests_path.read_text(encoding='utf-8')
tests = tests.replace('self.assertEqual(result["stage"], "10C")', 'self.assertEqual(result["stage"], "10C2")', 1)
tests = tests.replace('whatsapp = SequenceWhatsAppClient([silent_whatsapp(), silent_whatsapp()])', 'whatsapp = SequenceWhatsAppClient([silent_whatsapp()])', 1)
tests = tests.replace('SequenceFollowupClient([source_detail(), source_detail()]),\n            ai,\n            whatsapp,', 'SequenceFollowupClient([source_detail()]),\n            ai,\n            whatsapp,', 1)
tests = tests.replace('self.assertEqual(result["model"], planner.model)\n        self.assertEqual(len(ai.responses.calls), 1)\n        prompt = ai.responses.calls[0]["input"][0]["content"]\n        self.assertIn("Quedamos atentos a cualquier duda", prompt)\n        self.assertIn(\'"incomingCount":0\', prompt)\n        self.assertIn(\'"reference":"COT-32"\', prompt)\n        self.assertNotIn("3001112233", prompt)\n        self.assertNotIn("SECRET-ID", prompt)', 'self.assertEqual(result["model"], "deterministic-guard")\n        self.assertEqual(len(ai.responses.calls), 0)\n        self.assertEqual(len(whatsapp.calls), 1)\n        self.assertIn("Karen", result["plan"]["message"])\n        self.assertIn("propuesta", result["plan"]["message"].lower())', 1)
tests = tests.replace('SequenceWhatsAppClient([silent_whatsapp(), with_reply()]),', 'SequenceWhatsAppClient([with_reply(), silent_whatsapp()]),', 1)
tests_path.write_text(tests, encoding='utf-8')

render = render_path.read_text(encoding='utf-8')
anchor_env = '      - key: HOMMY_OPENAI_MAX_RETRIES\n        value: "1"\n'
extra_env = '''      - key: HOMMY_FOLLOWUP_OPENAI_TIMEOUT_SECONDS\n        value: "45"\n      - key: HOMMY_FOLLOWUP_OPENAI_MAX_RETRIES\n        value: "0"\n      - key: HOMMY_FOLLOWUP_MAX_OUTPUT_TOKENS\n        value: "700"\n'''
if extra_env not in render:
    render = render.replace(anchor_env, anchor_env + extra_env, 1)
render_path.write_text(render, encoding='utf-8')

print('Hommy 10C2 patch prepared')
