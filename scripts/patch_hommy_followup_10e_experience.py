from pathlib import Path

path = Path('hommy_backend/followup.py')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    source = source.replace(old, new, 1)

replace_once(
    'from .whatsapp_context import WhatsAppConversationClient\n',
    'from .whatsapp_context import WhatsAppConversationClient\n'
    'from .followup_experience import (\n'
    '    build_followup_history,\n'
    '    conversation_register,\n'
    '    followup_attempt_count,\n'
    '    has_unverified_payment_completion_claim,\n'
    '    infer_conversation_style,\n'
    '    natural_product_subject,\n'
    '    preferred_address,\n'
    ')\n',
    'experience imports',
)
replace_once('PLAYBOOK_VERSION = "1.2"\nFOLLOWUP_STAGE = "10C2"\n', 'PLAYBOOK_VERSION = "1.3"\nFOLLOWUP_STAGE = "10E"\n', 'versions')

needle = '''- usa el historial reciente para evitar repetir preguntas o información que ya se dijo.\n\nNo expongas razonamiento interno. explanation debe ser una razón comercial corta y factual.\n'''
replacement = '''- usa el historial reciente para evitar repetir preguntas o información que ya se dijo.\n\nForma de trato y naturalidad:\n- conserva la manera respetuosa en que HomeEasy ya viene hablando con esa persona;\n- si la conversación usa de forma consistente un tratamiento como "doña Sandra", "don Carlos",\n  "señora Marta" o "señor Jorge", mantenlo: no rebajes "doña Sandra" a "Sandra";\n- no inventes "don", "doña", "señor" o "señora" cuando no exista evidencia en la conversación;\n- si se distingue tuteo o trato de usted, mantén ese registro en el borrador;\n- evita copiar literalmente texto de base de datos como "1 x producto /"; conviértelo en lenguaje humano o\n  simplemente habla de "la propuesta" cuando el producto no pueda expresarse con naturalidad.\n\nRegla temporal crítica:\n- una condición futura o incierta no se convierte en un hecho solo porque pasó tiempo;\n- si el cliente dijo "cuando nos paguen la quincena", "cuando me paguen", "cuando tenga el dinero" o similar,\n  NUNCA escribas "como ya les pagaron", "ahora que ya te pagaron" ni afirmes que esa condición ocurrió\n  salvo que exista un mensaje posterior que lo confirme explícitamente;\n- al retomar una condición así usa lenguaje neutral: "paso por aquí para retomar la propuesta que habíamos dejado pendiente".\n\nNo expongas razonamiento interno. explanation debe ser una razón comercial corta y factual.\n'''
replace_once(needle, replacement, 'instructions')

old_attempts = '''    try:\n        attempts = int(followup.get("attempts") or 0)\n    except (TypeError, ValueError):\n        attempts = 0\n    if attempts > 0:\n        return None\n'''
new_attempts = '''    attempts = followup_attempt_count(context)\n    if attempts > 0:\n        return None\n'''
replace_once(old_attempts, new_attempts, 'attempt count')

old_message = '''    first_name = _clean(quote.get("firstName"), 80) or "Cliente"\n    description = re.sub(r"\\s+", " ", _clean(quote.get("description"), 120)).strip(" .,-")\n    product_hint = f" para tu {description.lower()}" if description and len(description.split()) <= 12 else ""\n    message = (\n        f"Hola {first_name} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos{product_hint}. "\n        "Si te quedó alguna duda sobre la tela, las medidas o el sistema, con gusto te ayudo. "\n        "¿Hay algún detalle que quieras ajustar o comparar?"\n    )\n    if len(message.split()) > 90:\n        message = (\n            f"Hola {first_name} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos. "\n            "Si te quedó alguna duda sobre la tela, las medidas o el sistema, con gusto te ayudo. "\n            "¿Hay algún detalle que quieras ajustar o comparar?"\n        )\n'''
new_message = '''    address = preferred_address(context)\n    register = conversation_register(context)\n    subject = natural_product_subject(quote.get("description"))\n    subject_hint = f" sobre {subject}" if subject else ""\n    if register == "USTED":\n        message = (\n            f"Hola {address} 😊 Quería saber si alcanzó a revisar la propuesta que le enviamos{subject_hint}. "\n            "Si le quedó alguna duda sobre la tela, las medidas o el sistema, con gusto le ayudo. "\n            "¿Hay algún detalle que quiera ajustar o comparar?"\n        )\n    else:\n        message = (\n            f"Hola {address} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos{subject_hint}. "\n            "Si te quedó alguna duda sobre la tela, las medidas o el sistema, con gusto te ayudo. "\n            "¿Hay algún detalle que quieras ajustar o comparar?"\n        )\n    if len(message.split()) > 90:\n        if register == "USTED":\n            message = (\n                f"Hola {address} 😊 Quería saber si alcanzó a revisar la propuesta que le enviamos. "\n                "Si le quedó alguna duda, con gusto la revisamos. ¿Hay algún detalle que quiera ajustar o comparar?"\n            )\n        else:\n            message = (\n                f"Hola {address} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos. "\n                "Si te quedó alguna duda, con gusto la revisamos. ¿Hay algún detalle que quieras ajustar o comparar?"\n            )\n'''
replace_once(old_message, new_message, 'first silence copy')

