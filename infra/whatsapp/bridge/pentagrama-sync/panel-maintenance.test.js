'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaPhase2 } = require('./phase2');
const { INITIAL_MAPPINGS } = require('./mapper');

test('Panel Japonés mappings require maintenance until minimum rule is applied', async () => {
  const panel = INITIAL_MAPPINGS.filter(item => item.family === 'Panel Japonés');
  assert.equal(panel.length, 29);
  assert.ok(panel.every(item => item.status === 'CERTIFIED' && item.expectedMinArea === 1.6));

  const mapping = {
    id: 'panel-test', homeeasyId: 'panel-test', family: 'Panel Japonés', reference: 'Test',
    productCode: 'PANELTEST', groupCode: '671', calculationType: 'NormalProduct',
    width: '2', height: '2', quantity: 1, productDiscount: 0, pricingMode: 'account-discount',
    strategy: 'RATE_M2', status: 'CERTIFIED', verifiedAt: '2026-10-10T00:00:00Z',
    casesPassed: 3, maxDifference: 0, expectedMinHeight: 1.3, expectedMinArea: 1.6,
    expectedPreviousMinArea: 0, destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
    updateField: 'Tarifa_IVA_COP', special: { AssociationGroup: 'PANEL', Discount: 0 },
    validationCases: [
      { id: 'a', width: '2', height: '2', role: 'derive' },
      { id: 'b', width: '2.4', height: '2.1', role: 'derive' },
      { id: 'min', width: '1', height: '1.3', role: 'boundary' }
    ]
  };
  const sourceItem = {
    row: 2, id: 'panel-test', family: 'panel', familyName: 'Panel Japonés', reference: 'Test',
    method: 'area', rate: 90000, minHeight: 1.3, minArea: 0, extraDiscount: 0,
    promotional: false, active: true, status: 'VIGENTE', pricesIncludeVat: true, rules: {}
  };
  const source = { version: 'panel-v1', validThrough: '2026-12-31', products: [sourceItem] };
  let calls = 0;
  const service = new PentagramaPhase2({
    mappings: [mapping], certificationRegistry: { products: [] }, enrollablesRegistry: { products: {} },
    homeeasy: { catalog: async () => source },
    pricing: { supplierCost: async params => {
      calls += 1;
      const area = Math.max(Number(params.Width) * Math.max(Number(params.Height), 1.3), 1.6);
      return { total: area * 100000, basePrice: area * 100000, distributorDiscount: 0, productDiscount: 0, vatRate: 0 };
    } },
    homeeasyCost: { cost: async () => ({ amount: 0 }) }
  });

  const probe = await service.quickProbeMapping(mapping, sourceItem);
  assert.equal(probe.status, 'REVIEW_REQUIRED');
  assert.equal(probe.maintenanceRequired, true);
  assert.equal(calls, 0);

  const actions = service.buildRuleMaintenanceActions(source);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'UPDATE_RULES');
  assert.equal(actions[0].autoApplicable, true);

  const verified = await service.verifyCatalogActions(
    { sourceVersion: source.version, sourceValidThrough: source.validThrough },
    actions,
    { deviceId: 'test-device' }
  );
  assert.equal(verified[0].mutation.proposedMinArea, 1.6);
  assert.equal(verified[0].mutation.proposedRate, 100000);
  assert.equal(verified[0].mutation.rowValues[8], 1.6);
  assert.equal(verified[0].mutation.qaCases.length, 3);
  assert.equal(calls, 3);
});
