from pathlib import Path

p = Path('seguimiento.html')
s = p.read_text(encoding='utf-8')
if 'seguimiento-mobile-ux-v3' in s:
    raise SystemExit('v3 already applied')

old_filters = '''        <section class="filters-card">
            <div class="filters-head">
                <div class="filters-title">
                    <i class="far fa-calendar"></i>
                    <div><strong>Periodo</strong><span>Acota el radar por fecha de cotización.</span></div>
                </div>
                <button type="button" class="btn-reset" onclick="restablecerFiltros()"><i class="fas fa-arrow-rotate-left"></i> Este mes</button>
            </div>
            <div class="filters-grid">
                <div class="filter-group">
                    <label for="fecha-desde">Desde</label>
                    <input type="date" id="fecha-desde" class="filter-input">
                </div>
                <div class="filter-group">
                    <label for="fecha-hasta">Hasta</label>
                    <input type="date" id="fecha-hasta" class="filter-input">
                </div>
                <button type="button" class="btn-filter" onclick="aplicarFiltros()"><i class="fas fa-filter"></i><span>Aplicar filtro</span></button>
            </div>
        </section>'''
new_filters = '''        <section class="filters-card" id="filtersCard">
            <button type="button" class="period-summary" id="periodSummary" onclick="toggleFiltrosMovil()" aria-expanded="false">
                <span class="period-summary-main"><i class="far fa-calendar"></i><span><strong id="periodMobileLabel">Este mes</strong><small id="periodMobileRange">Periodo actual</small></span></span>
                <i class="fas fa-chevron-down period-summary-chevron"></i>
            </button>
            <div class="filters-panel" id="filtersPanel">
                <div class="filters-head">
                    <div class="filters-title">
                        <i class="far fa-calendar"></i>
                        <div><strong>Periodo</strong><span>Acota el radar por fecha de cotización.</span></div>
                    </div>
                    <button type="button" class="btn-reset" onclick="restablecerFiltros()"><i class="fas fa-arrow-rotate-left"></i> Este mes</button>
                </div>
                <div class="filters-grid">
                    <div class="filter-group">
                        <label for="fecha-desde">Desde</label>
                        <input type="date" id="fecha-desde" class="filter-input">
                    </div>
                    <div class="filter-group">
                        <label for="fecha-hasta">Hasta</label>
                        <input type="date" id="fecha-hasta" class="filter-input">
                    </div>
                    <button type="button" class="btn-filter" onclick="aplicarFiltros()"><i class="fas fa-filter"></i><span>Aplicar filtro</span></button>
                </div>
            </div>
        </section>'''
if old_filters not in s:
    raise SystemExit('filters marker missing')
s = s.replace(old_filters, new_filters, 1)

old_actions = '''                    <div class="card-actions">
                        <button type="button" class="btn-crm btn-note" onclick="abrirModalNota('${cot.numero}', \\`${cot.notas_seguimiento || ''}\\`)"><i class="fas fa-note-sticky"></i><span>Nota</span></button>
                        <button type="button" class="btn-crm btn-archive" onclick="archivarCotizacion('${cot.numero}', '${cot.nombre}')"><i class="fas fa-box-archive"></i><span>Archivar</span></button>
                        <button type="button" class="btn-crm btn-view" onclick="abrirVisorPDF('${urlSegura}')"><i class="fas fa-eye"></i><span>Ver</span></button>
                    </div>'''
new_actions = '''                    <div class="card-actions">
                        <button type="button" class="btn-crm btn-view" onclick="abrirVisorPDF('${urlSegura}')"><i class="fas fa-eye"></i><span>Ver cotización</span></button>
                        <button type="button" class="btn-crm btn-note" onclick="abrirModalNota('${cot.numero}', \\`${cot.notas_seguimiento || ''}\\`)"><i class="fas fa-note-sticky"></i><span>Nota</span></button>
                        <button type="button" class="btn-crm btn-archive" onclick="archivarCotizacion('${cot.numero}', '${cot.nombre}')"><i class="fas fa-box-archive"></i><span>Archivar</span></button>
                    </div>'''
if old_actions not in s:
    raise SystemExit('actions marker missing')
s = s.replace(old_actions, new_actions, 1)

