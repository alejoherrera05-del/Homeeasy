'use strict';

const path = require('node:path');
const bridgeRoot = process.cwd();
const { HomeEasySyncClient } = require(path.join(bridgeRoot, 'pentagrama-sync/homeeasy-sync'));

const parentProductCode = 'ENRSTDBOMA3090';
const associationGroup = 'ENRSTD';
const candidates = [
  { homeeasyId: 'coverlight-standard', productCode: 'KITPERCOLIBLA', groupCode: '616', calculationType: 'DimensionsHeight', factor: ({ height }) => Number(height) * 2 },
  { homeeasyId: 'coverlight-plus', productCode: 'KITPERCOLIPLUBLA', groupCode: '616', calculationType: 'DimensionsHeight', factor: ({ height }) => Number(height) * 2 },
  { homeeasyId: 'coverlight-advance', productCode: 'KITPERCOLIADVBLA', groupCode: '616', calculationType: 'DimensionsHeight', factor: ({ height }) => Number(height) * 2 },
  { homeeasyId: 'coverlight-single', productCode: 'KITPERCOLISINBLA', groupCode: '616', calculationType: 'DimensionsHeight', factor: ({ height }) => Number(height) * 2 },
  { homeeasyId: 'perfil-basico-out', productCode: 'ACENPEINSTDOUBLA', groupCode: '108', calculationType: 'DimensionsWidth', factor: ({ width }) => Number(width) }
];

const validationCases = [
  { id: 'normal-a', width: '1.83', height: '1.2', role: 'derive' },
  { id: 'normal-b', width: '1.83', height: '2.2', role: 'derive' },
  { id: 'wide-tall', width: '2.5', height: '2.8', role: 'validate' }
];

function money(value) { return Math.round(Number(value) * 100) / 100; }

async function portalPrice(definition, sample) {
  const response = await fetch('http://127.0.0.1:8080/api/pentagrama-sync/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': process.env.BRIDGE_TOKEN },
    body: JSON.stringify({
      params: {
        ProductCode: definition.productCode,
        Quantity: 1,
        Width: sample.width,
        Height: sample.height,
        GroupCode: definition.groupCode,
        calculationType: definition.calculationType,
        Degrees: '',
        Panels: 0,
        Cabezal: '',
        ItemCodeFather: parentProductCode,
        AssociationGroup: associationGroup,
        Discount: 0
      },
      options: { productDiscount: 0, pricingMode: 'account-discount', AssociationGroup: associationGroup }
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.code || 'PENTAGRAMA_PRICE_FAILED'), { details: payload });
  return Number(payload.result.total);
}

async function main() {
  const homeeasy = new HomeEasySyncClient();
  const catalog = await homeeasy.catalog({
    serviceKey: process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY,
    deviceId: 'complement-certification',
    deviceName: 'Complement Certification',
    platform: 'VPS',
    browser: 'Node'
  });
  const output = [];
  for (const definition of candidates) {
    const source = catalog.products.find(product => product.id === definition.homeeasyId);
    if (!source) {
      output.push({ homeeasyId: definition.homeeasyId, status: 'MISSING_HOMEEASY' });
      continue;
    }
    try {
      const portalCases = [];
      for (const sample of validationCases) {
        portalCases.push({ ...sample, pentagrama: await portalPrice(definition, sample) });
      }
      const deriveCases = portalCases.filter(item => item.role === 'derive');
      const rates = deriveCases.map(item => item.pentagrama / definition.factor(item));
      const proposedRate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
      const cases = portalCases.map(sample => {
        const reproduced = money(proposedRate * definition.factor(sample));
        return { ...sample, factor: definition.factor(sample), reproduced, difference: money(Math.abs(sample.pentagrama - reproduced)) };
      });
      output.push({
        ...definition,
        factor: undefined,
        parentProductCode,
        associationGroup,
        source: { row: source.row, reference: source.reference, rate: source.rate, method: source.method, notes: source.notes },
        proposedRate,
        cases,
        casesPassed: cases.filter(item => item.difference <= 0.02).length,
        maxDifference: Math.max(...cases.map(item => item.difference))
      });
    } catch (error) {
      output.push({ homeeasyId: definition.homeeasyId, status: 'FAILED', error: String(error.message), details: error.details || null });
    }
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), output }, null, 2));
  if (output.some(item => Number(item.casesPassed || 0) !== validationCases.length)) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ error: String(error.code || error.message || 'COMPLEMENT_VALIDATION_FAILED') }));
  process.exitCode = 1;
});
