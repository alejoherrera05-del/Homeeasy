/* Movimientos manuales de Caja: edición, eliminación recuperable e historial. */
(function (global) {
    'use strict';
    const originalRender = global.renderCaja;
    const originalLock = global.lockCaja;
    const container = document.getElementById('tx-container');
    if (!container || typeof originalRender !== 'function') return;
    let latest = null;
    let view = 'recientes';
    let query = '';
    let limit = 40;
    let busy = false;
    let toolbar;
    let countLabel;
    const canWrite = () => Boolean(global.HomeEasyAuth && global.HomeEasyAuth.hasPermission('caja.write'));
    const token = () => typeof cajaSessionToken === 'string' ? cajaSessionToken : '';
    const money = value => '$ ' + Number(value || 0).toLocaleString('es-CO');
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    function element(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }
    function buildToolbar() {
        if (toolbar) return;
        toolbar = element('div', 'caja-tools');
        const selectLabel = element('label', 'caja-tool-label', 'Ver movimientos');
        const select = element('select', 'caja-select');
        [['recientes', 'Recientes'], ['manuales', 'Gastos e ingresos manuales'], ['eliminados', 'Eliminados']].forEach(([value, text]) => {
            const option = element('option', '', text); option.value = value; select.append(option);
        });
        selectLabel.append(select);
        select.addEventListener('change', () => { view = select.value; limit = 40; paint(); });
        const searchLabel = element('label', 'caja-tool-label', 'Buscar movimiento');
        const search = element('input', 'caja-search'); search.type = 'search'; search.placeholder = 'Descripción, categoría o número';
        search.addEventListener('input', () => { query = search.value; limit = 40; paint(); });
        searchLabel.append(search);
        countLabel = element('p', 'caja-count'); countLabel.setAttribute('role', 'status');
        toolbar.append(selectLabel, searchLabel, countLabel);
        container.before(toolbar);
    }
    function filteredFeed() {
        const rows = view === 'recientes' ? latest.feed || [] : (latest.movimientosManuales || []).filter(tx => Boolean(tx.eliminado) === (view === 'eliminados'));
        const needle = normalize(query);
        return rows.filter(tx => !needle || normalize([tx.titulo, tx.cat, tx.descripcion, tx.id].join(' ')).includes(needle));
    }
    function paint() {
        if (!latest) return;
        const rows = filteredFeed();
        const visible = rows.slice(0, limit);
        originalRender({ ...latest, feed: visible });
        countLabel.textContent = rows.length ? `${Math.min(limit, rows.length)} de ${rows.length} movimientos` : 'No hay movimientos que coincidan.';
        if (!rows.length) container.replaceChildren(element('p', 'caja-empty', view === 'eliminados' ? 'No hay movimientos eliminados que coincidan.' : 'No hay movimientos que coincidan con la búsqueda.'));
        const items = container.querySelectorAll('.transaction-item');
        visible.forEach((tx, index) => {
            const row = items[index];
            if (!row || !tx.manual || !tx.revision) return;
            row.classList.add('caja-manual-row');
            if (tx.eliminado) {
                row.classList.add('caja-deleted-row');
                row.querySelector('.tx-date').textContent = 'Eliminado · no afecta el saldo';
            }
            if (!canWrite()) return;
            row.classList.add('caja-holdable');
            row.setAttribute('tabindex', '0');
            row.setAttribute('role', 'button');
            row.setAttribute('aria-label', `${tx.descripcion || tx.titulo}, ${money(tx.valor)}. Mantén presionado para ver opciones.`);
            installHoldMenu(row, tx);
        });
        if (rows.length > limit) {
            const more = element('button', 'caja-more', 'Mostrar más movimientos'); more.type = 'button';
            more.addEventListener('click', () => { limit += 40; paint(); }); container.append(more);
        }
    }
    function openActionMenu(tx, trigger) {
        if (busy || !canWrite()) return;
        if (navigator.vibrate) navigator.vibrate(12);
        const restore = Boolean(tx.eliminado);
        Swal.fire({
            title: tx.descripcion || tx.titulo || 'Movimiento',
            text: money(tx.valor),
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cerrar',
            customClass: { popup: 'swal2-premium caja-action-sheet' },
            didOpen: popup => {
                const actions = element('div', 'caja-action-sheet-buttons');
                const options = restore ? [['RESTAURAR','Restaurar']] : [['EDITAR','Editar'],['ELIMINAR','Eliminar']];
                options.forEach(([action,label]) => {
                    const button = element('button', action === 'ELIMINAR' ? 'caja-sheet-action caja-sheet-delete' : 'caja-sheet-action', label);
                    button.type = 'button';
                    button.addEventListener('click', () => {
                        Swal.close();
                        setTimeout(() => openCorrection(tx, action, trigger), 120);
                    });
                    actions.append(button);
                });
                popup.querySelector('.swal2-html-container').replaceChildren(actions);
            }
        });
    }
    function installHoldMenu(row, tx) {
        let timer = 0;
        let startX = 0, startY = 0;
        const cancel = () => { if (timer) clearTimeout(timer); timer = 0; row.classList.remove('is-holding'); };
        row.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            startX = event.clientX; startY = event.clientY;
            row.classList.add('is-holding');
            timer = setTimeout(() => { timer = 0; row.classList.remove('is-holding'); openActionMenu(tx, row); }, 520);
        });
        row.addEventListener('pointermove', event => {
            if (Math.hypot(event.clientX-startX,event.clientY-startY) > 10) cancel();
        });
        ['pointerup','pointercancel','pointerleave'].forEach(name => row.addEventListener(name, cancel));
        row.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); openActionMenu(tx, row); });
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openActionMenu(tx, row); }
        });
    }
    function installPullToRefresh() {
        let startY = 0, pulling = false, distance = 0, indicator = null;
        const ensureIndicator = () => {
            if (indicator) return indicator;
            indicator = element('div','caja-pull-indicator');
            indicator.innerHTML = '<i class="fas fa-arrow-down"></i><span>Desliza para actualizar</span>';
            document.body.prepend(indicator);
            return indicator;
        };
        document.addEventListener('touchstart', event => {
            if (window.scrollY > 2 || !event.touches || event.touches.length !== 1) return;
            startY = event.touches[0].clientY; distance = 0; pulling = true; ensureIndicator();
        }, {passive:true});
        document.addEventListener('touchmove', event => {
            if (!pulling || !event.touches || event.touches.length !== 1) return;
            distance = Math.max(0, event.touches[0].clientY - startY);
            const shown = Math.min(76, distance * .42);
            indicator.style.transform = `translate(-50%, ${shown - 58}px)`;
            indicator.classList.toggle('ready', distance >= 105);
            indicator.querySelector('span').textContent = distance >= 105 ? 'Suelta para actualizar' : 'Desliza para actualizar';
        }, {passive:true});
        document.addEventListener('touchend', async () => {
            if (!pulling) return;
            pulling = false;
            const refresh = distance >= 105;
            if (refresh) {
                indicator.classList.add('refreshing');
                indicator.querySelector('span').textContent = 'Actualizando…';
                indicator.querySelector('i').className = 'fas fa-sync-alt fa-spin';
                indicator.style.transform = 'translate(-50%, 12px)';
                try { await global.cargarCaja(); }
                finally { setTimeout(() => { indicator.style.transform = 'translate(-50%, -64px)'; indicator.classList.remove('ready','refreshing'); }, 300); }
            } else {
                indicator.style.transform = 'translate(-50%, -64px)';
                indicator.classList.remove('ready');
            }
            distance = 0;
        }, {passive:true});
    }
    installPullToRefresh();
    function editForm() {
        return '<div class="caja-correction-form">' +
            '<label for="caja-edit-type">Tipo de movimiento</label><select id="caja-edit-type"><option value="GASTO">Gasto</option><option value="INGRESO">Ingreso extra</option></select>' +
            '<label for="caja-edit-value">Valor en pesos</label><input id="caja-edit-value" inputmode="numeric" autocomplete="off">' +
            '<label for="caja-edit-category">Categoría</label><input id="caja-edit-category" maxlength="120">' +
            '<label for="caja-edit-description">Descripción</label><input id="caja-edit-description" maxlength="250">' +
            '<label for="caja-edit-reason">Motivo de la corrección</label><input id="caja-edit-reason" maxlength="300" placeholder="Ej.: digitación incorrecta del valor"></div>';
    }
    async function openCorrection(tx, action, trigger) {
        if (busy || !token() || !canWrite()) return;
        const edit = action === 'EDITAR';
        const remove = action === 'ELIMINAR';
        let requestId = '';
        let lastSignature = '';
        let confirmed = false;
        const labels = { EDITAR: 'Guardar cambios', ELIMINAR: 'Eliminar movimiento', RESTAURAR: 'Restaurar movimiento' };
        const result = await Swal.fire({
            title: edit ? 'Editar movimiento' : labels[action],
            html: edit ? editForm() : '<p id="caja-correction-summary" class="caja-correction-summary"></p><p class="caja-correction-help">' +
                (remove ? 'Dejará de contar en el saldo. Puedes recuperarlo desde Eliminados.' : 'Volverá a contar en el saldo con su valor y fecha originales.') +
                '</p><div class="caja-correction-form"><label for="caja-edit-reason">Motivo</label><input id="caja-edit-reason" maxlength="300" placeholder="Explica brevemente el cambio"></div>',
            showCancelButton: true, confirmButtonText: labels[action], cancelButtonText: 'Cancelar',
            confirmButtonColor: remove ? '#bd332b' : '#a6455a', showLoaderOnConfirm: true,
            allowOutsideClick: () => !Swal.isLoading(), allowEscapeKey: () => !Swal.isLoading(),
            customClass: { popup: 'swal2-premium caja-correction-dialog' },
            didOpen: () => {
                if (edit) {
                    document.getElementById('caja-edit-type').value = tx.movimiento;
                    document.getElementById('caja-edit-value').value = Number(tx.valor).toLocaleString('es-CO');
                    document.getElementById('caja-edit-category').value = tx.categoria;
                    document.getElementById('caja-edit-description').value = tx.descripcion;
                    document.getElementById('caja-edit-value').focus();
                } else {
                    document.getElementById('caja-correction-summary').textContent = `${tx.descripcion || tx.titulo} · ${money(tx.valor)}`;
                    document.getElementById('caja-edit-reason').focus();
                }
            },
            preConfirm: async () => {
                if (busy) return false;
                const motivo = document.getElementById('caja-edit-reason').value.trim();
                if (motivo.length < 3) { Swal.showValidationMessage('Escribe un motivo de al menos 3 caracteres.'); return false; }
                const payload = { tipo: 'movimiento_caja', accionCaja: action, id: tx.cajaId, expectedRevision: tx.revision, motivo };
                if (edit) {
                    const raw = document.getElementById('caja-edit-value').value.trim();
                    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(raw)) { Swal.showValidationMessage('Escribe pesos enteros, por ejemplo 25000 o 25.000.'); return false; }
                    Object.assign(payload, {
                        valor: Number(raw.replace(/\./g, '')),
                        movimiento: document.getElementById('caja-edit-type').value,
                        categoria: document.getElementById('caja-edit-category').value.trim(),
                        descripcion: document.getElementById('caja-edit-description').value.trim()
                    });
                    if (!Number.isSafeInteger(payload.valor) || payload.valor <= 0 || !payload.categoria || !payload.descripcion) {
                        Swal.showValidationMessage('Completa categoría, descripción y un valor mayor que cero.'); return false;
                    }
                }
                const signature = JSON.stringify(payload);
                if (signature !== lastSignature) { requestId = HomeEasyCore.createRequestId(); lastSignature = signature; }
                busy = true;
                try {
                    if (!token() || !canWrite()) throw new Error('Tu sesión o permiso cambió. Cierra este formulario y vuelve a entrar a Caja.');
                    const response = await HomeEasyCore.post({ ...payload, requestId, cajaSessionToken: token() }, { timeoutMs: 45000 });
                    if (!response || response.status !== 'success') throw new Error(response && response.msg || 'No se pudo confirmar el cambio. Puedes reintentar sin duplicarlo.');
                    confirmed = true; return response;
                } catch (error) {
                    Swal.showValidationMessage(error.message || 'Conexión interrumpida. Tus cambios siguen en el formulario.'); return false;
                } finally { busy = false; }
            }
        });
        if (result.isConfirmed && confirmed) {
            await global.cargarCaja();
            Swal.fire({ toast: true, position: 'bottom', icon: 'success', title: { EDITAR: 'Movimiento corregido', ELIMINAR: 'Movimiento eliminado', RESTAURAR: 'Movimiento restaurado' }[action], timer: 2500, showConfirmButton: false });
        } else if (trigger && trigger.isConnected) trigger.focus();
    }
    global.renderCaja = function (data) {
        if (data.correccionesCajaVersion !== 1) { latest = null; if (toolbar) toolbar.hidden = true; originalRender(data); return; }
        latest = data; buildToolbar(); toolbar.hidden = false; paint();
    };
    global.lockCaja = async function () {
        latest = null; query = ''; view = 'recientes'; limit = 40;
        if (toolbar) { toolbar.remove(); toolbar = null; }
        return originalLock.apply(this, arguments);
    };
})(window);