old_guard = '''        for pattern in _UNVERIFIED_CLAIM_PATTERNS:\n            if re.search(pattern, lowered, flags=re.IGNORECASE):\n                raise FollowupPlanError(\n                    "El borrador introduce una condición comercial no verificada.",\n                    "FOLLOWUP_UNVERIFIED_CLAIM",\n                    502,\n                )\n'''
new_guard = old_guard + '''        if has_unverified_payment_completion_claim(message, context):\n            raise FollowupPlanError(\n                "El borrador convirtió una condición de pago pendiente en un hecho no verificado.",\n                "FOLLOWUP_UNVERIFIED_TEMPORAL_CLAIM",\n                502,\n            )\n'''
replace_once(old_guard, new_guard, 'temporal claim guard')

old_context = '''        commercial_context = minimize_followup_context(detail, now=now)\n        commercial_context["whatsapp"] = whatsapp_context\n        source_whatsapp_key = _whatsapp_state_key(whatsapp_context)\n'''
new_context = '''        commercial_context = minimize_followup_context(detail, now=now)\n        commercial_context["whatsapp"] = whatsapp_context\n        commercial_context["conversationStyle"] = infer_conversation_style(commercial_context["quote"], whatsapp_context)\n        source_whatsapp_key = _whatsapp_state_key(whatsapp_context)\n'''
replace_once(old_context, new_context, 'conversation style context')

old_return = '''            "reviewOnly": True,\n            "analysisMs": round((time.perf_counter() - started) * 1000, 1),\n            "plan": validated,\n        }\n'''
new_return = '''            "reviewOnly": True,\n            "analysisMs": round((time.perf_counter() - started) * 1000, 1),\n            "sourceAttemptCount": followup_attempt_count(commercial_context),\n            "plan": validated,\n        }\n'''
replace_once(old_return, new_return, 'source attempt count')

history_anchor = '''    def _model_plan(self, context: AuthContext, commercial_context: dict[str, Any]) -> dict[str, Any]:\n'''
history_method = '''    def history(\n        self,\n        quote_number: str,\n        context: AuthContext,\n        *,\n        session_token: str,\n        client_meta: dict[str, Any] | None,\n        now: datetime | None = None,\n    ) -> dict[str, Any]:\n        require_followup_permission(context)\n        number = normalize_quote_number(quote_number)\n        if not number or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", number):\n            raise FollowupPlanError("El número de cotización no es válido.", "FOLLOWUP_QUOTE_INVALID", 400)\n        detail = self.followup_client.detail(\n            number, session_token=session_token, client_meta=client_meta, limit_events=60\n        )\n        whatsapp_context = self.whatsapp_client.context(\n            number, detail, session_token=session_token, client_meta=client_meta, now=now\n        )\n        commercial_context = minimize_followup_context(detail, now=now)\n        commercial_context["whatsapp"] = whatsapp_context\n        commercial_context["conversationStyle"] = infer_conversation_style(commercial_context["quote"], whatsapp_context)\n        source_quote = normalize_quote_number(commercial_context["quote"].get("number"))\n        if source_quote != number:\n            raise FollowupPlanError(\n                "HomeEasy devolvió una cotización distinta a la solicitada.",\n                "FOLLOWUP_QUOTE_MISMATCH",\n                409,\n            )\n        followup = commercial_context.get("followup") if isinstance(commercial_context.get("followup"), dict) else {}\n        return {\n            "quoteNumber": number,\n            "stage": FOLLOWUP_STAGE,\n            "status": {\n                "state": _clean(followup.get("state"), 80).upper(),\n                "intent": _clean(followup.get("intent"), 80).upper(),\n                "temperature": _clean(followup.get("temperature"), 40).upper(),\n                "attempts": followup_attempt_count(commercial_context),\n                "lastOutgoingAt": _clean(followup.get("lastOutgoingAt"), 100),\n                "lastIncomingAt": _clean(followup.get("lastIncomingAt"), 100),\n            },\n            "conversationStyle": commercial_context["conversationStyle"],\n            "history": build_followup_history(detail, whatsapp_context, limit=60),\n        }\n\n'''
replace_once(history_anchor, history_method + history_anchor, 'history method')

path.write_text(source, encoding='utf-8')
