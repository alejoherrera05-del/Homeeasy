from pathlib import Path

client_path = Path('homeeasy-whatsapp-client.js')
seguimiento_path = Path('seguimiento.html')
hommy_path = Path('seguimiento-hommy.js')

client = client_path.read_text(encoding='utf-8')
client = client.replace("const VERSION = '0.5.0';", "const VERSION = '0.6.0';", 1)

client_anchor = "    function connectedPhone(statusPayload) {"
client_block = r'''    function sendFollowup(options) {
        const opts = options || {};
        return request('/api/whatsapp/send-followup', {
            method: 'POST',
            timeoutMs: 45000,
            body: {
                reference: String(opts.reference || '').trim(),
                text: String(opts.text || '').trim(),
                planId: String(opts.planId || '').trim(),
                expectedVersion: Number(opts.expectedVersion),
                generatedAt: String(opts.generatedAt || '').trim()
            }
        });
    }

'''
if 'function sendFollowup(options)' not in client:
    if client_anchor not in client:
        raise SystemExit('Could not find client connectedPhone anchor')
    client = client.replace(client_anchor, client_block + client_anchor, 1)

export_anchor = "        sendDocumentUrl,\n        connectedPhone,"
if '        sendFollowup,\n' not in client:
    if export_anchor not in client:
        raise SystemExit('Could not find client export anchor')
    client = client.replace(export_anchor, "        sendDocumentUrl,\n        sendFollowup,\n        connectedPhone,", 1)
client_path.write_text(client, encoding='utf-8')

seguimiento = seguimiento_path.read_text(encoding='utf-8')
old_scripts = '''    <script src="homeeasy-core.js?v=3.5"></script>\n    <script src="homeeasy-page-guard.js?v=3.6"></script>\n    <script src="seguimiento-hommy.js?v=10c2" defer></script>'''
new_scripts = '''    <script src="homeeasy-core.js?v=3.5"></script>\n    <script src="homeeasy-page-guard.js?v=3.6"></script>\n    <script src="homeeasy-whatsapp-client.js?v=0.6.0"></script>\n    <script src="seguimiento-hommy.js?v=10d1" defer></script>'''
if old_scripts in seguimiento:
    seguimiento = seguimiento.replace(old_scripts, new_scripts, 1)
elif 'homeeasy-whatsapp-client.js?v=0.6.0' not in seguimiento:
    raise SystemExit('Could not find seguimiento script block')
seguimiento_path.write_text(seguimiento, encoding='utf-8')

hommy = hommy_path.read_text(encoding='utf-8')

const_anchor = "  const REQUEST_TIMEOUT_MS = 90_000;"
const_replacement = "  const REQUEST_TIMEOUT_MS = 90_000;\n  const HOME_EASY_API = String(window.HomeEasyCore && window.HomeEasyCore.API_URL || 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');"
if 'const HOME_EASY_API =' not in hommy:
    if const_anchor not in hommy:
        raise SystemExit('Could not find Hommy timeout constant')
    hommy = hommy.replace(const_anchor, const_replacement, 1)

style_anchor = '      .he-hommy-action.primary{border-color:rgba(178,86,108,.18);color:#a0465b;background:#fbf5f7}\n'
style_block = '''      .he-hommy-action.primary{border-color:rgba(178,86,108,.18);color:#a0465b;background:#fbf5f7}\n      .he-hommy-action.send{grid-column:1/-1;border-color:rgba(43,118,95,.18);background:#eef8f3;color:#2b765f;min-height:43px}\n      .he-hommy-action.send:disabled{opacity:.68;cursor:default;transform:none}\n      .he-hommy-delivery{margin-top:10px;padding:10px 11px;border-radius:11px;background:#eef8f3;color:#2b765f;font-size:11.5px;line-height:1.4;font-weight:680;display:flex;align-items:flex-start;gap:7px}\n      .he-hommy-delivery.unknown{background:#fff8e8;color:#946c1f}\n'''
if '.he-hommy-action.send{' not in hommy:
    if style_anchor not in hommy:
        raise SystemExit('Could not find Hommy action style anchor')
    hommy = hommy.replace(style_anchor, style_block, 1)

