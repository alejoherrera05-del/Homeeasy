from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

experience_path = Path('hommy_backend/followup_experience.py')
experience = experience_path.read_text(encoding='utf-8')

experience = replace_once(
    experience,
    '_PAYMENT_COMPLETION_RE = re.compile(\n    r"\\b(?:ya\\s+)?(?:(?:me|nos|te|le|les)\\s+)?(?:pagaron|consignaron|depositaron)\\b|"\n    r"\\b(?:ya\\s+)?(?:recib[ií]|recibimos|recibiste|recibieron)\\s+(?:el\\s+)?pago\\b",\n    re.IGNORECASE,\n)\n',
    '_PAYMENT_COMPLETION_RE = re.compile(\n    r"\\b(?:ya\\s+)?(?:(?:me|nos|te|le|les)\\s+)?(?:pagaron|consignaron|depositaron)\\b|"\n    r"\\b(?:ya\\s+)?(?:recib[ií]|recibimos|recibiste|recibieron)\\s+(?:el\\s+)?pago\\b",\n    re.IGNORECASE,\n)\n_RELATIONSHIP_PATTERNS = (\n    re.compile(r"\\b(?:espos[oa]|marido|pareja)\\b", re.IGNORECASE),\n    re.compile(r"\\bhij[oa]s?\\b", re.IGNORECASE),\n    re.compile(r"\\b(?:mamá|mama|madre|papá|papa|padre)\\b", re.IGNORECASE),\n)\n_PRODUCT_CANONICAL = (\n    (re.compile(r"\\bonda\\s+serena\\b", re.IGNORECASE), "Onda Serena"),\n    (re.compile(r"\\bsheer\\s+elegance\\b", re.IGNORECASE), "Sheer Elegance"),\n    (re.compile(r"\\bsheer\\s+vertesse\\b", re.IGNORECASE), "Sheer Vertesse"),\n    (re.compile(r"\\bpanel(?:es)?\\s+japon[eé]s(?:es)?\\b", re.IGNORECASE), "Panel Japonés"),\n    (re.compile(r"\\benrollable\\s+blackout\\b", re.IGNORECASE), "Enrollable Blackout"),\n    (re.compile(r"\\bblackout\\b", re.IGNORECASE), "Blackout"),\n    (re.compile(r"\\bscreen\\b", re.IGNORECASE), "Screen"),\n)\n',
    'experience constants',
)

old_natural = '''def natural_product_subject(value: Any) -> str:\n    """Turn storage-style quote description into a short human phrase, or return blank if complex."""\n    raw = re.sub(r"\\s+", " ", _clean(value, 320)).strip(" /,;.-")\n    if not raw:\n        return ""\n    # Multiple slash-separated items should not be echoed into WhatsApp.\n    if "/" in raw or ";" in raw:\n        return ""\n    raw = re.sub(r"^\\s*\\d+\\s*[x×]\\s*", "", raw, flags=re.IGNORECASE)\n    raw = re.sub(r"\\s+", " ", raw).strip(" /,;.-")\n    if not raw or len(raw.split()) > 10 or len(raw) > 100:\n        return ""\n    return raw\n'''
new_natural = '''def natural_product_subject(value: Any) -> str:\n    """Turn storage-style quote description into short, brand-correct human language."""\n    raw = re.sub(r"\\s+", " ", _clean(value, 320)).strip(" /,;.-")\n    if not raw:\n        return ""\n    # Multiple item delimiters are a signal to say "la propuesta" instead of reciting storage text.\n    if "/" in raw or ";" in raw:\n        return ""\n    raw = re.sub(r"^\\s*\\d+\\s*[x×]\\s*", "", raw, flags=re.IGNORECASE)\n    for pattern, canonical in _PRODUCT_CANONICAL:\n        raw = pattern.sub(canonical, raw)\n    raw = re.sub(r"\\s+", " ", raw).strip(" /,;.-")\n    if not raw or len(raw.split()) > 10 or len(raw) > 100:\n        return ""\n    return raw\n'''
experience = replace_once(experience, old_natural, new_natural, 'natural product subject')

