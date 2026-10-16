'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PentagramaPhase2, statusFor, publicInventorySummary } = require('./phase2');
const { Phase2Store } = require('./phase2-store');
const { INITIAL_MAPPINGS, pentagramaParamsForCase } = require('./mapper');

test('change classifier enforces unchanged and review thresholds', () => {
  assert.equal(statusFor(100, 100), 'UNCHANGED');
  assert.equal(statusFor(100, 114.99), 'INCREASED');
  assert.equal(statusFor(100, 70), 'REVIEW_REQUIRED');
  assert.equal(statusFor(100, 130), 'REVIEW_REQUIRED');
});

test('scan preserves unmapped products and builds a verified multi-case rate proposal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-phase2-'));
  const store = new Phase2Store({ dataDir: directory });
  const service = new PentagramaPhase2({
    store,
    mappings: [{ id: 'v', homeeasyId: 'vertical-111', family: 'Vertical', reference: 'Matte', productCode: 'P', groupCode: 'G', calculationType: 'NormalProduct', width: '1.2', height: '1.3', quantity: 1, productDiscount: 0, pricingMode: 'account-discount', strategy: 'RATE_M2', status: 'CERTIFIED', verifiedAt: '2026-10-08T00:00:00Z', casesPassed: 3, maxDifference: 0, destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' }, updateField: 'Tarifa_IVA_COP', special: {}, validationCases: [{ id: 'a', width: '2', height: '2', role: 'derive' }, { id: 'b', width: '2.4', height: '2', role: 'derive' }, { id: 'min', width: '1.2', height: '1.3', role: 'boundary' }] }],
    certificationRegistry: { products: [{ homeeasyId: 'pending', status: 'REVIEW_REQUIRED', strategy: 'RATE_M2', productCode: 'PENDING', reason: 'Falta evidencia de borde.' }] },
    homeeasy: { catalog: async () => ({ version: 'x', products: [{ row: 2, id: 'vertical-111', familyName: 'Vertical', reference: 'Matte', method: 'area', rate: 87000, minHeight: 1.3, minArea: 0, promotional: false }, { row: 3, id: 'other', familyName: 'Otra', reference: 'X', rate: 10 }, { row: 4, id: 'pending', familyName: 'Panel', reference: 'Pendiente', rate: 20 }] }) },
    enrollablesRegistry: { products: {} },
    inventory: { scan: async () => ({
      checkedAt: '2026-10-14T00:00:00Z',
      counts: { products: 1, roots: 1, leaves: 1 },
      products: [{ name: 'Matte', productCode: 'P', groupCode: 'G', associationGroup: '', externalKey: 'P|G|' }]
    }) },
    gateway: { dispatch: async () => [{ id: 1 }] },
    pricing: { supplierCost: async params => ({ basePrice: Number(params.Width) * Number(params.Height) * 90000, distributorDiscount: 0, productDiscount: 0, vatRate: 0, total: Number(params.Width) * Math.max(Number(params.Height), 1.3) * 90000 }) },
    homeeasyCost: { cost: async item => ({ amount: Number(item.width) * Math.max(Number(item.height), 1.3) * 87000 }) }
  });
  const operation = service.startScan({ email: 'test@example.com' }, { sessionToken: 'x', deviceId: 'd' });
  for (let i = 0; i < 30 && store.operationById(operation.id).state !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const scan = store.latestScan();
  assert.equal(scan.counts.INCREASED, 1);
  assert.equal(scan.counts.UNMAPPED, 1);
  assert.equal(scan.counts.REVIEW_REQUIRED, 1);
  assert.equal(scan.results.find(item => item.homeeasyId === 'pending').autoApplicable, false);
  assert.equal(scan.results.find(item => item.id === 'v').proposedRate, 90000);
  assert.equal(scan.results.find(item => item.id === 'v').autoApplicable, true);
  assert.deepEqual({ total: scan.catalogAudit.total, certified: scan.catalogAudit.certified, review: scan.catalogAudit.reviewRequired, unmapped: scan.catalogAudit.unmapped }, { total: 3, certified: 1, review: 1, unmapped: 1 });
  assert.equal(scan.catalogAudit.pentagramaProducts, 1);
  assert.equal(scan.catalogInventoryAudit.counts.PRESENT, 1);
  assert.equal(scan.catalogChanges.length, 0);
});

test('apply rejects expired scans', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-phase2-expired-'));
  const store = new Phase2Store({ dataDir: directory });
  store.addScan({ id: 'old', checkedAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString(), results: [] });
  const service = new PentagramaPhase2({ store, mappings: [], pricing: {}, homeeasyCost: {}, homeeasy: {}, gateway: {} });
  assert.throws(() => service.startApply({}, {}, { scanId: 'old' }), error => error.code === 'PENTAGRAMA_SCAN_EXPIRED');
});