css = r'''
    <style id="seguimiento-mobile-ux-v3">
        .period-summary { display: none; }
        .filters-panel { display: block; }
        .card-actions { grid-template-columns: 1.35fr 1fr .9fr; }
        .btn-archive { background: #fff; border: 1px solid rgba(184,78,92,.18); box-shadow: none; }

        @media (max-width: 760px) {
            .page-shell { padding-top: 13px; }
            .hero { margin-bottom: 10px; }
            .hero-eyebrow, .hero p, .age-legend { display: none !important; }
            .hero h1 { margin: 0; font-size: 25px; line-height: 1.05; letter-spacing: -.9px; }

            .summary-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0,1fr));
                gap: 0;
                margin-bottom: 10px;
                background: #fff;
                border: 1px solid rgba(60,60,67,.065);
                border-radius: 19px;
                box-shadow: 0 10px 30px rgba(48,35,40,.045);
                overflow: hidden;
            }
            .summary-card {
                min-height: 76px;
                padding: 13px 14px;
                display: block;
                text-align: center;
                border: 0;
                border-radius: 0;
                box-shadow: none;
                background: transparent;
            }
            .summary-card + .summary-card { border-left: 1px solid var(--line); }
            .summary-card::after, .summary-icon, .summary-note { display: none; }
            .summary-value { margin-top: 0; font-size: 26px; line-height: 1; letter-spacing: -.8px; }
            .summary-label { margin-top: 6px; font-size: 12.5px; line-height: 1.1; white-space: nowrap; }
            .amount-card .summary-value { color: var(--gold-dark); }

            .filters-card {
                margin-bottom: 11px;
                padding: 0;
                border-radius: 18px;
                overflow: hidden;
                box-shadow: 0 8px 26px rgba(48,35,40,.04);
            }
            .period-summary {
                width: 100%;
                min-height: 58px;
                padding: 9px 14px;
                border: 0;
                background: #fff;
                color: var(--ink);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                text-align: left;
            }
            .period-summary-main { display: flex; align-items: center; gap: 11px; min-width: 0; }
            .period-summary-main > i { width: 34px; height: 34px; border-radius: 11px; background: var(--brand-soft); color: var(--brand); display: grid; place-items: center; flex: 0 0 auto; }
            .period-summary-main span { min-width: 0; }
            .period-summary-main strong { display: block; color: #514B4F; font-size: 14px; line-height: 1.05; font-weight: 700; }
            .period-summary-main small { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1; font-weight: 560; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .period-summary-chevron { color: var(--brand); font-size: 12px; transition: transform .18s ease; }
            .filters-card.open .period-summary-chevron { transform: rotate(180deg); }
            .filters-panel { display: none; padding: 14px; border-top: 1px solid var(--line); background: #fff; }
            .filters-card.open .filters-panel { display: block; }
            .filters-head { margin-bottom: 12px; }
            .filters-title span { display: none; }
            .filters-title strong { font-size: 14px; }
            .btn-reset { height: 34px; padding: 0 10px; font-size: 12px; }
            .filters-grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
            .filter-input { height: 43px; font-size: 13.5px; }
            .btn-filter { grid-column: 1/-1; height: 43px; }

            .cards-container { gap: 10px; }
            .card-header-crm { padding-top: 17px; }
            .card-body-crm { padding-bottom: 13px; }
            .note-box { margin-top: 13px; }
            .card-actions { grid-template-columns: 1.45fr .85fr .75fr; padding: 9px 10px 10px; gap: 6px; }
            .btn-crm { height: 43px; padding: 0 8px; font-size: 12px; }
            .btn-archive { background: #fff; }
        }

        @media (max-width: 380px) {
            .hero h1 { font-size: 23px; }
            .summary-card { padding-inline: 10px; }
            .summary-value { font-size: 24px; }
            .summary-label { font-size: 11.8px; }
            .card-actions { grid-template-columns: 1.35fr .82fr .72fr; }
            .btn-crm { font-size: 11.5px; padding: 0 6px; gap: 5px; }
        }
    </style>
'''
s = s.replace('    <script src="homeeasy-core.js?v=3.5"></script>', css + '    <script src="homeeasy-core.js?v=3.5"></script>', 1)

js_helpers = r'''
        function toggleFiltrosMovil() {
            if (window.innerWidth > 760) return;
            const card = document.getElementById('filtersCard');
            const button = document.getElementById('periodSummary');
            const open = card.classList.toggle('open');
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function formatearFechaCorta(value) {
            if (!value) return '';
            const d = new Date(value + 'T12:00:00');
            const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            return `${d.getDate()} ${meses[d.getMonth()]}`;
        }

        function actualizarResumenPeriodo() {
            const desde = document.getElementById('fecha-desde').value;
            const hasta = document.getElementById('fecha-hasta').value;
            const label = document.getElementById('periodMobileLabel');
            const range = document.getElementById('periodMobileRange');
            if (!label || !range) return;
            const hoy = new Date();
            const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
            const hoyIso = hoy.toISOString().split('T')[0];
            label.textContent = desde === primerDia && hasta === hoyIso ? 'Este mes' : 'Periodo personalizado';
            range.textContent = desde && hasta ? `${formatearFechaCorta(desde)} – ${formatearFechaCorta(hasta)}` : 'Selecciona un periodo';
        }
'''
s = s.replace('        function establecerFechasPorDefecto() {', js_helpers + '\n        function establecerFechasPorDefecto() {', 1)
s = s.replace("            document.getElementById('fecha-desde').value = primerDiaMes.toISOString().split('T')[0];\n        }", "            document.getElementById('fecha-desde').value = primerDiaMes.toISOString().split('T')[0];\n            actualizarResumenPeriodo();\n        }", 1)
s = s.replace('            renderizarTarjetas(filtradas);\n        }', "            renderizarTarjetas(filtradas);\n            actualizarResumenPeriodo();\n            if (window.innerWidth <= 760) {\n                const card = document.getElementById('filtersCard');\n                const button = document.getElementById('periodSummary');\n                if (card && button) { card.classList.remove('open'); button.setAttribute('aria-expanded','false'); }\n            }\n        }", 1)

p.write_text(s, encoding='utf-8')
print('seguimiento v3 patch applied')
