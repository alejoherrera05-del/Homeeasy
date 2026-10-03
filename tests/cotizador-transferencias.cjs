const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MockRange {
  constructor(sheet, row, column, numRows = 1, numColumns = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows;
    this.numColumns = numColumns;
  }
  getValues() {
    const values = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numColumns; c++) {
        row.push(this.sheet.rows[this.row - 1 + r]?.[this.column - 1 + c] ?? '');
      }
      values.push(row);
    }
    return values;
  }
  setValues(values) {
    for (let r = 0; r < this.numRows; r++) {
      while (this.sheet.rows.length < this.row + r) this.sheet.rows.push([]);
      for (let c = 0; c < this.numColumns; c++) {
        this.sheet.rows[this.row - 1 + r][this.column - 1 + c] = values[r][c];
      }
    }
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.maxColumns = 26;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].some(value => value !== '' && value != null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    const lastRow = this.getLastRow();
    let max = 0;
    for (let i = 0; i < lastRow; i++) max = Math.max(max, this.rows[i].length);
    return max;
  }
  getMaxColumns() { return this.maxColumns; }
  deleteColumns(start, count) { this.maxColumns -= count; }
  setFrozenRows() {}
  getRange(row, column, numRows = 1, numColumns = 1) {
    return new MockRange(this, row, column, numRows, numColumns);
  }
  appendRow(values) { this.rows.push(values.slice()); }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
}

class MockSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error('duplicate sheet');
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

function loadModule() {
  let allow = true;
  const context = {
    console: { error() {}, log() {} },
    validarPermisoSesionAuth9B_(_ss, _token, _meta, permission) {
      if (!allow) return { response: { status: 'error', code: 'PERMISSION_DENIED', msg: 'Sin permiso.' }, validation: null };
      return {
        response: null,
        validation: {
          usuario: { uid: 'uid-qa', nombre: 'Usuario QA', email: 'qa@example.invalid' },
          permisos: [permission]
        }
      };
    },
    LockService: {
      getScriptLock() {
        return { waitLock() {}, releaseLock() {} };
      }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'COTIZADOR_TRANSFERENCIAS.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'COTIZADOR_TRANSFERENCIAS.gs' });
  context.setPermission = value => { allow = value; };
  return context;
}

function baseItem(overrides = {}) {
  return {
    roomId: 'room-1',
    family: 'onda',
    product: 'onda-67',
    location: 'Sala',
    width: '1.2',
    height: '2.1',
    quantity: '1',
    configuration: 'standard',
    coverlight: '',
    addons: ['addon-a'],
    installation: { mount: 'techo', control: 'derecha', opening: 'centro', note: 'QA sintética' },
    ...overrides
  };
}

function request(tipo, extra = {}) {
  return { tipo, appSessionToken: 'session-qa', meta: { dispositivoId: 'device-qa' }, ...extra };
}

const ctx = loadModule();
const ss = new MockSpreadsheet();
const payload = { project: 'Casa QA', items: [baseItem(), baseItem({ roomId: 'room-2', location: 'Habitación' })] };

// 1. Crear devuelve un código servidor de seis caracteres.
const created = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CREAR', {
  payload: { ...payload, creatorUid: 'uid-falso', debug: 'se descarta' }
}));
assert.equal(created.status, 'ok');
assert.match(created.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
assert.equal(created.code.length, 6);

// 2. La generación reintenta una colisión.
const occupied = { AAAAAA: true };
const randomValues = [...new Array(6).fill(0), ...new Array(6).fill(0.04)];
let randomIndex = 0;
assert.equal(ctx.generarCodigoCotizadorTransferencia_(occupied, () => randomValues[randomIndex++]), 'BBBBBB');

// 3. Preview recupera únicamente el payload saneado y su resumen.
const preview = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_PREVIEW', { code: created.code }));
assert.equal(preview.status, 'ok');
assert.equal(preview.payload.project, payload.project);
assert.equal(preview.payload.items.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(preview.summary)), { project: 'Casa QA', rooms: 2, items: 2 });
assert.deepEqual(Object.keys(preview.payload).sort(), ['items', 'project']);
assert.equal('creatorUid' in preview.payload, false);