test('post-apply mismatch rolls back the affected batch automatically', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-phase2-rollback-'));
  const store = new Phase2Store({ dataDir: directory }); let rolledBack = null;
  const mapping = { id: 'v', homeeasyId: 'vertical-111', family: 'Vertical', reference: 'Matte', productCode: 'P', groupCode: 'G',
    calculationType: 'NormalProduct', width: '2', height: '2', quantity: 1, productDiscount: 0, pricingMode: 'account-discount',
    strategy: 'RATE_M2', status: 'CERTIFIED', verifiedAt: '2026-10-08T00:00:00Z', casesPassed: 3, maxDifference: 0,
    destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' }, updateField: 'Tarifa_IVA_COP', special: {},
    validationCases: [{ id: 'a', width: '2', height: '2', role: 'derive' }, { id: 'b', width: '2.4', height: '2', role: 'derive' }] };
  const service = new PentagramaPhase2({ store, mappings: [mapping], gateway: {},
    pricing: { supplierCost: async params => ({ total: Number(params.Width) * Number(params.Height) * 100000 }) },
    homeeasyCost: { cost: async item => ({ amount: Number(item.width) * Number(item.height) * 99000 }) },
    homeeasy: { apply: async () => ({ historyId: 'history-1', qa: { ok: true } }), rollback: async id => { rolledBack = id; return { historyId: 'rollback-1' }; } }
  });
  const operation = store.operation('apply', { email: 'test@example.com' });
  const change = { id: 'v', homeeasyId: 'vertical-111', sourceRow: 2, updateField: 'Tarifa_IVA_COP', expectedRate: 99000,
    proposedRate: 100000, oldCost: 396000, newCost: 400000, difference: 4000, percent: 1.01, width: '2', height: '2', quantity: 1,
    strategy: 'RATE_M2', destination: mapping.destination, sourceModel: { method: 'area', minHeight: 0, minArea: 0, promotional: false } };
  await assert.rejects(service.runApply(operation.id, { id: 'scan-1' }, [change], {}), error => error.code === 'PENTAGRAMA_POST_APPLY_QA_ROLLED_BACK');
  assert.equal(rolledBack, 'history-1');
});