helper_anchor = "  function renderResult(panel, numero, payload) {"
helper_block = r'''  function canSendFollowup() {
    const auth = window.HomeEasyAuth;
    return Boolean(auth && typeof auth.hasPermission === 'function' && auth.hasPermission('cotizaciones.write'));
  }

  function words(value) {
    return clean(value).split(/\s+/).filter(Boolean).length;
  }

  async function postHomeEasy(payload) {
    const response = await fetch(HOME_EASY_API, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      cache: 'no-store'
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data || !['success', 'ok'].includes(clean(data.status).toLowerCase())) {
      const error = new Error(clean(data && data.msg) || 'No fue posible actualizar la memoria de seguimiento.');
      error.code = clean(data && data.code).toUpperCase() || `HTTP_${response.status}`;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function syncSentFollowup(numero, payload, message, delivery) {
    const plan = payload.plan || {};
    const planId = clean(payload.planId);
    const sentAt = clean(delivery && delivery.sentAt) || new Date().toISOString();
    let stateResult = null;
    let stateError = null;
    let eventResult = null;
    let eventError = null;

    try {
      stateResult = await postHomeEasy({
        tipo: 'ACTUALIZAR_ESTADO_SEGUIMIENTO_IA',
        numero: clean(numero),
        expectedVersion: Number(payload.sourceStateVersion || 0),
        intencion: clean(plan.intent).toUpperCase(),
        temperatura: clean(plan.temperature).toUpperCase(),
        resumen: clean(plan.summary),
        proximaAccionFecha: plan.nextActionAt || '',
        proximaAccionTipo: 'WAIT_REPLY',
        ultimoSaliente: sentAt,
        requestId: `10D:STATE:${planId}`,
        eventText: 'Seguimiento enviado por WhatsApp con aprobación humana.',
        motivo: 'Borrador de Hommy revisado por una persona antes del envío.'
      });
    } catch (error) {
      stateError = error;
    }

    try {
      eventResult = await postHomeEasy({
        tipo: 'REGISTRAR_EVENTO_SEGUIMIENTO',
        numero: clean(numero),
        eventType: 'MESSAGE_SENT',
        channel: 'WHATSAPP',
        text: clean(message),
        messageId: clean(delivery && delivery.messageId),
        motivo: 'Seguimiento aprobado por una persona y enviado por WhatsApp.',
        metadata: {
          source: 'hommy-review-10d',
          planId,
          generatedAt: clean(payload.generatedAt),
          decision: clean(plan.decision).toUpperCase(),
          edited: clean(message) !== clean(plan.message),
          delivery: clean(delivery && delivery.delivery).toUpperCase(),
          duplicate: Boolean(delivery && delivery.duplicate)
        },
        requestId: `10D:MESSAGE_SENT:${planId}`
      });
    } catch (error) {
      eventError = error;
    }

    return {
      stateResult,
      eventResult,
      stateError,
      eventError,
      memoryOk: !stateError && !eventError
    };
  }

  function markDelivery(panel, delivery, sync) {
    if (!panel) return;
    const state = clean(delivery && delivery.delivery).toUpperCase();
    const unknown = state !== 'SENT';
    let banner = panel.querySelector('.he-hommy-delivery');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'he-hommy-delivery';
      const safe = panel.querySelector('.he-hommy-safe');
      if (safe) safe.before(banner);
      else panel.appendChild(banner);
    }
    banner.classList.toggle('unknown', unknown);
    clearPanel(banner);
    banner.append(icon(unknown ? 'fas fa-clock' : 'fab fa-whatsapp'));
    const copy = document.createElement('span');
    if (unknown) {
      copy.textContent = 'WhatsApp recibió el intento, pero el resultado quedó por confirmar. No lo reenvíes manualmente hasta revisar el chat.';
    } else if (sync && sync.memoryOk === false) {
      copy.textContent = 'Mensaje enviado por WhatsApp. El historial interno no terminó de sincronizarse, pero Hommy podrá releer el chat real.';
    } else {
      copy.textContent = 'Mensaje enviado por WhatsApp y registrado en el seguimiento. Ahora esperamos la respuesta del cliente.';
    }
    banner.appendChild(copy);

    const sendButton = panel.querySelector('.he-hommy-action.send');
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.replaceChildren(icon(state === 'SENT' ? 'fas fa-check' : 'fas fa-clock'));
      const label = document.createElement('span');
      label.textContent = state === 'SENT' ? 'Enviado por WhatsApp' : 'Envío por confirmar';
      sendButton.appendChild(label);
    }
  }

  function sendErrorMessage(error) {
    const code = clean(error && error.code).toUpperCase();
    const details = error && error.details && typeof error.details === 'object' ? error.details : {};
    const serverCode = clean(details.code || details.details && details.details.code).toUpperCase();
    const effective = serverCode || code;
    if (effective === 'FOLLOWUP_CONVERSATION_CHANGED') return 'El cliente escribió después del análisis de Hommy. Analiza de nuevo antes de enviar.';
    if (effective === 'FOLLOWUP_STATE_CHANGED') return 'El seguimiento cambió después del análisis. Analiza de nuevo antes de enviar.';
    if (effective === 'FOLLOWUP_NOT_SENDABLE') return 'Esta oportunidad ya no admite este seguimiento.';
    if (effective === 'FOLLOWUP_REVIEW_MODE_REQUIRED') return 'El envío manual solo está permitido en modo REVIEW.';
    if (effective === 'FOLLOWUP_PLAN_REUSED') return 'Este análisis ya fue usado con otro texto. Analiza de nuevo para generar un plan nuevo.';
    if (code === 'WHATSAPP_TIMEOUT' || code === 'WHATSAPP_NETWORK') return 'No pudimos confirmar el resultado. Revisa el chat antes de intentar otro envío para evitar duplicados.';
    return clean(error && error.message) || 'No fue posible enviar el seguimiento.';
  }

  async function reviewAndSend(panel, numero, payload) {
    if (!canSendFollowup()) {
      toast('Tu perfil no tiene permiso para enviar cotizaciones', 'info');
      return;
    }
    const whatsapp = window.HomeEasyWhatsApp;
    if (!whatsapp || typeof whatsapp.sendFollowup !== 'function') {
      toast('WhatsApp todavía no está listo en esta pantalla', 'error');
      return;
    }

    const plan = payload.plan || {};
    const original = clean(plan.message);
    if (!original || clean(plan.decision).toUpperCase() !== 'SEND') return;

    if (!window.Swal || typeof window.Swal.fire !== 'function') {
      toast('No se pudo abrir la revisión del mensaje', 'error');
      return;
    }

    const review = await window.Swal.fire({
      title: 'Revisar antes de enviar',
      html: '<div style="font-size:12.5px;color:#746d71;line-height:1.45;margin-bottom:8px">Puedes editar el borrador. HomeEasy verificará nuevamente la cotización y el chat justo antes del envío.</div>',
      input: 'textarea',
      inputValue: original,
      inputAttributes: {
        maxlength: '1200',
        rows: '7',
        autocapitalize: 'sentences',
        spellcheck: 'true'
      },
      showCancelButton: true,
      confirmButtonText: '<i class="fab fa-whatsapp"></i>&nbsp; Enviar por WhatsApp',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2b765f',
      cancelButtonColor: '#8e8e93',
      focusConfirm: false,
      customClass: { popup: 'swal2-premium' },
      preConfirm: value => {
        const text = clean(value);
        if (!text) {
          window.Swal.showValidationMessage('Escribe el mensaje que deseas enviar.');
          return false;
        }
        if (words(text) > 130) {
          window.Swal.showValidationMessage('El mensaje debe tener máximo 130 palabras.');
          return false;
        }
        return text;
      }
    });
    if (!review.isConfirmed) return;
    const finalMessage = clean(review.value);

    window.Swal.fire({
      title: 'Enviando por WhatsApp…',
      text: 'Estamos verificando que la conversación no haya cambiado.',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => window.Swal.showLoading(),
      customClass: { popup: 'swal2-premium' }
    });

    try {
      const delivery = await whatsapp.sendFollowup({
        reference: `COT-${clean(numero)}`,
        text: finalMessage,
        planId: clean(payload.planId),
        expectedVersion: Number(payload.sourceStateVersion || 0),
        generatedAt: clean(payload.generatedAt)
      });
      const sync = await syncSentFollowup(numero, payload, finalMessage, delivery);
      window.Swal.close();
      markDelivery(panel, delivery, sync);
      if (clean(delivery && delivery.delivery).toUpperCase() === 'SENT') {
        toast(sync.memoryOk ? 'Seguimiento enviado y registrado' : 'Seguimiento enviado por WhatsApp');
      } else {
        toast('Envío por confirmar; no lo reenvíes todavía', 'info');
      }
    } catch (error) {
      window.Swal.close();
      const message = sendErrorMessage(error);
      await window.Swal.fire({
        icon: 'info',
        title: 'No se envió el seguimiento',
        text: message,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#b2566c',
        customClass: { popup: 'swal2-premium' }
      });
      const effective = clean(error && error.details && (error.details.code || error.details.details && error.details.details.code)).toUpperCase();
      if (['FOLLOWUP_CONVERSATION_CHANGED', 'FOLLOWUP_STATE_CHANGED'].includes(effective)) {
        await analyze(panel, numero);
      }
    }
  }

'''
if 'async function reviewAndSend(panel, numero, payload)' not in hommy:
    if helper_anchor not in hommy:
        raise SystemExit('Could not find renderResult anchor')
    hommy = hommy.replace(helper_anchor, helper_block + helper_anchor, 1)

