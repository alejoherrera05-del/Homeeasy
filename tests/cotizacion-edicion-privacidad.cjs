'use strict';

// Prueba el código real de revisión con un DOM mínimo y almacenamiento ficticio.
// No usa red, navegador, credenciales ni cotizaciones de clientes reales.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const quote = fs.readFileSync(path.join(root, 'cotizacion.html'), 'utf8');
const start = quote.indexOf('    function normalizarVisibilidadCliente(value)');
const end = quote.indexOf('    let homeEasyPdfLibrariesPromise');
assert(start >= 0 && end > start, 'Rutinas de privacidad disponibles');
const code = quote.slice(start, end);
assert(code.includes('function revisarDescripcionesParaCliente()'),
  'Las descripciones editadas deben poder revisarse sin rehacer la cotización');

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.dataset = {};
    this.attributes = {}; this.listeners = {}; this.id = ''; this.className = '';
    this.value = ''; this.textContent = ''; this.open = false; this.validationMessage = '';
  }
  get isConnected() {
    return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected);
  }
  set innerHTML(_value) { throw new Error('La revisión debe insertar texto con textContent/value, no HTML'); }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type) {
    const event = {type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
    for (const callback of this.listeners[type] || []) callback(event);
    return event;
  }
  showModal() { this.open = true; }
  close() { const wasOpen = this.open; this.open = false; if (wasOpen) this.dispatch('close'); }
  focus() { this.ownerDocument.activeElement = this; }
  setCustomValidity(message) { this.validationMessage = message; }
  reportValidity() { return !this.validationMessage && (!this.required || Boolean(this.value)); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const descendants = [];
    const visit = node => node.children.forEach(child => { descendants.push(child); visit(child); });
    visit(this);
    return descendants.filter(node => {
      if (!node.matches(parts.at(-1))) return false;
      let parent = node.parentNode;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (parent && !parent.matches(parts[index])) parent = parent.parentNode;
        if (!parent) return false;
        parent = parent.parentNode;
      }
      return true;
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function mount(flags, items) {
  const document = {
    createElement(tag) { return new Element(tag, document); },
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
    getElementById(id) { return this.body.querySelector('#' + id); }
  };
  document.body = document.createElement('body');
  const tbody = document.createElement('tbody'); tbody.id = 'tabla-body'; document.body.appendChild(tbody);
  const alerts = [];
  const context = {document, alert: message => alerts.push(message), console};
  vm.createContext(context);
  vm.runInContext('let quoteClientVisibility=' + JSON.stringify(flags) + '; let isEditMode=true;\n' + code + `
    this.api={guardarDetallePublico,obtenerDetallePublico,descripcionParaCliente,revisarDescripcionesParaCliente,
      setFlags(value){quoteClientVisibility=normalizarVisibilidadCliente(value)},
      getFlags(){return quoteClientVisibility}};`, context, {filename: 'cotizacion-privacidad-real.js'});
  const api = context.api;
  function addRow(item) {
    const row = document.createElement('tr');
    for (const [className, value] of [['row-desc', item.descripcion], ['cant', item.cantidad], ['precio', item.precio]]) {
      const input = document.createElement('input'); input.className = className;
      input.value = String(value ?? ''); row.appendChild(input);
    }
    tbody.appendChild(row); api.guardarDetallePublico(row, item); return row;
  }
  const rows = items.map(addRow);
  return {api, document, rows, alerts, addRow,
    dialog: () => document.getElementById('quote-privacy-review'),
    inputs: () => document.querySelectorAll('.quote-privacy-input'),
    submit: () => document.getElementById('quote-privacy-form').dispatch('submit'),
    cancel: () => document.getElementById('quote-privacy-cancel').dispatch('click')};
}

const copy = value => JSON.parse(JSON.stringify(value));
const full = 'Sala QA · Enrollable · Tela QA original · 1,05 × 1,80 m';
const variants = {original: full, sinMedidas: 'Sala QA · Enrollable · Tela QA original',
  sinTelas: 'Sala QA · Enrollable · 1,05 × 1,80 m', sinAmbas: 'Sala QA · Enrollable'};
const item = {descripcion: full, cantidad: 2, precio: 150000, detallePublico: variants};
const privateFlags = {hideMeasures: true, hideUnitPrices: true, hideFabrics: true};
const fields = row => ['row-desc', 'cant', 'precio'].map(selector => row.querySelector('.' + selector).value);
const metadata = row => row.dataset.detallePublico;
async function settled(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La revisión no terminó')), 1000); })]); }
  finally { clearTimeout(timer); }
}

(async () => {
  const valid = mount(privateFlags, [copy(item)]);
  assert.equal(await settled(valid.api.revisarDescripcionesParaCliente()), true);
  assert.equal(valid.dialog(), null, 'Sin cambios no se agrega un paso');
  assert.equal(valid.api.descripcionParaCliente(valid.rows[0]), variants.sinAmbas);

  const edit = mount(privateFlags, [copy(item), copy(item)]);
  edit.rows[0].querySelector('.row-desc').value = 'Habitación QA 1 · Enrollable · Tela QA nueva · 1,10 × 1,90 m';
  edit.rows[1].querySelector('.row-desc').value = 'Habitación QA 2 · Enrollable · Tela QA gris · 1,20 × 1,50 m';
  const editableBefore = edit.rows.map(fields);
  const metadataBefore = edit.rows.map(metadata);
  let pending = edit.api.revisarDescripcionesParaCliente();
  assert(edit.dialog()?.open, 'La edición abre una revisión en el mismo formulario');
  assert.equal(edit.inputs().length, 2, 'Todas las líneas modificadas se revisan juntas');
  assert.deepEqual(edit.inputs().map(input => input.value), [variants.sinAmbas, variants.sinAmbas], 'La sugerencia es el texto público previo');
  assert.deepEqual(edit.rows.map(metadata), metadataBefore, 'Abrir no modifica metadatos');
  assert.throws(() => edit.api.descripcionParaCliente(edit.rows[0]), /Revisa/, 'No se publica texto interno antes de revisión');
  assert.equal(await settled(edit.api.revisarDescripcionesParaCliente()), false, 'Un doble clic no abre otro diálogo ni continúa otro guardado');
  assert.equal(edit.document.querySelectorAll('dialog').length, 1);
  edit.cancel();
  assert.equal(await settled(pending), false);
  assert.equal(edit.dialog(), null);
  assert.deepEqual(edit.rows.map(fields), editableBefore, 'Cancelar conserva edición, cantidades y precios');
  assert.deepEqual(edit.rows.map(metadata), metadataBefore, 'Cancelar no acepta variantes');

  pending = edit.api.revisarDescripcionesParaCliente();
  edit.inputs()[0].value = 'Habitación QA 1 · Enrollable';
  edit.inputs()[1].value = '   ';
  edit.submit();
  assert(edit.dialog()?.open, 'No acepta una descripción pública vacía');
  assert.deepEqual(edit.rows.map(metadata), metadataBefore, 'La validación es atómica para todas las líneas');
  edit.inputs()[1].value = 'Habitación QA 2 · Enrollable';
  edit.inputs()[1].dispatch('input');
  edit.submit();
  assert.equal(await settled(pending), true);
  assert.equal(edit.dialog(), null);
  assert.deepEqual(edit.rows.map(fields), editableBefore, 'Aceptar no altera datos internos ni importes');
  assert.deepEqual(copy(edit.api.getFlags()), privateFlags, 'No desactiva la privacidad para guardar');
  const approved = ['Habitación QA 1 · Enrollable', 'Habitación QA 2 · Enrollable'];
  edit.rows.forEach((row, index) => {
    assert.equal(edit.api.descripcionParaCliente(row), approved[index]);
    assert.deepEqual(copy(edit.api.obtenerDetallePublico(row)), {original: editableBefore[index][0], sinAmbas: approved[index]},
      'Las variantes anteriores se descartan cuando cambia el texto');
  });

  // Mismo contrato de persistencia que itemsJSON: texto interno y detallePublico.
  const saved = JSON.stringify(edit.rows.map(row => ({descripcion: row.querySelector('.row-desc').value,
    cantidad: Number(row.querySelector('.cant').value), precio: Number(row.querySelector('.precio').value),
    visibilidadCliente: copy(edit.api.getFlags()), detallePublico: copy(edit.api.obtenerDetallePublico(row))})));
  const restored = mount(privateFlags, JSON.parse(saved));
  assert.equal(await settled(restored.api.revisarDescripcionesParaCliente()), true, 'Recuperar y guardar otra vez no vuelve a bloquear');
  assert.deepEqual(restored.rows.map(fields), editableBefore, 'La recuperación conserva la descripción técnica completa');
  assert.deepEqual(restored.rows.map(row => restored.api.descripcionParaCliente(row)), approved);
  const order = fs.readFileSync(path.join(root, 'pedido.html'), 'utf8');
  assert(order.includes('tr.querySelector(".row-desc").value = item.descripcion || "";'), 'La orden carga la descripción completa, no la del PDF');

  restored.api.setFlags({hideMeasures: true, hideUnitPrices: true, hideFabrics: false});
  pending = restored.api.revisarDescripcionesParaCliente();
  assert(restored.dialog()?.open, 'Otra combinación de privacidad necesita su propia revisión');
  assert(restored.inputs().every(input => input.value === ''), 'No sugiere variantes obsoletas de la nueva combinación');
  restored.dialog().dispatch('cancel');
  assert.equal(await settled(pending), false, 'Escape cancela sin escribir');

  for (const condition of ['missing', 'corrupt', 'missing-key']) {
    const candidate = mount(privateFlags, [{...copy(item), detallePublico: condition === 'missing-key' ? {original: full} : undefined}]);
    if (condition === 'corrupt') candidate.rows[0].dataset.detallePublico = '{invalid';
    const before = fields(candidate.rows[0]);
    pending = candidate.api.revisarDescripcionesParaCliente();
    assert(candidate.dialog()?.open, condition + ': permite revisión en vez de exigir recotizar');
    assert.equal(candidate.inputs()[0].value, '', condition + ': no copia datos técnicos al texto público');
    candidate.inputs()[0].value = 'Sala QA · Enrollable'; candidate.submit();
    assert.equal(await settled(pending), true);
    assert.equal(candidate.api.descripcionParaCliente(candidate.rows[0]), 'Sala QA · Enrollable');
    assert.deepEqual(fields(candidate.rows[0]), before);
  }

  for (const race of ['description', 'flags', 'removed']) {
    const candidate = mount(privateFlags, [copy(item)]);
    candidate.rows[0].querySelector('.row-desc').value += ' · cambio';
    const beforeMetadata = metadata(candidate.rows[0]);
    pending = candidate.api.revisarDescripcionesParaCliente();
    candidate.inputs()[0].value = 'Sala QA · Enrollable revisada';
    if (race === 'description') candidate.rows[0].querySelector('.row-desc').value += ' posterior';
    if (race === 'flags') candidate.api.setFlags({hideMeasures: false, hideFabrics: true});
    if (race === 'removed') candidate.rows[0].remove();
    candidate.submit();
    assert.equal(await settled(pending), false, race + ': no acepta una revisión desactualizada');
    assert.equal(metadata(candidate.rows[0]), beforeMetadata);
    assert.equal(candidate.alerts.length, 1);
  }

  const ordinary = mount({hideMeasures: false, hideFabrics: false, hideUnitPrices: true}, [
    {descripcion: 'Línea manual QA con tela y 1,50 × 2,10 m', cantidad: 1, precio: 120000}
  ]);
  assert.equal(await settled(ordinary.api.revisarDescripcionesParaCliente()), true, 'Sin ocultamiento no impone revisión');
  assert.equal(ordinary.api.descripcionParaCliente(ordinary.rows[0]), fields(ordinary.rows[0])[0]);
  assert.equal(ordinary.dialog(), null);

  const finalize = quote.slice(quote.indexOf('async function finalizar()'));
  assert(finalize.indexOf('await revisarDescripcionesParaCliente()') >= 0 &&
    finalize.indexOf('await revisarDescripcionesParaCliente()') < finalize.indexOf('map(descripcionParaCliente)'),
  'El guardado debe esperar la revisión antes de preparar el PDF');
  console.log('PASS: edición privada, cancelar, doble clic, validar, confirmar, guardar/recuperar, variantes, metadata ausente y cambios durante revisión');
})().catch(error => { console.error(error); process.exitCode = 1; });