test('inventory audit records real catalog additions and discontinuations without auto-applying them', () => {
  const service = new PentagramaPhase2({
    store: new Phase2Store({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-inventory-audit-')) }),
    mappings: [],
    enrollablesRegistry: { products: {} },
    gateway: { dispatch: async () => ({}) },
    pricing: {},
    homeeasyCost: {}
  });
  const audit = service.inventoryAudit([
    {
      id: 'old',
      familyName: 'Ring',
      reference: 'Old fabric',
      active: true,
      external: { productCode: 'OLD', groupCode: '1', associationGroup: 'R' }
    }
  ], {
    checkedAt: '2026-10-14T00:00:00Z',
    counts: { products: 1, roots: 1, leaves: 1 },
    products: [{ name: 'New fabric', productCode: 'NEW', groupCode: '1', associationGroup: 'R', externalKey: 'NEW|1|R' }]
  });
  assert.equal(audit.counts.NEW, 1);
  assert.equal(audit.counts.DISCONTINUED, 1);
  assert.equal(audit.changes.length, 2);
  assert.ok(audit.changes.every(item => ['NEW', 'DISCONTINUED'].includes(item.status)));
});


test('certified 279-Enrollables model is applied as one upstream batch and recorded in composite history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-local-model-apply-'));
  const store = new Phase2Store({ dataDir: directory });
  const candidate = {
    version: 'pentagrama-local-v1',
    sourceVersion: 'sheet-v1',
    summary: {
      enrollables: 279,
      fail: 0,
      maxDifference: 0,
      monetaryExpectedSelfReferential: 0,
      changed: 12
    }
  };
  let appliedCandidate = null;
  const service = new PentagramaPhase2({
    store,
    mappings: [],
    enrollablesRegistry: { products: {} },
    pricing: {},
    homeeasyCost: {},
    homeeasy: {
      catalog: async () => ({ version: 'sheet-v1', products: [] }),
      applyLocalModel: async (_scan, model) => {
        appliedCandidate = model;
        return { historyId: 'local-history', version: model.version, qa: { ok: true, checked: 500, maxDifference: 0 } };
      },
      rollback: async () => ({ historyId: 'rollback-local', qa: { ok: true } })
    }
  });
  const operation = store.operation('apply', { email: 'test@example.com' });
  const scan = {
    id: 'scan-local',
    sourceVersion: 'sheet-v1',
    localModelCandidate: candidate,
    results: [{
      id: 'enrollables-local-model',
      homeeasyId: '__enrollables_local_model__',
      strategy: 'LOCAL_MODEL',
      status: 'NEW',
      autoApplicable: true,
      oldCost: 0,
      newCost: 12,
      difference: 12
    }],
    catalogChanges: [],
    catalogActions: [],
    catalogAudit: {},
    counts: { NEW: 1 }
  };
  await service.runApply(operation.id, scan, [scan.results[0]], [], {});
  assert.equal(appliedCandidate.version, 'pentagrama-local-v1');
  const completed = store.operationById(operation.id);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.result.localModelChanges, 1);
  assert.deepEqual(completed.result.upstreamHistoryIds, ['local-history']);
  assert.equal(completed.result.qa.ok, true);
  assert.equal(store.latestScan().localModelCandidate, null);
  assert.equal(store.latestScan().localModelVersion, 'pentagrama-local-v1');
});

