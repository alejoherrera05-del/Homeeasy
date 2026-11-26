'use strict';

// Execute the actual account-generation functions with fake transport/PDF data.
// No browser, network, credentials, or real customer records are used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = process.env.HOMEEASY_QA_ROOT || path.resolve(__dirname, '..');
const sourcePath = process.env.HOMEEASY_QA_SOURCE || path.join(root, 'documentos.html');
const source = fs.readFileSync(sourcePath, 'utf8');

// Find the first syntactically complete expression, without evaluating it.
// This works when the source functions are reformatted across multiple lines.
function completeExpression(start, delimiter, label) {
  for (let end = source.indexOf(delimiter, start); end >= 0; end = source.indexOf(delimiter, end + 1)) {
    const candidate = source.slice(start, end + (delimiter === '}' ? 1 : 0));
    try {
      new vm.Script('(' + candidate + ')');
      return candidate;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error('Could not extract ' + label);
}

function actualFunction(name) {
  const match = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(source);
  assert(match, 'Missing function ' + name);
  return completeExpression(match.index, '}', name);
}

const parseMatch = /\bconst\s+parseCop\s*=\s*/.exec(source);
assert(parseMatch, 'Missing COP parser');
const parseExpression = completeExpression(parseMatch.index + parseMatch[0].length, ';', 'parseCop');
const names = ['numberWords', 'validateBilling', 'renderPdfBlob', 'generateAccount', 'refreshDataAfterWrite'];
const actualCode = 'const parseCop=' + parseExpression + ';\n' + names.map(actualFunction).join('\n') +
  '\nthis.api={parseCop,' + names.join(',') + '};';

function fixture(options = {}) {
  const elements = Object.fromEntries(Object.entries({
    clientInput: 'CLIENTE FICTICIO QA', docInput: 'QA-123',
    conceptInput: 'Concepto ficticio QA', amountInput: '2.900.000', notesInput: ''
  }).map(([id, value]) => [id, {value}]));
  for (const id of ['generateBtn', 'downloadBtn', 'shareBtn']) elements[id] = {disabled: id !== 'generateBtn'};
  elements.pdfSheet = {id: 'pdfSheet'};
  elements.paperScale = {style: {transform: 'scale(0.5)', height: '528px'}};
  const exportScale = {style: {...elements.paperScale.style}};
  const state = {
    mode: options.mode || 'MANUAL',
    loadedOp: options.mode === 'OP' ? {numeroOp: '501', total: 4000000, saldo: 2900000} : null,
    center: {}, accounts: [], packages: [], prepared: null, lastAccountBlob: null
  };
  const events = {posts: [], alerts: [], toasts: [], downloads: [], warnings: [], previews: [], pdfCalls: 0, shown: 0, hidden: 0};
  let requestCounter = 0;
  const context = {
    Date, Intl, Number, String, Math, Promise, Error, Set,
    console: {warn: (...args) => events.warnings.push(args)},
    state, $: id => elements[id], meta: () => ({pagina: 'documentos.html'}),
    uuid: () => 'qa-request-' + (++requestCounter),
    showLoading: () => events.shown++, hideLoading: () => events.hidden++,
    toast: message => events.toasts.push(message), alert: message => events.alerts.push(message),
    refreshPreview: () => events.previews.push({saved: Boolean(state.lastAccountBlob), id: state.lastAccountId}),
    renderOfficial() {}, renderHistory() {}, renderPackageAccounts() {},
    renderPackageChecklist() {}, renderPackageHistory() {}, buildDefaultMessages() {}, setTab() {},
    downloadBlob: (blob, name) => events.downloads.push({blob, name}),
    setTimeout: callback => { callback(); return 1; },
    html2canvas: options.missingPdf ? undefined : async (element, settings) => {
      events.pdfCalls++;
      assert.equal(element, elements.pdfSheet);
      if (settings.onclone) settings.onclone({getElementById: id => id === 'paperScale' ? exportScale : null});
      if (options.renderError) throw new Error('PDF_QA_FAILED');
      return {toDataURL: () => 'data:image/jpeg;base64,QA'};
    },
    window: {jspdf: options.missingPdf ? undefined : {jsPDF: class {
      addImage() {}
      output(type) {
        return type === 'blob' ? {type: 'application/pdf', fixture: true} : 'data:application/pdf;base64,JVBERi1RQQ==';
      }
    }}},
    post: async payload => {
      events.posts.push(payload);
      if (payload.tipo === 'PREPARAR_CUENTA_COBRO') {
        return options.prepareError ? {status: 'error', msg: 'PREPARE_QA_FAILED'} : {status: 'ok', numeroCuenta: 'CC-QA-001'};
      }
      if (payload.tipo === 'GUARDAR_CUENTA_COBRO') {
        if (options.saveError) return {status: 'error', msg: 'SAVE_QA_FAILED'};
        if (options.numberChanged) return {status: 'number_changed', numeroCuenta: 'CC-QA-002'};
        return {status: 'success', numeroCuenta: 'CC-QA-001', idCuenta: 'QA-1', nombreArchivo: 'Cuenta_QA.pdf'};
      }
      if (payload.tipo === options.refreshError) throw new Error('REFRESH_QA_FAILED');
      if (payload.tipo === 'GET_DOCUMENTOS_SEGURA') return {status: 'ok', documentos: []};
      if (payload.tipo === 'LISTAR_CUENTAS_COBRO') return {status: 'ok', cuentas: []};
      if (payload.tipo === 'LISTAR_PAQUETES_DOCUMENTALES') return {status: 'ok', paquetes: []};
      throw new Error('Unexpected local operation ' + payload.tipo);
    }
  };
  vm.runInNewContext(actualCode, context, {filename: 'documentos-functions.js'});
  return {api: context.api, state, events, elements, exportScale};
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

(async () => {
  await test('COP amount and words preserve the requested amount', () => {
    const {api} = fixture();
    for (const value of ['2.900.000', '$ 2.900.000', 2900000]) assert.equal(api.parseCop(value), 2900000);
    for (const [number, words] of [
      [0, 'CERO PESOS M/CTE'], [1, 'UN PESO M/CTE'], [1000, 'MIL PESOS M/CTE'],
      [1000000, 'UN MILLÓN DE PESOS M/CTE'], [2900000, 'DOS MILLONES NOVECIENTOS MIL PESOS M/CTE']
    ]) assert.equal(api.numberWords(number), words);
  });

  await test('Missing OP or required fields never reach the backend', async () => {
    const op = fixture(); op.state.mode = 'OP'; await op.api.generateAccount();
    assert.equal(op.events.posts.length, 0); assert.match(op.events.toasts[0], /Consulta y carga/);
    for (const field of ['clientInput', 'docInput', 'conceptInput', 'amountInput']) {
      const f = fixture(); f.elements[field].value = ''; await f.api.generateAccount();
      assert.equal(f.events.posts.length, 0); assert.equal(f.events.toasts.length, 1);
    }
  });

  for (const mode of ['MANUAL', 'OP']) await test(mode + ' keeps amount, requestId, origin and one download', async () => {
    const f = fixture({mode}); await f.api.generateAccount(); const [prepare, save] = f.events.posts;
    assert.equal(prepare.tipo, 'PREPARAR_CUENTA_COBRO'); assert.equal(save.tipo, 'GUARDAR_CUENTA_COBRO');
    assert.equal(prepare.requestId, save.requestId); assert.equal(save.valor, 2900000);
    assert.equal(save.numeroCuenta, 'CC-QA-001'); assert.equal(save.pdfBase64, 'JVBERi1RQQ==');
    assert.equal(save.documentoOrigen, mode === 'OP' ? 'OP-501' : 'MANUAL');
    assert.equal(save.numeroOp, mode === 'OP' ? '501' : '');
    assert.equal(f.events.downloads.length, 1); assert.equal(f.events.alerts.length, 0);
    assert.equal(f.elements.downloadBtn.disabled, false); assert.equal(f.elements.generateBtn.disabled, false);
  });

  await test('PDF export removes preview scaling only in the export copy', async () => {
    const f = fixture(); await f.api.renderPdfBlob();
    assert.equal(f.exportScale.style.transform, 'none'); assert.equal(f.exportScale.style.height, '1056px');
    assert.deepEqual(f.elements.paperScale.style, {transform: 'scale(0.5)', height: '528px'});
  });

  await test('Preparation failure never saves or downloads', async () => {
    const f = fixture({prepareError: true}); await f.api.generateAccount();
    assert.equal(f.events.posts.length, 1); assert.equal(f.events.pdfCalls, 0);
    assert.equal(f.events.downloads.length, 0); assert.equal(f.events.alerts[0], 'PREPARE_QA_FAILED');
    assert.equal(f.elements.generateBtn.disabled, false);
  });

  await test('Missing PDF dependencies prevent save with a clear error', async () => {
    const f = fixture({missingPdf: true}); await f.api.generateAccount();
    assert.equal(f.events.posts.length, 1); assert.equal(f.events.downloads.length, 0);
    assert.equal(f.events.alerts[0], 'No se pudo cargar el generador de PDF.');
  });

  await test('Rendering failure is reported and never reaches save', async () => {
    const f = fixture({renderError: true}); await f.api.generateAccount();
    assert.equal(f.events.posts.length, 1); assert.equal(f.events.downloads.length, 0);
    assert.equal(f.events.alerts[0], 'PDF_QA_FAILED'); assert.equal(f.elements.generateBtn.disabled, false);
  });

  await test('Save rejection never exposes a successful document', async () => {
    const f = fixture({saveError: true}); await f.api.generateAccount();
    assert.equal(f.events.posts.length, 2); assert.equal(f.events.downloads.length, 0);
    assert.equal(f.state.lastAccountBlob, null); assert.equal(f.events.alerts[0], 'SAVE_QA_FAILED');
  });

  await test('Number conflict does not download an outdated PDF', async () => {
    const f = fixture({numberChanged: true}); await f.api.generateAccount();
    assert.equal(f.events.posts.length, 2); assert.equal(f.events.downloads.length, 0);
    assert.equal(f.state.prepared.numeroCuenta, 'CC-QA-002'); assert.match(f.events.alerts[0], /consecutivo cambió/);
  });

  for (const refreshError of ['GET_DOCUMENTOS_SEGURA', 'LISTAR_CUENTAS_COBRO']) {
    await test('A failed ' + refreshError + ' refresh does not invalidate a saved account', async () => {
      const f = fixture({refreshError}); await f.api.generateAccount();
      assert.equal(f.events.posts.filter(p => p.tipo === 'GUARDAR_CUENTA_COBRO').length, 1);
      assert.equal(f.events.downloads.length, 1); assert.equal(f.elements.downloadBtn.disabled, false);
      assert.equal(f.events.alerts.length, 0, 'The account was already saved; refresh must not report generation failure');
      assert(f.events.toasts.some(message => /generada.*historial/.test(message)), 'Explain that the account exists and history needs refreshing');
      assert(f.events.previews.some(preview => preview.saved && preview.id === 'QA-1'), 'The successful account must leave draft state even when history fails');
    });
  }
  console.log('Account flow: ' + passed + ' PASS, ' + failed + ' FAIL; isolated client functions only');
  process.exitCode = failed ? 1 : 0;
})();
