'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const pool = registry.products.filter(item =>
  item.family === 'Sheer Elegance' &&
  item.status === 'REVIEW_REQUIRED' &&
  item.productCode
);

const wanted = ['Screen Eco', 'Screen Clark', 'Fener', 'Romantic'];
const targets = wanted.map(name => pool.find(item => item.reference === name)).filter(Boolean);
const samples = [
  { id: 'a', width: 1.0, height: 1.3 },
  { id: 'b', width: 1.4, height: 1.3 },
  { id: 'c', width: 1.8, height: 1.3 },
  { id: 'd', width: 2.2, height: 1.3 },
  { id: 'e', width: 1.0, height: 2.0 },
  { id: 'f', width: 1.4, height: 2.0 },
  { id: 'g', width: 1.8, height: 2.0 },
  { id: 'h', width: 2.2, height: 2.0 }
];

async function price(target, sample) {
  const response = await fetch(API + '/api/pentagrama-sync/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': TOKEN },
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
      options: { productDiscount: 0, pricingMode: 'account-discount' }
    })
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !payload || !payload.ok) {
    return { ok:false, code:String(payload && (payload.code || payload.error) || 'PRICE_FAILED') };
  }
  const r = payload.result || {};
  return {
    ok:true,
    basePrice:Number(r.basePrice || 0),
    distributorDiscount:Number(r.distributorDiscount || 0),
    vatRate:Number(r.vatRate || 0),
    subtotal:Number(r.subtotal || 0),
    total:Number(r.total || 0)
  };
}

function round(n, p=2) {
  const f = 10 ** p;
  return Math.round(Number(n || 0) * f) / f;
}

(async () => {
  const rows = [];
  for (const target of targets) {
    const points = [];
    for (const sample of samples) {
      const p = await price(target, sample);
      const area = sample.width * sample.height;
      points.push({
        ...sample,
        area: round(area, 3),
        ...p,
        totalPerM2: p.ok && p.total > 0 ? round(p.total / area, 2) : null,
        basePerM2: p.ok && p.basePrice > 0 ? round(p.basePrice / area, 2) : null
      });
    }
    const positive = points.filter(x => x.ok && x.total > 0);
    const perM2 = positive.map(x => x.totalPerM2);
    const min = perM2.length ? Math.min(...perM2) : null;
    const max = perM2.length ? Math.max(...perM2) : null;
    rows.push({
      reference: target.reference,
      homeeasyId: target.homeeasyId,
      productCode: target.productCode,
      groupCode: target.groupCode,
      currentHomeEasyRate: Number(target.rate || 0),
      positive: positive.length,
      zero: points.filter(x => x.ok && x.total === 0).length,
      errors: points.filter(x => !x.ok).length,
      effectivePerM2SpreadPct: min && max ? round(((max - min) / min) * 100, 2) : null,
      points
    });
  }
  console.log(JSON.stringify({
    summary: {
      references: rows.length,
      reads: rows.length * samples.length,
      allRequestsOk: rows.every(r => r.errors === 0)
    },
    rows
  }));
})().catch(error => {
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_BOUNDARY_DIAGNOSTIC_FAILED')}));
  process.exitCode=1;
});