test('a later QA failure compensates a successfully applied Enrollables batch', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-local-model-rollback-'));
  const store = new Phase2Store({ dataDir: directory });
  const rolledBack = [];
  const mapping = {
    id: 'v', homeeasyId: 'vertical-111', family: 'Vertical', reference: 'Matte',
    productCode: 'P', groupCode: 'G', calculationType: 'NormalProduct',
    width: '2', height: '2', quantity: 1, productDiscount: 0, pricingMode: 'account-discount',
    strategy: 'RATE_M2', status: 'CERTIFIED', verifiedAt: '2026-10-08T00:00:00Z',
    casesPassed: 3, maxDifference: 0,
    destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
    updateField: 'Tarifa_IVA_COP', special: {},
    validationCases: [{ id: 'a', width: '2', height: '2', role: 'derive' }, { id: 'b', width: '2.4', height: '2', role: 'derive' }]
  };
  const candidate = {
    version: 'pentagrama-local-v2',
    sourceVersion: 'sheet-v1',
    summary: { enrollables: 279, fail: 0, maxDifference: 0, monetaryExpectedSelfReferential: 0, changed: 1 }
  };
  let currentCalls = 0;
  const service = new PentagramaPhase2({
    store,
    mappings: [mapping],
    enrollablesRegistry: { products: {} },
    pricing: { supplierCost: async params => ({ total: Number(params.Width) * Number(params.Height) * 100000 }) },
    homeeasyCost: {
      cost: async item => {
        currentCalls += 1;
        const rate = currentCalls <= 2 ? 99000 : 98000;
        return { amount: Number(item.width) * Number(item.height) * rate };
      }
    },
    homeeasy: {
      catalog: async () => ({ version: 'sheet-v1', products: [] }),
      apply: async () => ({ historyId: 'price-history', qa: { ok: true } }),
      applyLocalModel: async () => ({ historyId: 'local-history', version: 'pentagrama-local-v2', qa: { ok: true, checked: 500, maxDifference: 0 } }),
      rollback: async id => { rolledBack.push(id); return { historyId: 'rollback-' + id, qa: { ok: true } }; }
    }
  });
  const operation = store.operation('apply', { email: 'test@example.com' });
  const priceChange = {
    id: 'v', homeeasyId: 'vertical-111', sourceRow: 2, updateField: 'Tarifa_IVA_COP',
    expectedRate: 99000, proposedRate: 100000, oldCost: 396000, newCost: 400000,
    difference: 4000, percent: 1.01, width: '2', height: '2', quantity: 1,
    strategy: 'RATE_M2', destination: mapping.destination,
    sourceModel: { method: 'area', minHeight: 0, minArea: 0, promotional: false }
  };
  const localChange = {
    id: 'enrollables-local-model', homeeasyId: '__enrollables_local_model__',
    strategy: 'LOCAL_MODEL', status: 'NEW', autoApplicable: true, oldCost: 0, newCost: 1
  };
  const scan = {
    id: 'scan-composite',
    sourceVersion: 'sheet-v1',
    localModelCandidate: candidate,
    results: [priceChange, localChange],
    catalogChanges: [],
    catalogActions: [],
    catalogAudit: {},
    counts: { INCREASED: 1, NEW: 1 }
  };
  await assert.rejects(
    service.runApply(operation.id, scan, [priceChange, localChange], [], {}),
    error => error.code === 'PENTAGRAMA_POST_APPLY_QA_ROLLED_BACK'
  );
  assert.deepEqual(rolledBack, ['local-history', 'price-history']);
});


test('public scan keeps only the summary of the heavy local model and removes write payloads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-public-scan-'));
  const service = new PentagramaPhase2({
    store: new Phase2Store({ dataDir: directory }),
    mappings: [],
    enrollablesRegistry: { products: {} },
    pricing: {},
    homeeasyCost: {},
    homeeasy: {}
  });
  const publicScan = service.publicScan({
    id: 'scan-public',
    localModelCandidate: {
      version: 'local-v1',
      generatedAt: '2026-10-14T00:00:00Z',
      sourceVersion: 'sheet-v1',
      summary: { enrollables: 279, fail: 0 },
      products: new Array(279).fill({ secret: 'heavy' }),
      qaCases: new Array(500).fill({ expected: 123 })
    },
    results: [{
      id: 'x',
      status: 'NEW',
      sourceModel: { rules: { private: true } },
      validationCases: [{ width: 2 }],
      priceEvidence: [{ total: 999 }]
    }],
    catalogActions: [{
      id: 'catalog-add:x',
      kind: 'ADD',
      autoApplicable: true,
      certified: true,
      evidence: [{ total: 999 }],
      mutation: { rowValues: ['private-write-payload'] }
    }],
    catalogChanges: []
  });
  assert.deepEqual(publicScan.localModelCandidate, {
    version: 'local-v1',
    generatedAt: '2026-10-14T00:00:00Z',
    sourceVersion: 'sheet-v1',
    summary: { enrollables: 279, fail: 0 }
  });
  assert.equal('sourceModel' in publicScan.results[0], false);
  assert.equal('validationCases' in publicScan.results[0], false);
  assert.equal('priceEvidence' in publicScan.results[0], false);
  assert.equal('mutation' in publicScan.catalogActions[0], false);
  assert.equal('evidence' in publicScan.catalogActions[0], false);
});


