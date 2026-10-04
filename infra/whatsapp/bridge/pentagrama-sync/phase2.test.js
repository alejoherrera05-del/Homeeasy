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

test('scan preserves unmapped products and builds a safe rate proposal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-phase2-'));
  const store = new Phase2Store({ dataDir: directory });
  const service = new PentagramaPhase2({
    store,
    mappings: [{ id: 'v', homeeasyId: 'vertical-111', family: 'Vertical', reference: 'Matte', productCode: 'P', groupCode: 'G', calculationType: 'NormalProduct', width: '1.2', height: '1.3', quantity: 1, productDiscount: 0, pricingMode: 'account-discount', updateField: 'Tarifa_IVA_COP', special: {} }],
    homeeasy: { catalog: async () => ({ version: 'x', products: [{ row: 2, id: 'vertical-111', familyName: 'Vertical', reference: 'Matte', rate: 87941 }, { row: 3, id: 'other', familyName: 'Otra', reference: 'X', rate: 10 }] }) },
    gateway: { dispatch: async () => [{ id: 1 }] },
    pricing: { supplierCost: async () => ({ basePrice: 120000, distributorDiscount: .01, productDiscount: 0, vatRate: .19, total: 141543.36 }) },
    homeeasyCost: { cost: async () => ({ amount: 137187.96 }) }
  });
  const operation = service.startScan({ email: 'test@example.com' }, { sessionToken: 'x', deviceId: 'd' });
  for (let i = 0; i < 30 && store.operationById(operation.id).state !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const scan = store.latestScan();
  assert.equal(scan.counts.INCREASED, 1);
  assert.equal(scan.counts.UNMAPPED, 1);
  assert.equal(scan.results.find(item => item.id === 'v').proposedRate, 90732.92);
});

test('apply rejects expired scans', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-phase2-expired-'));
  const store = new Phase2Store({ dataDir: directory });
  store.addScan({ id: 'old', checkedAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString(), results: [] });
  const service = new PentagramaPhase2({ store, mappings: [], pricing: {}, homeeasyCost: {}, homeeasy: {}, gateway: {} });
  assert.throws(() => service.startApply({}, {}, { scanId: 'old' }), error => error.code === 'PENTAGRAMA_SCAN_EXPIRED');
});
