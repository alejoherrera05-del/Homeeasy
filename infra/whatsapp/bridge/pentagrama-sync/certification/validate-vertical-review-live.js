'use strict';

const path = require('node:path');
const bridgeRoot = process.cwd();
const { HomeEasySyncClient } = require(path.join(bridgeRoot, 'pentagrama-sync/homeeasy-sync'));
const { homeEasyRateCost } = require(path.join(bridgeRoot, 'pentagrama-sync/strategies'));

const candidates = [
  ['vertical-118', 'VERSCCADFAOF3WHBL', '455'],
  ['vertical-119', 'VERSCCADSIBA5BL', '455'],
  ['vertical-125', 'VERSCCADJADE47604', '455'],
  ['vertical-126', 'VERCADSCJADEGRESAN', '438']
];

const validationCases = [
  { id: 'normal-a', width: '2', height: '2', role: 'derive' },
  { id: 'normal-b', width: '2.4', height: '2.1', role: 'derive' },
  { id: 'minimum-regression', width: '1', height: '1', role: 'boundary' }
];

async function portalPrice(params) {
  const response = await fetch('http://127.0.0.1:8080/api/pentagrama-sync/price', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-HomeEasy-Token': process.env.BRIDGE_TOKEN
    },
    body: JSON.stringify({ params, options: { productDiscount: 0, pricingMode: 'account-discount' } })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.code || 'PENTAGRAMA_PRICE_FAILED');
  return Number(payload.result.total);
}

async function main() {
  const homeeasy = new HomeEasySyncClient();
  const catalog = await homeeasy.catalog({
    serviceKey: process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY,
    deviceId: 'vertical-review-certification',
    deviceName: 'Vertical Review Certification',
    platform: 'VPS',
    browser: 'Node'
  });
  const output = [];

  for (const [homeeasyId, productCode, groupCode] of candidates) {
    const source = catalog.products.find(product => product.id === homeeasyId);
    if (!source) {
      output.push({ homeeasyId, status: 'MISSING_HOMEEASY' });
      continue;
    }
    const portalCases = [];
    for (const sample of validationCases) {
      const pentagrama = await portalPrice({
        ProductCode: productCode,
        Quantity: 1,
        Width: sample.width,
        Height: sample.height,
        GroupCode: groupCode,
        calculationType: 'NormalProduct',
        Degrees: '',
        Panels: 0,
        Cabezal: '',
        ItemCodeFather: '',
        AssociationGroup: 'VERTELCA',
        Discount: 0
      });
      portalCases.push({ ...sample, pentagrama });
    }
    const deriveCases = portalCases.filter(item => item.role === 'derive');
    const proposedRate = Math.round(deriveCases.reduce((sum, item) => (
      sum + item.pentagrama / (Number(item.width) * Number(item.height))
    ), 0) / deriveCases.length * 100) / 100;
    const cases = portalCases.map(sample => {
      const reproduced = homeEasyRateCost(proposedRate, source, sample);
      const difference = Math.round(Math.abs(sample.pentagrama - reproduced) * 100) / 100;
      return { ...sample, reproduced, difference };
    });
    output.push({
      homeeasyId,
      productCode,
      groupCode,
      source: {
        row: source.row,
        reference: source.reference,
        rate: source.rate,
        minHeight: source.minHeight,
        minArea: source.minArea,
        method: source.method,
        promotional: source.promotional,
        extraDiscount: source.extraDiscount
      },
      proposedRate,
      cases,
      casesPassed: cases.filter(item => item.difference <= 0.02).length,
      maxDifference: Math.max(...cases.map(item => item.difference))
    });
  }

  const certified = output.filter(item => item.casesPassed === validationCases.length);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    cases: output.length * validationCases.length,
    pass: output.reduce((sum, item) => sum + Number(item.casesPassed || 0), 0),
    fail: output.reduce((sum, item) => sum + validationCases.length - Number(item.casesPassed || 0), 0),
    maxCertifiedDifference: Math.max(0, ...certified.map(item => item.maxDifference)),
    output
  }, null, 2));
  if (certified.length !== candidates.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ error: String(error.code || error.message || 'VERTICAL_VALIDATION_FAILED') }));
  process.exitCode = 1;
});