test('read-only inventory operation uses short catalog jobs and publishes only a compact summary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-inventory-operation-'));
  const store = new Phase2Store({ dataDir: directory });
  const calls = [];

  const gateway = {
    dispatch: async (type, payload, options) => {
      calls.push({ type, payload, options });
      assert.equal(type, 'catalog');
      const params = payload && payload.params || {};

      if (payload.operation === 'categories' && params.level === 1) {
        return [
          { Code: '83', Name: 'CORTINA RING', Levels: 1 },
          { Code: '4', Name: 'ENROLLABLE', Levels: 1 },
          { Code: '102', Name: 'ACCESORIO PRODUCTO', Levels: 1 }
        ];
      }

      if (payload.operation === 'products' && params.Category1 === '83') {
        return [
          { ProductName: 'Ring A', ProductCode: 'RA', GroupCode: '1346', GrupAsoc: 'RIECORIN' },
          { ProductName: 'Renueva Ring', ProductCode: 'RR', GroupCode: '1346', GrupAsoc: 'RIECORIN' }
        ];
      }

      if (payload.operation === 'products' && params.Category1 === '4') {
        return [
          { ProductName: 'Screen', ProductCode: 'E1', GroupCode: '599', GrupAsoc: 'ENR' },
          { ProductName: 'Shared', ProductCode: 'S1', GroupCode: '1', GrupAsoc: 'X' }
        ];
      }

      if (payload.operation === 'products' && params.Category1 === '102') {
        return [
          { ProductName: 'Shared', ProductCode: 'S1', GroupCode: '1', GrupAsoc: 'X' }
        ];
      }

      throw new Error('unexpected catalog request in compact inventory test');
    }
  };

  const service = new PentagramaPhase2({
    store,
    mappings: [],
    enrollablesRegistry: { products: {} },
    pricing: {},
    homeeasyCost: {},
    gateway
  });

  const operation = service.startInventory({ email: 'test@example.com' });
  for (let i = 0; i < 50 && store.operationById(operation.id).state !== 'completed'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const completed = store.operationById(operation.id);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.stage, 'COMPLETED');
  assert.ok(calls.length > 1);
  assert.ok(calls.every(call => call.type === 'catalog'));
  assert.equal(completed.result.counts.roots, 2);
  assert.equal(completed.result.counts.discoveredRoots, 3);
  assert.equal(completed.result.counts.excludedRoots, 1);
  assert.equal(completed.result.counts.leaves, 2);
  assert.equal(completed.result.counts.products, 4);
  assert.equal(completed.result.counts.requests, 3);
  assert.equal(completed.result.counts.duplicateAppearances, 0);
  assert.deepEqual(completed.result.critical.ring, {
    family: 'CORTINA RING',
    products: 2,
    renueva: 1,
    eligibleProducts: 1
  });
  assert.deepEqual(completed.result.critical.enrollable, {
    family: 'ENROLLABLE',
    products: 2,
    renueva: 0,
    eligibleProducts: 2
  });
  assert.equal('products' in completed.result && Array.isArray(completed.result.products), false);
});

test('public inventory summary deduplicates products per family across multiple catalog paths', () => {
  const summary = publicInventorySummary({
    counts: { roots: 2, leaves: 3, products: 2 },
    products: [
      {
        name: 'A',
        productCode: 'A',
        groupCode: '1',
        associationGroup: 'X',
        externalKey: 'A|1|X',
        path: ['ENROLLABLE', 'SCREEN'],
        paths: [['ENROLLABLE', 'SCREEN'], ['ENROLLABLE', 'BLACKOUT']]
      },
      {
        name: 'B',
        productCode: 'B',
        groupCode: '1',
        associationGroup: 'X',
        externalKey: 'B|1|X',
        path: ['CORTINA RING', 'VELO'],
        paths: [['CORTINA RING', 'VELO']]
      }
    ]
  });
  assert.equal(summary.families.find(item => item.family === 'ENROLLABLE').products, 1);
  assert.equal(summary.families.find(item => item.family === 'CORTINA RING').products, 1);
});

