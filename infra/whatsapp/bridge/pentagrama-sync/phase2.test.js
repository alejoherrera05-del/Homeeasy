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
