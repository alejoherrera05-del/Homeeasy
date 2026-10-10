'use strict';

const path = require('node:path');
const bridgeRoot = process.cwd();
const { HomeEasySyncClient } = require(path.join(bridgeRoot, 'pentagrama-sync/homeeasy-sync'));
const { homeEasyRateCost } = require(path.join(bridgeRoot, 'pentagrama-sync/strategies'));

const candidates = [
  ['panel-78', 'PANBOMA195', '378'],
  ['panel-79', 'PANTRCA500', '615'],
  ['panel-81', 'PANTRRO68609000', '410'],
  ['panel-82', 'PANTRCL22405000', '399'],
  ['panel-84', 'PANSCTRE3EBO', '671'],
  ['panel-85', 'PANSCTRE1EBO', '671'],
  ['panel-86', 'PANSCLINDUN', '671'],
  ['panel-87', 'PANSCDIFASH', '671'],
  ['panel-88', 'PANSCESAS', '671'],
  ['panel-89', 'PANSCFAOF3WHBL', '671'],
  ['panel-90', 'PANSCSIBA5BL', '671'],
  ['panel-91', 'PANSCECCRYCRE', '385'],
  ['panel-92', 'PANSCJACPRICRBR', '385'],
  ['panel-93', 'PANSCPAPBE', '671'],
  ['panel-94', 'PANSCJADEQUEBAM', '671'],
  ['panel-95', 'PANSCJADEQUEBRWH', '671'],
  ['panel-96', 'PANSCJAC10047604', '385'],
  ['panel-97', 'PANSCJAC10047812', '385'],
  ['panel-98', 'PANSCJADEDEGRESAN', '671'],
  ['panel-99', 'PANSCJACSTYCHAL', '671'],
  ['panel-100', 'PANSCJAC10047404', '385'],
  ['panel-101', 'PANSCSPGLAN', '671'],
  ['panel-102', 'PANSCSPSTCOBR', '671'],
  ['panel-103', 'PANSCSPEXBR', '671'],
  ['panel-104', 'PANSCSPBABE', '671'],
  ['panel-105', 'PANSCULJANOFO', '385'],
  ['panel-106', 'PANSCSPNOGO', '671'],
  ['panel-107', 'PANSCSPAMMI', '671'],
  ['panel-108', 'PANSCSPGLAPE', '671']
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
        AssociationGroup: 'PANEL',
        Discount: 0
      };
      const response = await fetch('http://127.0.0.1:8080/api/pentagrama-sync/price', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HomeEasy-Token': process.env.BRIDGE_TOKEN
        },
        body: JSON.stringify({
          params,
          options: { productDiscount: 0, pricingMode: 'account-discount' }
        })
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
    certified: certified.map(item => item.homeeasyId),
    maxCertifiedDifference: Math.max(0, ...certified.map(item => item.maxDifference)),
    failed
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ error: String(error.code || error.message || 'PANEL_VALIDATION_FAILED') }));
  process.exitCode = 1;
});