payment_block = '''def has_unverified_payment_completion_claim(message: Any, context: dict[str, Any]) -> bool:\n    """Block Hommy from turning an awaited payment/payday into a completed fact."""\n    text = _clean(message, 1600)\n    if not text or not _PAYMENT_COMPLETION_RE.search(text):\n        return False\n    evidence = _source_text(context)\n    return not bool(_PAYMENT_COMPLETION_RE.search(evidence))\n'''
relationship_block = payment_block + '''\n\ndef has_unverified_relationship_claim(message: Any, context: dict[str, Any]) -> bool:\n    """Do not invent a spouse/partner/family member merely to sound personal."""\n    text = _clean(message, 1600)\n    if not text:\n        return False\n    evidence = _source_text(context)\n    for pattern in _RELATIONSHIP_PATTERNS:\n        if pattern.search(text) and not pattern.search(evidence):\n            return True\n    return False\n'''
experience = replace_once(experience, payment_block, relationship_block, 'relationship claim guard')
experience_path.write_text(experience, encoding='utf-8')

followup_path = Path('hommy_backend/followup.py')
followup = followup_path.read_text(encoding='utf-8')
followup = replace_once(
    followup,
    '    has_unverified_payment_completion_claim,\n    infer_conversation_style,\n',
    '    has_unverified_payment_completion_claim,\n    has_unverified_relationship_claim,\n    infer_conversation_style,\n',
    'relationship import',
)
followup = replace_once(followup, 'PLAYBOOK_VERSION = "1.3"', 'PLAYBOOK_VERSION = "1.4"', 'playbook version')
followup = replace_once(followup, 'FOLLOWUP_STAGE = "10E"', 'FOLLOWUP_STAGE = "10F.1"', 'stage version')

old_style = '''- si se distingue tuteo o trato de usted, mantén ese registro en el borrador;\n- evita copiar literalmente texto de base de datos como "1 x producto /"; conviértelo en lenguaje humano o\n  simplemente habla de "la propuesta" cuando el producto no pueda expresarse con naturalidad.\n'''
new_style = '''- si se distingue tuteo o trato de usted, mantén ese registro en el borrador;\n- no inventes esposo, esposa, pareja, hijos u otros vínculos familiares para personalizar: solo menciónalos si aparecen explícitamente en la evidencia;\n- no deduzcas el género de quien atiende HomeEasy para cerrar con "atenta" o "atento"; prefiere cierres neutros como "quedo pendiente";\n- evita copiar literalmente texto de base de datos como "1 x producto /"; conviértelo en lenguaje humano o\n  simplemente habla de "la propuesta" cuando el producto no pueda expresarse con naturalidad.\n'''
followup = replace_once(followup, old_style, new_style, 'style instructions')

old_temporal = '''- al retomar una condición así usa lenguaje neutral: "paso por aquí para retomar la propuesta que habíamos dejado pendiente".\n'''
new_temporal = '''- al retomar una condición así usa lenguaje neutral: "paso por aquí para retomar la propuesta que habíamos dejado pendiente";\n- usa circunstancias financieras personales (quincena, pago pendiente, flujo de dinero) para decidir el momento, pero normalmente NO las repitas de forma literal al cliente si puedes retomar con naturalidad sin exponerlas.\n'''
followup = replace_once(followup, old_temporal, new_temporal, 'temporal discretion instruction')