test('generic catalog audit does not classify extra Enrollables color SKUs as new fabric references', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-enrollables-generic-filter-'));
  const service = new PentagramaPhase2({
    store: new Phase2Store({ dataDir: directory }),
    mappings: [],
    pricing: {},
    homeeasyCost: {},
    enrollablesRegistry: require('./enrollables-live-products.json'),
    gateway: { dispatch: async () => ({}) }
  });

  const audit = service.inventoryAudit([
    {
      id: 'enrollable-blackout-angora',
      familyName: 'Enrollable',
      reference: 'Angora',
      active: true,
      external: {
        productCode: 'ENRSTDBOANGWHI',
        groupCode: '324',
        associationGroup: 'ENRSTD'
      }
    }
  ], {
    checkedAt: '2026-10-15T00:00:00Z',
    counts: { products: 2, roots: 1, leaves: 1 },
    products: [
      {
        name: 'Angora White',
        productCode: 'ENRSTDBOANGWHI',
        groupCode: '324',
        associationGroup: 'ENRSTD',
        externalKey: 'ENRSTDBOANGWHI|324|ENRSTD',
        path: ['ENROLLABLE', 'STANDARD/PLATINA SIN CABEZAL', 'BLACK OUT', 'ANGORA']
      },
      {
        name: 'Angora Grey',
        productCode: 'ENRSTDBOANGGRE',
        groupCode: '324',
        associationGroup: 'ENRSTD',
        externalKey: 'ENRSTDBOANGGRE|324|ENRSTD',
        path: ['ENROLLABLE', 'STANDARD/PLATINA SIN CABEZAL', 'BLACK OUT', 'ANGORA']
      }
    ]
  });

  assert.equal(Number(audit.counts.NEW || 0), 0);
  assert.equal(Number(audit.counts.DISCONTINUED || 0), 0);
  assert.equal(audit.changes.length, 0);
});


test('quick scan checks certified prices without running deep catalog maintenance', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-quick-scan-'));
  const store = new Phase2Store({ dataDir: directory });
  let priceCalls = 0;
  let deepCalls = 0;
  const mapping = {
    id: 'quick-onda',
    homeeasyId: 'onda-quick',
    family: 'Onda Serena',
    reference: 'Quick',
    productCode: 'Q1',
    groupCode: '1345',
    calculationType: 'NormalProduct',
    width: '2',
    height: '2',
    quantity: 1,
    productDiscount: 0,
    pricingMode: 'account-discount',
    strategy: 'RATE_M2',
    status: 'CERTIFIED',
    verifiedAt: '2026-10-08T00:00:00Z',
    casesPassed: 3,
    maxDifference: 0,
    destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
    updateField: 'Tarifa_IVA_COP',
    special: {},
    validationCases: [
      { id: 'a', width: '2', height: '2', role: 'derive' },
      { id: 'b', width: '2.4', height: '2', role: 'derive' },
      { id: 'min', width: '1', height: '1', role: 'boundary' }
    ]
  };
  const service = new PentagramaPhase2({
    store,
    mappings: [mapping],
    certificationRegistry: { products: [] },
    enrollablesRegistry: { products: {} },
    homeeasy: { catalog: async () => ({
      version: 'quick-v1',
      validThrough: '2026-12-31',
      products: [{
        row: 2,
        id: 'onda-quick',
        family: 'onda',
        familyName: 'Onda Serena',
        reference: 'Quick',
        method: 'area',
        rate: 90000,
        minHeight: 0,
        minArea: 0,
        promotional: false,
        active: true,
        external: {}
      }]
    }) },
    pricing: { supplierCost: async params => {
      priceCalls += 1;
      const area = Number(params.Width) * Number(params.Height);
      return { total: area * 90000, basePrice: area * 90000, distributorDiscount: 0, productDiscount: 0, vatRate: 0 };
    } },
    homeeasyCost: { cost: async () => { throw new Error('unchanged quick scan must not run full HomeEasy validation'); } },
    gateway: { dispatch: async () => { deepCalls += 1; throw new Error('quick scan must not crawl catalog'); } }
  });

  const operation = service.startQuickScan({ email: 'test@example.com' }, { serviceKey: 'test-key', deviceId: 'test-device' });
  for (let i = 0; i < 50 && store.operationById(operation.id).state !== 'completed'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const completed = store.operationById(operation.id);
  const scan = store.latestScan();
  assert.equal(completed.state, 'completed');
  assert.equal(scan.mode, 'quick');
  assert.equal(scan.counts.UNCHANGED, 1);
  assert.equal(scan.catalogAudit.mode, 'PRICE_ONLY');
  assert.equal(scan.catalogActions.length, 0);
  assert.equal(priceCalls, 1);
  assert.equal(deepCalls, 0);
});


