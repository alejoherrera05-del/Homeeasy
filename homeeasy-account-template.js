/**
 * HomeEasy Cuenta de Cobro Template v1.0
 * Única fuente visual para Documentos y Configuración.
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'homeeasy-account-template-style';
  const VERSION = '1.0.0';

  function safe(value) {
    return String(value === undefined || value === null ? '' : value);
  }

  function esc(value) {
    return safe(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function id(prefix, base) {
    if (!prefix) return base;
    return prefix + base.charAt(0).toUpperCase() + base.slice(1);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .hecc-paper{width:816px;height:1056px;background:#fff;position:relative;overflow:hidden;color:#1c1c1e;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI Variable","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;letter-spacing:-.012em}
      .hecc-shape{position:absolute;left:0;top:0;width:300px;height:130px;background:#f5e5e9;border-bottom-right-radius:110px;border-bottom:2px solid #c2a468}
      .hecc-head{position:relative;z-index:2;padding:36px 44px 0;display:flex;justify-content:space-between;gap:24px}
      .hecc-head img{width:116px;height:116px;object-fit:contain;flex:0 0 auto}
      .hecc-company{text-align:right;font-size:12px;line-height:1.55;color:#5e555a;max-width:430px}
      .hecc-company strong{display:block;color:#a6455a;font-size:17px;margin-bottom:5px}
      .hecc-title{text-align:center;margin-top:26px;color:#a6455a;font-size:28px;font-weight:700;letter-spacing:1.5px}
      .hecc-divider{width:135px;height:2px;background:#c2a468;margin:10px auto}
      .hecc-meta{margin:7px 46px 0;padding:12px 15px;border-radius:13px;background:#faf7f8;display:flex;align-items:center;justify-content:space-between;gap:18px;font-size:12px;color:#4e484b}
      .hecc-number span{display:block;color:#8a8085;font-size:9px;text-transform:uppercase;font-weight:700;letter-spacing:.55px}
      .hecc-number strong{display:block;margin-top:3px;color:#a6455a;font-size:14px}
      .hecc-body{padding:18px 46px 0}
      .hecc-section{margin-bottom:20px}
      .hecc-kicker{display:flex;align-items:center;gap:9px;color:#a6455a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px}
      .hecc-kicker i{width:28px;height:28px;border-radius:50%;background:#a6455a;color:#fff;display:flex;align-items:center;justify-content:center}
      .hecc-client{font-size:18px;font-weight:700;margin-left:37px}
      .hecc-client-meta,.hecc-concept{margin-left:37px;color:#736b70;font-size:11px;line-height:1.5}
      .hecc-concept{font-size:13px;color:#4e484b;white-space:pre-wrap}
      .hecc-amount{margin:21px 0;background:#fbf1f4;border:1px solid rgba(166,69,90,.20);border-radius:20px;padding:19px 23px;display:flex;align-items:center;justify-content:space-between;gap:18px}
      .hecc-amount-left{display:flex;align-items:center;gap:13px}
      .hecc-amount-icon{width:45px;height:45px;border-radius:50%;background:#a6455a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700}
      .hecc-amount-label{font-size:10px;color:#736b70;text-transform:uppercase;font-weight:700}
      .hecc-amount-words{margin-top:5px;font-size:10px;color:#786e73;max-width:390px;line-height:1.35}
      .hecc-amount-value{color:#a6455a;font-size:28px;font-weight:700;white-space:nowrap}
      .hecc-closing{font-size:11px;color:#6c6267;line-height:1.5}
      .hecc-bottom{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:26px}
      .hecc-pay{border-right:1px solid #ead9de;padding-right:24px}
      .hecc-pay-title{color:#a6455a;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:11px}
      .hecc-pay-line{font-size:11px;line-height:1.75}
      .hecc-signature{padding-left:4px;font-size:11px;color:#6c6267}
      .hecc-signature-script{height:64px;display:flex;align-items:center;font-family:"Snell Roundhand","Segoe Script","Brush Script MT",cursive;font-size:34px;color:#292529;transform:rotate(-2deg)}
      .hecc-signature-line{height:1px;background:#d6a8b4;width:230px;margin-bottom:7px}
      .hecc-signature-name{font-size:11px;font-weight:700;color:#a6455a}
      .hecc-signature-role{font-size:10px;color:#665d62;margin-top:3px;line-height:1.4}
      .hecc-footer{position:absolute;left:0;right:0;bottom:0;height:94px;background:#f8edf0;border-top:2px solid #c2a468;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 30px}
      .hecc-footer strong{color:#a6455a;font-size:11px}
      .hecc-footer span{margin-top:4px;color:#746b70;font-size:9px}
    `;
    document.head.appendChild(style);
  }

  function markup(prefix) {
    const I = base => id(prefix, base);
    return `
      <article class="hecc-paper" id="${I('pdfSheet')}">
        <div class="hecc-shape"></div>
        <div class="hecc-head">
          <img src="logohomeeasy.png" alt="HomeEasy" onerror="this.src='triangulogold.png'">
          <div class="hecc-company" id="${I('pdfCompany')}"><strong>HOMEEASY POPAYÁN</strong><div>NIT: 1.061.760.852-1</div><div>Trav. 9 # 6N-26 · Popayán</div><div>3334319374 · @homeeasypopayan</div></div>
        </div>
        <div class="hecc-title">CUENTA DE COBRO</div><div class="hecc-divider"></div>
        <div class="hecc-meta"><div class="hecc-number"><span>Cuenta de cobro N.°</span><strong id="${I('pdfNumber')}">CC-2026-001</strong></div><div id="${I('pdfDate')}">Popayán, fecha</div></div>
        <div class="hecc-body">
          <div class="hecc-section"><div class="hecc-kicker"><i class="fa-solid fa-user"></i> Cobrar a</div><div class="hecc-client" id="${I('pdfClient')}">CLIENTE</div><div class="hecc-client-meta" id="${I('pdfClientMeta')}">Identificación</div></div>
          <div class="hecc-section"><div class="hecc-kicker"><i class="fa-solid fa-file-lines"></i> Concepto</div><div class="hecc-concept" id="${I('pdfConcept')}">Concepto de la cuenta de cobro.</div></div>
          <div class="hecc-amount"><div class="hecc-amount-left"><div class="hecc-amount-icon">$</div><div><div class="hecc-amount-label">Valor a pagar</div><div class="hecc-amount-words" id="${I('pdfWords')}">CERO PESOS M/CTE</div></div></div><div class="hecc-amount-value" id="${I('pdfAmount')}">$ 0</div></div>
          <div class="hecc-closing" id="${I('pdfClosing')}">Agradecemos realizar el pago a la cuenta bancaria indicada. Quedamos atentos a la confirmación del pago.</div>
          <div class="hecc-bottom"><div class="hecc-pay"><div class="hecc-pay-title">Información para pago</div><div class="hecc-pay-line"><b>Banco:</b> <span id="${I('pdfBank')}">Davivienda</span><br><b>Tipo de cuenta:</b> <span id="${I('pdfAccountType')}">Ahorros</span><br><b>Número de cuenta:</b> <span id="${I('pdfAccount')}">488412522523</span><br><b>Titular:</b> <span id="${I('pdfHolder')}">Daniela Torres García</span><br><b>CC:</b> <span id="${I('pdfHolderDoc')}">1061760852</span></div></div><div class="hecc-signature"><div>Atentamente,</div><div class="hecc-signature-script" id="${I('pdfSignature')}">Daniela Torres García</div><div class="hecc-signature-line"></div><div class="hecc-signature-name" id="${I('pdfSigner')}">Daniela Torres García</div><div class="hecc-signature-role" id="${I('pdfRole')}">Titular de HomeEasy · Persona natural comerciante</div></div></div>
        </div>
        <footer class="hecc-footer"><strong id="${I('pdfFooterMain')}">HOMEEASY · VISTE TU HOGAR CON ESTILO</strong><span id="${I('pdfFooterSystem')}">Persianas &amp; Papel Tapiz · Sistema Hommy</span></footer>
      </article>`;
  }

  function mount(container, options) {
    if (!container) throw new Error('No se encontró el contenedor de Cuenta de cobro.');
    ensureStyles();
    const prefix = options && options.prefix ? String(options.prefix) : '';
    container.innerHTML = markup(prefix);
    return document.getElementById(id(prefix, 'pdfSheet'));
  }

  function setText(prefix, base, value) {
    const el = document.getElementById(id(prefix, base));
    if (el) el.textContent = safe(value);
  }

  function companyHtml(company) {
    const c = company || {};
    const name = safe(c.nombreComercial || c.nombre || 'HOMEEASY POPAYÁN').toUpperCase();
    const nit = safe(c.nit || '1.061.760.852-1');
    const address = safe(c.direccion || 'Trav. 9 # 6N-26');
    const city = safe(c.ciudad || 'Popayán');
    const phone = safe(c.telefono || '3334319374');
    const instagram = safe(c.instagram || '@homeeasypopayan');
    const contact = [phone, instagram].filter(Boolean).join(' · ');
    return '<strong>' + esc(name) + '</strong>' +
      (nit ? '<div>NIT: ' + esc(nit) + '</div>' : '') +
      ([address, city].filter(Boolean).length ? '<div>' + esc([address, city].filter(Boolean).join(' · ')) + '</div>' : '') +
      (contact ? '<div>' + esc(contact) + '</div>' : '');
  }

  function update(prefix, data) {
    const d = data || {};
    const company = document.getElementById(id(prefix, 'pdfCompany'));
    if (company) company.innerHTML = companyHtml(d.empresa || d.company || {});
    setText(prefix, 'pdfNumber', d.numero || 'CC-2026-001');
    setText(prefix, 'pdfDate', d.fecha || 'Popayán, fecha');
    setText(prefix, 'pdfClient', safe(d.cliente || 'CLIENTE').toUpperCase());
    setText(prefix, 'pdfClientMeta', d.identificacion || 'Identificación: —');
    setText(prefix, 'pdfConcept', d.concepto || 'Concepto de la cuenta de cobro.');
    setText(prefix, 'pdfAmount', d.valorTexto || '$ 0');
    setText(prefix, 'pdfWords', d.valorLetras || 'CERO PESOS M/CTE');
    setText(prefix, 'pdfClosing', d.textoCierre || 'Agradecemos realizar el pago a la cuenta bancaria indicada. Quedamos atentos a la confirmación del pago.');
    const bank = d.banco || {};
    const rep = d.representante || {};
    const signature = d.firma || {};
    setText(prefix, 'pdfBank', bank.nombre || 'Davivienda');
    setText(prefix, 'pdfAccountType', bank.tipoCuenta || bank.tipo_cuenta || 'Ahorros');
    setText(prefix, 'pdfAccount', bank.numeroCuenta || bank.numero_cuenta || '488412522523');
    setText(prefix, 'pdfHolder', bank.titular || rep.nombre || 'Daniela Torres García');
    setText(prefix, 'pdfHolderDoc', bank.ccTitular || bank.cc_titular || rep.documento || '1061760852');
    setText(prefix, 'pdfSignature', signature.texto || rep.nombre || 'Daniela Torres García');
    setText(prefix, 'pdfSigner', rep.nombre || signature.texto || 'Daniela Torres García');
    setText(prefix, 'pdfRole', signature.cargoDocumento || signature.cargo_documento || rep.cargoDocumento || rep.calidad || 'Titular de HomeEasy · Persona natural comerciante');
    setText(prefix, 'pdfFooterMain', d.footerPrincipal || 'HOMEEASY · VISTE TU HOGAR CON ESTILO');
    setText(prefix, 'pdfFooterSystem', d.footerSistema || 'Persianas & Papel Tapiz · Sistema Hommy');
  }

  function fit(stage, scaleElement) {
    if (!stage || !scaleElement) return 1;
    const scale = Math.min(1, Math.max(270, stage.clientWidth - 20) / 816);
    scaleElement.style.transform = 'scale(' + scale + ')';
    scaleElement.style.height = (1056 * scale) + 'px';
    return scale;
  }

  global.HomeEasyAccountTemplate = Object.freeze({ VERSION, mount, update, fit, id });
})(window);