old_specific_usted = '''        message = (\n            f"Hola {address} 😊 Quería saber si alcanzó a revisar la propuesta que le enviamos{subject_hint}. "\n            "Si le quedó alguna duda sobre la tela, las medidas o el sistema, con gusto le ayudo. "\n            "¿Hay algún detalle que quiera ajustar o comparar?"\n        )\n'''
new_specific_usted = '''        message = (\n            f"Hola {address} 😊 Quería saber si alcanzó a revisar la propuesta que le enviamos{subject_hint}. "\n            "Si le quedó alguna duda o quiere revisar algún detalle, con gusto le ayudo. "\n            "¿Hay algo que quisiera ajustar o comparar?"\n        )\n'''
followup = replace_once(followup, old_specific_usted, new_specific_usted, 'first followup usted copy')
old_specific_tu = '''        message = (\n            f"Hola {address} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos{subject_hint}. "\n            "Si te quedó alguna duda sobre la tela, las medidas o el sistema, con gusto te ayudo. "\n            "¿Hay algún detalle que quieras ajustar o comparar?"\n        )\n'''
new_specific_tu = '''        message = (\n            f"Hola {address} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos{subject_hint}. "\n            "Si te quedó alguna duda o quieres revisar algún detalle, con gusto te ayudo. "\n            "¿Hay algo que quieras ajustar o comparar?"\n        )\n'''
followup = replace_once(followup, old_specific_tu, new_specific_tu, 'first followup tu copy')

old_payment_guard = '''        if has_unverified_payment_completion_claim(message, context):\n            raise FollowupPlanError(\n                "El borrador convirtió una condición de pago pendiente en un hecho no verificado.",\n                "FOLLOWUP_UNVERIFIED_TEMPORAL_CLAIM",\n                502,\n            )\n'''
new_payment_guard = old_payment_guard + '''        if has_unverified_relationship_claim(message, context):\n            raise FollowupPlanError(\n                "El borrador introdujo una relación familiar o de pareja que no aparece en la evidencia.",\n                "FOLLOWUP_UNVERIFIED_RELATIONSHIP_CLAIM",\n                502,\n            )\n'''
followup = replace_once(followup, old_payment_guard, new_payment_guard, 'relationship validation')

followup = replace_once(
    followup,
    '        source_whatsapp_key = _whatsapp_state_key(whatsapp_context)\n',
    '',
    'remove post-model whatsapp key',
)

start_marker = '''        # Reread only after model work: if the opportunity changed while Hommy was\n        # analyzing it, the draft is discarded instead of returning stale advice.\n        if model_used:\n'''
end_marker = '''        generated_at = (now or datetime.now(HOME_EASY_TIMEZONE)).astimezone(HOME_EASY_TIMEZONE)\n'''
start = followup.find(start_marker)
end = followup.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('post-model reread block anchors missing')
replacement = '''        # REVIEW-only optimization: return the validated advisory plan after one canonical\n        # HomeEasy + WhatsApp read. No action can occur from this response alone; the Bridge\n        # revalidates both state version and WhatsApp conversation immediately before any\n        # human-approved send, so repeating both upstream reads here adds latency without\n        # weakening the actual send boundary.\n\n'''
followup = followup[:start] + replacement + followup[end:]
followup_path.write_text(followup, encoding='utf-8')

# Align regression tests with the new REVIEW boundary: analysis is advisory; send-time revalidation owns stale blocking.
test_path = Path('tests/test_hommy_followup_experience.py')
test_source = test_path.read_text(encoding='utf-8')
test_source = replace_once(
    test_source,
    'self.assertEqual(natural_product_subject("1 x Cortina onda serena 2.8 /"), "Cortina onda serena 2.8")',
    'self.assertEqual(natural_product_subject("1 x Cortina onda serena 2.8 /"), "Cortina Onda Serena 2.8")',
    'experience product expectation',
)
test_path.write_text(test_source, encoding='utf-8')