test('onda-67 quick price probe uses the certified RIECOR28 association group', () => {
  const mapping = INITIAL_MAPPINGS.find(item => item.homeeasyId === 'onda-67');
  assert.ok(mapping);
  const params = pentagramaParamsForCase(mapping, { width: '2', height: '2' });
  assert.equal(params.ProductCode, 'CORONSEVECORWH2.8');
  assert.equal(params.GroupCode, '1345');
  assert.equal(params.AssociationGroup, 'RIECOR28');
  assert.equal(params.Discount, 0);
});

test('quick probe retries one transient Pentagrama unexpected response', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-quick-retry-'));
  const store = new Phase2Store({ dataDir: directory });
  let calls = 0;
  const service = new PentagramaPhase2({
    store,
    mappings: [{
      id: 'retry',
      homeeasyId: 'onda-retry',
      family: 'Onda Serena',
      reference: 'Retry',
      productCode: 'RETRY',
      groupCode: '1345',
      calculationType: 'NormalProduct',
      width: '2',
      height: '2',
      quantity: 1,
      productDiscount: 0,
      pricingMode: 'account-discount',
      strategy: 'RATE_M2',
      status: 'CERTIFIED',
      verifiedAt: '2026-10-08T00:00:00Z',
      casesPassed: 3,
      maxDifference: 0,
      destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
      validationCases: [{ id: 'a', width: '2', height: '2', role: 'derive' }],
      updateField: 'Tarifa_IVA_COP',
      special: { AssociationGroup: 'RIECOR28' }
    }],
    certificationRegistry: { products: [] },
    enrollablesRegistry: { products: {} },
    homeeasy: { catalog: async () => ({
      version: 'retry-v1',
      products: [{ row: 2, id: 'onda-retry', familyName: 'Onda Serena', reference: 'Retry', method: 'area', rate: 90000, minHeight: 0, minArea: 0, promotional: false, active: true }]
    }) },
    pricing: { supplierCost: async params => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary response'), { code: 'PENTAGRAMA_UNEXPECTED_RESPONSE' });
      return { total: Number(params.Width) * Number(params.Height) * 90000, basePrice: 1, distributorDiscount: 0, productDiscount: 0, vatRate: 0 };
    } },
    homeeasyCost: { cost: async () => ({ amount: 0 }) }
  });

  const operation = service.startQuickScan({ email: 'test@example.com' }, { serviceKey: 'test-key', deviceId: 'test-device' });
  for (let i = 0; i < 50 && store.operationById(operation.id).state !== 'completed'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const scan = store.latestScan();
  assert.equal(calls, 2);
  assert.equal(scan.counts.UNCHANGED, 1);
  assert.equal(Number(scan.counts.ERROR || 0), 0);
});
