'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PentagramaPhase2, statusFor } = require('./phase2');
const { Phase2Store } = require('./phase2-store');

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
    gateway: { dispatch: async type => {
      if (type === 'catalogInventory') return {
        checkedAt: '2026-10-14T00:00:00Z',
        counts: { products: 1, roots: 1, leaves: 1 },
        products: [{ name: 'Matte', productCode: 'P', groupCode: 'G', associationGroup: '', externalKey: 'P|G|' }]
      };
      return [{ id: 1 }];
    } },
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