followup_test_path = Path('tests/test_hommy_followup.py')
followup_test = followup_test_path.read_text(encoding='utf-8')
old_state_test = '''    def test_state_change_discards_model_plan(self):\n        planner = FollowupPlanner(\n            SequenceClient([sample_detail(version=3), sample_detail(version=4)]),\n            FakeOpenAI(valid_plan()),\n        )\n        with self.assertRaises(FollowupPlanError) as raised:\n            planner.plan("32", self.ctx, session_token="test-session", client_meta={}, now=self.now)\n        self.assertEqual(raised.exception.code, "FOLLOWUP_STATE_CHANGED")\n        self.assertEqual(raised.exception.status_code, 409)\n'''
new_state_test = '''    def test_review_model_plan_uses_single_authoritative_snapshot(self):\n        client = SequenceClient([sample_detail(version=3), sample_detail(version=4)])\n        planner = FollowupPlanner(client, FakeOpenAI(valid_plan()))\n        result = planner.plan("32", self.ctx, session_token="test-session", client_meta={}, now=self.now)\n        self.assertTrue(result["reviewOnly"])\n        self.assertEqual(result["sourceStateVersion"], 3)\n        self.assertEqual(len(client.calls), 1)\n        self.assertEqual(len(client.items), 1, "A second HomeEasy read belongs to send-time revalidation, not REVIEW analysis")\n'''
followup_test = replace_once(followup_test, old_state_test, new_state_test, 'obsolete state reread test')
followup_test_path.write_text(followup_test, encoding='utf-8')

wa_test_path = Path('tests/test_hommy_whatsapp_context.py')
wa_test = wa_test_path.read_text(encoding='utf-8')
wa_test = replace_once(wa_test, 'self.assertEqual(result["stage"], "10E")', 'self.assertEqual(result["stage"], "10F.1")', 'whatsapp stage expectation')
old_reply_test = '''    def test_new_whatsapp_reply_discards_stale_plan(self):\n        planner = FollowupPlanner(\n            SequenceFollowupClient([source_detail(), source_detail()]),\n            FakeOpenAI(no_response_plan()),\n            SequenceWhatsAppClient([with_reply(), silent_whatsapp()]),\n        )\n        with self.assertRaises(FollowupPlanError) as raised:\n            planner.plan(\n                "32",\n                self.ctx,\n                session_token="session-secret",\n                client_meta={"dispositivoId": "device-1"},\n                now=self.now,\n            )\n        self.assertEqual(raised.exception.code, "FOLLOWUP_STATE_CHANGED")\n        self.assertEqual(raised.exception.status_code, 409)\n'''
new_reply_test = '''    def test_review_analysis_uses_current_whatsapp_snapshot_once(self):\n        wait_plan = {\n            "decision": "WAIT",\n            "reasonCode": "CUSTOMER_WAIT_REQUEST",\n            "intent": "WAITING_UNTIL_DATE",\n            "temperature": "WAITING",\n            "summary": "La cliente respondió que confirmará mañana.",\n            "objective": "Respetar el tiempo que pidió la cliente.",\n            "message": None,\n            "nextActionAt": "2026-09-04T15:30:00-05:00",\n            "confidence": 0.94,\n            "needsHumanReview": False,\n            "stopReason": None,\n            "explanation": "La respuesta entrante pidió esperar hasta mañana.",\n        }\n        followup = SequenceFollowupClient([source_detail(), source_detail()])\n        whatsapp = SequenceWhatsAppClient([with_reply(), silent_whatsapp()])\n        planner = FollowupPlanner(followup, FakeOpenAI(wait_plan), whatsapp)\n        result = planner.plan(\n            "32",\n            self.ctx,\n            session_token="session-secret",\n            client_meta={"dispositivoId": "device-1"},\n            now=self.now,\n        )\n        self.assertEqual(result["plan"]["decision"], "WAIT")\n        self.assertEqual(result["plan"]["intent"], "WAITING_UNTIL_DATE")\n        self.assertEqual(len(whatsapp.calls), 1)\n        self.assertEqual(len(followup.rows), 1, "Final stale protection is enforced again immediately before human-approved send")\n'''
wa_test = replace_once(wa_test, old_reply_test, new_reply_test, 'obsolete whatsapp reread test')
wa_test_path.write_text(wa_test, encoding='utf-8')
