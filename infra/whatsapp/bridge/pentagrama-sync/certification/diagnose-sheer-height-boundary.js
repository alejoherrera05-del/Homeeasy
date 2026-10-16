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
const heights = [1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0,2.1,2.2,2.3,2.4,2.5];
const width = 1.4;

async function price(target, height) {
  const response = await fetch(API + '/api/pentagrama-sync/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': TOKEN },
    body: JSON.stringify({
      params: {
        ProductCode: String(target.productCode),
        Quantity: 1,
        Width: String(width),
        Height: String(height),
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
    total:Number(r.total || 0)
  };
}

(async () => {
  const rows = [];
  for (const target of targets) {
    const points = [];
    for (const height of heights) {
      const p = await price(target, height);
      points.push({ height, ...p });
    }
    const positive = points.filter(p => p.ok && p.total > 0);
    const zero = points.filter(p => p.ok && p.total === 0);
    const errors = points.filter(p => !p.ok);

    let transition = null;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1], cur = points[i];
      if (prev.ok && cur.ok && prev.total > 0 && cur.total === 0) {
        transition = { lastPositiveHeight: prev.height, firstZeroHeight: cur.height };
        break;
      }
    }

    rows.push({
      reference: target.reference,
      productCode: target.productCode,
      groupCode: target.groupCode,
      width,
      positiveCount: positive.length,
      zeroCount: zero.length,
      errorCount: errors.length,
      transition,
      points
    });
  }

  console.log(JSON.stringify({
    summary: {
      references: rows.length,
      reads: rows.length * heights.length,
      allRequestsOk: rows.every(r => r.errorCount === 0)
    },
    rows
  }));
})().catch(error => {
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_HEIGHT_BOUNDARY_FAILED')}));
  process.exitCode=1;
});