// 4 y 5. Consume marca USADO y evita un segundo consumo.
const consumed = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CONSUMIR', { code: created.code }));
assert.deepEqual(JSON.parse(JSON.stringify(consumed)), { status: 'ok', code: created.code });
const consumedAgain = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CONSUMIR', { code: created.code }));
assert.equal(consumedAgain.code, 'TRANSFER_USED');

// 6. Un código vencido falla y la limpieza lo elimina.
const sheet = ss.getSheetByName('Cotizador_Transferencias');
sheet.appendRow(['H7K4P2', new Date(Date.now() - 8 * 86400000), new Date(Date.now() - 86400000), 'PENDIENTE', 'uid-a', 'A', JSON.stringify(payload), '', '']);
const expired = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_PREVIEW', { code: 'H7K4P2' }));
assert.equal(expired.code, 'TRANSFER_EXPIRED');
assert.equal(sheet.rows.some(row => row[0] === 'H7K4P2'), false);

// 7. Código inexistente falla.
const missing = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_PREVIEW', { code: 'Z9Z9Z9' }));
assert.equal(missing.code, 'TRANSFER_NOT_FOUND');

// 8. Normalización acepta minúsculas, espacios y guiones.
const created2 = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CREAR', { payload }));
const formattedCode = ` ${created2.code.slice(0, 2).toLowerCase()}-${created2.code.slice(2, 4).toLowerCase()} ${created2.code.slice(4).toLowerCase()} `;
const normalizedPreview = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_PREVIEW', { code: formattedCode }));
assert.equal(normalizedPreview.code, created2.code);

// 9. Usuario sin cotizaciones.write falla antes de tocar la hoja.
ctx.setPermission(false);
const denied = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CREAR', { payload }));
assert.equal(denied.code, 'PERMISSION_DENIED');
ctx.setPermission(true);

// 10. Campos comerciales y de autenticación están prohibidos.
for (const forbidden of [{ cost: 10 }, { manualCost: 20 }, { margin: 30 }, { appSessionToken: 'secret' }]) {
  const rejected = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CREAR', {
    payload: { project: 'QA', items: [baseItem(forbidden)] }
  }));
  assert.equal(rejected.code, 'TRANSFER_FORBIDDEN_FIELD');
}

// 11. Más de cien items falla.
const tooMany = ctx.procesarRutaCotizadorTransferencias_(ss, request('COTIZADOR_TRANSFERENCIA_CREAR', {
  payload: { project: 'QA', items: new Array(101).fill(null).map((_, i) => baseItem({ roomId: `room-${i}` })) }
}));
assert.equal(tooMany.code, 'TRANSFER_TOO_MANY_ITEMS');

// 12. La limpieza elimina PENDIENTE vencidos y USADO de más de 24 h.
sheet.appendRow(['J7K4P2', new Date(Date.now() - 9 * 86400000), new Date(Date.now() - 2 * 86400000), 'PENDIENTE', 'uid-a', 'A', JSON.stringify(payload), '', '']);
sheet.appendRow(['K7K4P2', new Date(Date.now() - 2 * 86400000), new Date(Date.now() + 5 * 86400000), 'USADO', 'uid-a', 'A', JSON.stringify(payload), new Date(Date.now() - 25 * 3600000), 'uid-b']);
sheet.appendRow(['L7K4P2', new Date(), new Date(Date.now() + 5 * 86400000), 'PENDIENTE', 'uid-a', 'A', JSON.stringify(payload), '', '']);
const cleanup = ctx.limpiarCotizadorTransferencias_(sheet, new Date());
assert.equal(cleanup.deleted, 2);
assert.equal(sheet.rows.some(row => row[0] === 'J7K4P2'), false);
assert.equal(sheet.rows.some(row => row[0] === 'K7K4P2'), false);
assert.equal(sheet.rows.some(row => row[0] === 'L7K4P2'), true);

// 13. El router no intercepta rutas existentes.
for (const route of ['COSTOS_CALCULAR_COTIZACION', 'COSTOS_OPCIONES', 'COSTOS_ESTADO', 'actualizar_seguimiento', 'cotizacion', 'pedido']) {
  assert.equal(ctx.procesarRutaCotizadorTransferencias_(ss, request(route)), null);
}

console.log('cotizador-transferencias: 13/13 pruebas OK');
