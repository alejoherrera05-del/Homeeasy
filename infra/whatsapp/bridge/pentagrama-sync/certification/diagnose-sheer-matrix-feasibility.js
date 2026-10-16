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

const wanted = ['Screen Clark', 'Romantic', 'Fener', 'Night'];
const targets = wanted.map(name => pool.find(item => item.reference === name)).filter(Boolean);

const WIDTHS = [0.8,1.0,1.2,1.4,1.6,1.8,2.0,2.2,2.4];
const HEIGHTS = [1.3,1.5,1.7,1.9,2.1,2.3,2.5];

async function livePrice(target, width, height) {
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
    total:Math.round(Number(r.total || 0) * 100) / 100,
    basePrice:Math.round(Number(r.basePrice || 0) * 100) / 100
  };
}

function eq(a,b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 0.02;
}

(async () => {
  const rows = [];
  let reads = 0;

  for (const target of targets) {
    const matrix = [];
    let errors = 0;

    for (const height of HEIGHTS) {
      const line = [];
      for (const width of WIDTHS) {
        const p = await livePrice(target,width,height);
        reads += 1;
        if (!p.ok) errors += 1;
        line.push({ width,height,...p });
      }
      matrix.push(line);
    }

    const positive = matrix.flat().filter(p => p.ok && p.total > 0);
    const zero = matrix.flat().filter(p => p.ok && p.total === 0);
    const uniquePrices = [...new Set(positive.map(p => p.total.toFixed(2)))];

    let horizontalPairs = 0, horizontalEqual = 0;
    for (const line of matrix) {
      for (let i=1;i<line.length;i++) {
        const a=line[i-1], b=line[i];
        if (a.ok && b.ok && a.total>0 && b.total>0) {
          horizontalPairs += 1;
          if (eq(a.total,b.total)) horizontalEqual += 1;
        }
      }
    }

    let verticalPairs = 0, verticalEqual = 0;
    for (let y=1;y<matrix.length;y++) {
      for (let x=0;x<WIDTHS.length;x++) {
        const a=matrix[y-1][x], b=matrix[y][x];
        if (a.ok && b.ok && a.total>0 && b.total>0) {
          verticalPairs += 1;
          if (eq(a.total,b.total)) verticalEqual += 1;
        }
      }
    }

    rows.push({
      reference:target.reference,
      productCode:target.productCode,
      groupCode:target.groupCode,
      positivePoints:positive.length,
      zeroPoints:zero.length,
      errorPoints:errors,
      uniquePositivePrices:uniquePrices.length,
      priceReuseRatio:positive.length ? Math.round((1 - uniquePrices.length/positive.length)*10000)/100 : null,
      horizontalEqualPct:horizontalPairs ? Math.round(horizontalEqual/horizontalPairs*10000)/100 : null,
      verticalEqualPct:verticalPairs ? Math.round(verticalEqual/verticalPairs*10000)/100 : null,
      grid: matrix.map((line,idx)=>({
        height:HEIGHTS[idx],
        totals:line.map(p=>p.ok ? p.total : null)
      }))
    });
  }

  console.log(JSON.stringify({
    summary:{
      references:rows.length,
      reads,
      grid:{widths:WIDTHS,heights:HEIGHTS}
    },
    rows
  }));
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_MATRIX_FEASIBILITY_FAILED')}));
  process.exitCode=1;
});