action_anchor = r'''    if (message) {
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'he-hommy-action primary';
      copyButton.append(icon('fas fa-copy'));
      const copyLabel = document.createElement('span');
      copyLabel.textContent = 'Copiar borrador';
      copyButton.appendChild(copyLabel);
      copyButton.addEventListener('click', async () => {
        if (await copyText(message)) toast('Borrador copiado');
        else toast('No fue posible copiar el borrador', 'error');
      });
      actions.appendChild(copyButton);
    }
    result.appendChild(actions);'''
action_replacement = r'''    if (message) {
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'he-hommy-action primary';
      copyButton.append(icon('fas fa-copy'));
      const copyLabel = document.createElement('span');
      copyLabel.textContent = 'Copiar borrador';
      copyButton.appendChild(copyLabel);
      copyButton.addEventListener('click', async () => {
        if (await copyText(message)) toast('Borrador copiado');
        else toast('No fue posible copiar el borrador', 'error');
      });
      actions.appendChild(copyButton);
    }
    if (message && decision === 'SEND' && canSendFollowup()) {
      const sendButton = document.createElement('button');
      sendButton.type = 'button';
      sendButton.className = 'he-hommy-action send';
      sendButton.append(icon('fab fa-whatsapp'));
      const sendLabel = document.createElement('span');
      sendLabel.textContent = 'Revisar y enviar';
      sendButton.appendChild(sendLabel);
      sendButton.addEventListener('click', () => reviewAndSend(panel, numero, payload));
      actions.appendChild(sendButton);
    }
    result.appendChild(actions);'''
if "sendLabel.textContent = 'Revisar y enviar'" not in hommy:
    if action_anchor not in hommy:
        raise SystemExit('Could not find Hommy action block')
    hommy = hommy.replace(action_anchor, action_replacement, 1)

safe_old = "    safe.textContent = 'Modo REVIEW · Hommy no envió nada y no cambió datos de HomeEasy.';"
safe_new = "    safe.textContent = decision === 'SEND' && canSendFollowup()\n      ? 'Modo REVIEW · Hommy propone; tú revisas y autorizas cualquier envío.'\n      : 'Modo REVIEW · Hommy no envió nada y no cambió datos de HomeEasy.';"
if safe_old in hommy:
    hommy = hommy.replace(safe_old, safe_new, 1)

hommy_path.write_text(hommy, encoding='utf-8')
print('Seguimiento 10D review-send UI patch applied')
