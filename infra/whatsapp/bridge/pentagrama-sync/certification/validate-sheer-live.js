'use strict';

const path = require('node:path');
const bridgeRoot = process.cwd();
const { HomeEasySyncClient } = require(path.join(bridgeRoot, 'pentagrama-sync/homeeasy-sync'));
const { homeEasyRateCost } = require(path.join(bridgeRoot, 'pentagrama-sync/strategies'));

const candidates = [
  ['sheer-131', 'SHEELESTDSCEBRLI', '1088'],
  ['sheer-132', 'SHEELESTDSESCCLAL', '1235'],
  ['sheer-133', 'SHEELESTDSESCDIGR', '1241'],
  ['sheer-134', 'SHEELESTDSESCJALOBE', '1238'],
  ['sheer-135', 'SHEELESTDSCBIWHBR', '1241'],
  ['sheer-136', 'SHEELESTDSESCJAALCR', '1238'],
  ['sheer-137', 'SHEELESTDSESCLOBESI', '1279'],
  ['sheer-138', 'SHEELESTDSCGLWHBE', '1090'],
  ['sheer-139', 'SHEELESTDSESCJASUBE', '1235'],
  ['sheer-140', 'SHEELESTDSCHYBLA', '1396'],
  ['sheer-143', 'SHEELESTDFECH', '879'],
  ['sheer-144', 'SHEELESTDFIBEB901035', '880'],
  ['sheer-145', 'SHEELESTDGLAGR', '1089'],
  ['sheer-146', 'SHEELESTDLEBE', '1313'],
  ['sheer-147', 'SHEELESTDMARBL', '1096'],
  ['sheer-148', 'SHEELESTDMA901062', '873'],
  ['sheer-150', 'SHEELESTDRO901077', '876'],
  ['sheer-151', 'SHEELESTDSEROBRBL', '883'],
  ['sheer-152', 'SHEELESTDSEROCUBR', '884'],
  ['sheer-153', 'SHEELESTDSESPBLSI', '881'],
  ['sheer-154', 'SHEELESTDSETRSPBE', '885'],
  ['sheer-156', 'SHEELESTDDIMBE', '1083'],
  ['sheer-157', 'SHEELESTDHOIV', '1085'],
  ['sheer-158', 'SHEELSTDBONI90127007', '888'],
  ['sheer-159', 'SHEELSTDBONI90127003', '887'],
  ['sheer-160', 'SHEELSTDBOSEEXNBB', '1352']
];

const validationCases = [
  { id: 'normal-a', width: '2', height: '2', role: 'derive' },
  { id: 'normal-b', width: '2.4', height: '2.1', role: 'derive' },
  { id: 'minimum-regression', width: '1', height: '1.3', role: 'boundary' }
];

async function main() {
  const homeeasy = new HomeEasySyncClient();
  const catalog = await homeeasy.catalog({
    serviceKey: process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY,
    deviceId: 'incremental-certification',
    deviceName: 'Incremental Certification',
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
      const params = {
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
        AssociationGroup: 'SHEERSTD',
        Discount: 0
      };
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
      portalCases.push({ ...sample, pentagrama: Number(payload.result.total) });
    }
    const normalCases = portalCases.filter(item => item.role === 'derive');
    const proposedRate = Math.round(normalCases.reduce((sum, item) => (
      sum + item.pentagrama / (Number(item.width) * Number(item.height))
    ), 0) / normalCases.length * 100) / 100;
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
  const failed = output.filter(item => item.casesPassed !== validationCases.length);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    cases: output.length * validationCases.length,
    pass: output.reduce((sum, item) => sum + Number(item.casesPassed || 0), 0),
    fail: output.reduce((sum, item) => sum + validationCases.length - Number(item.casesPassed || 0), 0),
    certified: certified.map(item => ({
      homeeasyId: item.homeeasyId,
      proposedRate: item.proposedRate,
      maxDifference: item.maxDifference,
      source: item.source
    })),
    maxCertifiedDifference: Math.max(0, ...certified.map(item => item.maxDifference)),
    failed
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ error: String(error.code || error.message || 'SHEER_VALIDATION_FAILED') }));
  process.exitCode = 1;
});
