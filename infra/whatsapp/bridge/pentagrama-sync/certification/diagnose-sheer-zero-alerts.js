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

const wanted = ['Screen Eco', 'Screen Clark', 'Romantic'];
const targets = wanted.map(name => all.find(item => item.reference === name)).filter(Boolean);
const cases = [
  { id: 'small', width: 1.0, height: 1.3 },
  { id: 'mid', width: 1.5, height: 1.8 },
  { id: 'large', width: 2.0, height: 2.0 },
  { id: 'wide', width: 2.4, height: 2.1 }
];

async function post(route, body) {
  const response = await fetch(API + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': TOKEN },
    body: JSON.stringify(body)
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  return { response, payload };
}

async function price(target, sample) {
  const { response, payload } = await post('/api/pentagrama-sync/price', {
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
  });
  if (!response.ok || !payload || !payload.ok) return { ok:false, code:String(payload && (payload.code || payload.error) || 'PRICE_FAILED') };
  return { ok:true, total:Number(payload.result && payload.result.total || 0), basePrice:Number(payload.result && payload.result.basePrice || 0) };
}

async function alerts(target, sample) {
  const params = {
    ProductCode: String(target.productCode),
    Quantity: 1,
    Width: String(sample.width),
    Height: String(sample.height),
    GroupCode: String(target.groupCode || ''),
    calculationType: 'NormalProduct',
    CalculationType: 'NormalProduct',
    Group: 'SHEERSTD',
    AssociationGroup: 'SHEERSTD',
    Discount: 0,
    Degrees: '',
    Panels: 0,
    Cabezal: '',
    ItemCodeFather: ''
  };
  const { response, payload } = await post('/api/pentagrama-sync/catalog', { operation:'alerts', params });
  if (!response.ok || !payload || !payload.ok) return { ok:false, code:String(payload && (payload.code || payload.error) || 'ALERT_FAILED') };
  return { ok:true, result:payload.result };
}

function compact(value, depth=0) {
  if (depth > 4) return '[depth]';
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0,12).map(v=>compact(v, depth+1));
  if (typeof value === 'object') {
    const out={};
    for (const [k,v] of Object.entries(value).slice(0,25)) out[k]=compact(v, depth+1);
    return out;
  }
  return String(value);
}

(async () => {
  const rows=[];
  for (const target of targets) {
    const samples=[];
    for (const sample of cases) {
      const p=await price(target,sample);
      let a=null;
      if (p.ok && p.total===0) a=await alerts(target,sample);
      samples.push({ ...sample, price:p, alerts:a ? { ok:a.ok, code:a.code || null, result:compact(a.result) } : null });
    }
    rows.push({ reference:target.reference, productCode:target.productCode, groupCode:target.groupCode, samples });
  }
  console.log(JSON.stringify({ summary:{references:rows.length,casesPerReference:cases.length}, rows }));
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_ZERO_ALERT_DIAGNOSTIC_FAILED')}));
  process.exitCode=1;
});
