'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const all = registry.products.filter(item =>
  item.family === 'Sheer Elegance' &&
  item.status === 'REVIEW_REQUIRED' &&
  item.productCode
);

const wanted = ['Screen Eco', 'Screen Clark', 'Fener', 'Night B', 'Romantic'];
const targets = wanted.map(name => all.find(item => item.reference === name)).filter(Boolean);

const cases = [
  { id: 'small-a', width: 0.8, height: 1.3 },
  { id: 'small-b', width: 1.0, height: 1.3 },
  { id: 'mid-a', width: 1.2, height: 1.5 },
  { id: 'mid-b', width: 1.5, height: 1.8 },
  { id: 'large-a', width: 1.8, height: 2.0 },
  { id: 'large-b', width: 2.0, height: 2.0 },
  { id: 'large-c', width: 2.4, height: 2.1 }
];

async function price(target, sample) {
  const response = await fetch(API + '/api/pentagrama-sync/price', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-HomeEasy-Token': TOKEN
    },
    body: JSON.stringify({
      params: {
        ProductCode: String(target.productCode),
        Quantity: 1,
        Width: String(sample.width),
        Height: String(sample.height),
        GroupCode: String(target.groupCode || ''),
        calculationType: 'NormalProduct',
        Degrees: '',
        Panels: 0,
        Cabezal: '',
        ItemCodeFather: '',
        AssociationGroup: 'SHEERSTD',
        Group: 'SHEERSTD',
        Discount: 0
      },
      options: {
        productDiscount: 0,
        pricingMode: 'account-discount'
      }
    })
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !payload || !payload.ok) {
    return {
      ok: false,
      code: String(payload && (payload.code || payload.error) || 'PRICE_FAILED')
    };
  }
  const result = payload.result || {};
  return {
    ok: true,
    basePrice: Number(result.basePrice || 0),
    distributorDiscount: Number(result.distributorDiscount || 0),
    vatRate: Number(result.vatRate || 0),
    total: Number(result.total || 0)
  };
}

function round(value, places = 2) {
  const factor = Math.pow(10, places);
  return Math.round(Number(value || 0) * factor) / factor;
}

(async () => {
  const rows = [];
  for (const target of targets) {
    const values = [];
    for (const sample of cases) {
      const result = await price(target, sample);
      values.push({
        ...sample,
        area: round(sample.width * sample.height, 4),
        ...result,
        totalPerM2: result.ok && result.total > 0
          ? round(result.total / (sample.width * sample.height), 2)
          : null
      });
    }

    const positive = values.filter(item => item.ok && item.total > 0);
    rows.push({
      reference: target.reference,
      homeeasyId: target.homeeasyId,
      productCode: target.productCode,
      groupCode: target.groupCode,
      positiveCases: positive.length,
      zeroCases: values.filter(item => item.ok && item.total === 0).length,
      errors: values.filter(item => !item.ok).map(item => item.code),
      cases: values
    });
  }

  console.log(JSON.stringify({
    summary: {
      representatives: rows.length,
      casesPerRepresentative: cases.length,
      totalPriceReads: rows.length * cases.length
    },
    rows
  }));
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: String(error.code || error.message || 'SHEER_PRICE_LAW_DIAGNOSTIC_FAILED')
  }));
  process.exitCode = 1;
});
