'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HomeEasySyncClient } = require(path.join(__dirname, '..', 'homeeasy-sync'));
const { homeEasyRateCost } = require(path.join(__dirname, '..', 'strategies'));

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const targets = registry.products
  .filter(item => item.family === 'Sheer Elegance' && item.status === 'REVIEW_REQUIRED' && item.productCode)
  .map(item => ({
    homeeasyId: item.homeeasyId,
    reference: item.reference,
    productCode: String(item.productCode),
    groupCode: String(item.groupCode || '')
  }));

function round(n, p=2) {
  const f = 10 ** p;
  return Math.round(Number(n || 0) * f) / f;
}
function uniq(values) {
  return [...new Set(values.map(v => round(v, 1)))];
}
async function livePrice(target, width, height) {
  const response = await fetch(API + '/api/pentagrama-sync/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': TOKEN },
    body: JSON.stringify({
      params: {
        ProductCode: target.productCode,
        Quantity: 1,
        Width: String(width),
        Height: String(height),
        GroupCode: target.groupCode,
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
    total:Number(r.total || 0),
    basePrice:Number(r.basePrice || 0),
    distributorDiscount:Number(r.distributorDiscount || 0),
    vatRate:Number(r.vatRate || 0)
  };
}

async function heightLimit(target, width) {
  const cache = new Map();
  const probe = async h => {
    h = round(h,1);
    if (cache.has(h)) return cache.get(h);
    const p = await livePrice(target,width,h);
    cache.set(h,p);
    return p;
  };
  const low = await probe(1.3);
  if (!low.ok) return { status:'ERROR', error:low.code, tested:[...cache] };
  if (low.total <= 0) return { status:'ZERO_AT_MIN', firstZeroHeight:1.3, tested:[...cache] };

  let hiHeight = 2.5;
  let hi = await probe(hiHeight);
  if (!hi.ok) return { status:'ERROR', error:hi.code, tested:[...cache] };
  if (hi.total > 0) {
    for (const h of [3.0,3.5,4.0]) {
      hiHeight = h;
      hi = await probe(h);
      if (!hi.ok) return { status:'ERROR', error:hi.code, tested:[...cache] };
      if (hi.total === 0) break;
    }
  }
  if (hi.total > 0) {
    return { status:'POSITIVE_THROUGH_4M', lastPositiveHeight:4.0, tested:[...cache] };
  }

  let lo = 13;
  let hi10 = Math.round(hiHeight * 10);
  while (hi10 - lo > 1) {
    const mid = Math.floor((lo + hi10) / 2);
    const p = await probe(mid / 10);
    if (!p.ok) return { status:'ERROR', error:p.code, tested:[...cache] };
    if (p.total > 0) lo = mid;
    else hi10 = mid;
  }
  const lastPositiveHeight = lo / 10;
  const firstZeroHeight = hi10 / 10;
  const before = lastPositiveHeight > 1.3 ? await probe(lastPositiveHeight - 0.1) : null;
  const after = firstZeroHeight < hiHeight ? await probe(firstZeroHeight + 0.1) : null;
  const monotonic =
    (!before || (before.ok && before.total > 0)) &&
    (!after || (after.ok && after.total === 0));
  return {
    status:monotonic ? 'CUTOFF_FOUND' : 'NON_MONOTONIC',
    lastPositiveHeight,
    firstZeroHeight,
    tested:[...cache]
  };
}

function fitAreaModel(source, points) {
  const usable = points.filter(p => p.ok && p.total > 0);
  if (usable.length < 4) return { ok:false, reason:'INSUFFICIENT_POSITIVE_POINTS' };
  const discount = source.promotional ? (100 - Number(source.extraDiscount || 0)) / 100 : 1;
  let best = null;
  const minHeights = [0];
  for (let h=1.0; h<=2.5+1e-9; h+=0.1) minHeights.push(round(h,1));
  const minAreas = [0];
  for (let a=0.5; a<=5.0+1e-9; a+=0.1) minAreas.push(round(a,1));

  for (const minHeight of minHeights) {
    for (const minArea of minAreas) {
      const rates = usable.map(p => {
        const effective = Math.max(p.width * Math.max(p.height,minHeight), minArea);
        return p.total / (effective * discount);
      });
      if (rates.some(x => !Number.isFinite(x) || x <= 0)) continue;
      const spread = Math.max(...rates) - Math.min(...rates);
      const proposedRate = round(rates.reduce((s,x)=>s+x,0)/rates.length,2);
      const modelSource = { ...source, minHeight, minArea };
      const reproduced = usable.map(p => {
        const value = homeEasyRateCost(proposedRate,modelSource,p);
        return { id:p.id, expected:round(p.total,2), reproduced:value, difference:round(Math.abs(p.total-value),2) };
      });
      const maxDifference = Math.max(...reproduced.map(x=>x.difference));
      const candidate = { minHeight, minArea, proposedRate, spread:round(spread,4), maxDifference, reproduced };
      if (!best || candidate.maxDifference < best.maxDifference ||
          (candidate.maxDifference === best.maxDifference && candidate.spread < best.spread)) best = candidate;
    }
  }
  if (!best) return { ok:false, reason:'NO_MODEL' };
  return { ok:best.maxDifference <= 0.02, ...best };
}

(async () => {
  const homeeasy = new HomeEasySyncClient();
  const catalog = await homeeasy.catalog({
    serviceKey: process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY,
    deviceId: 'sheer-model-diagnostic',
    deviceName: 'Sheer Model Diagnostic',
    platform: 'VPS',
    browser: 'Node'
  });
  const sourceById = new Map((catalog.products || []).map(p => [String(p.id),p]));

  const rows = [];
  let priceReads = 0;

  for (const target of targets) {
    const source = sourceById.get(String(target.homeeasyId));
    if (!source) {
      rows.push({ ...target, status:'SOURCE_MISSING' });
      continue;
    }

    const limitA = await heightLimit(target,1.0);
    const limitB = await heightLimit(target,1.8);
    priceReads += limitA.tested?.length || 0;
    priceReads += limitB.tested?.length || 0;

    const cutoffA = limitA.status === 'CUTOFF_FOUND' ? limitA.lastPositiveHeight : null;
    const cutoffB = limitB.status === 'CUTOFF_FOUND' ? limitB.lastPositiveHeight : null;
    const widthIndependentLimit =
      limitA.status === limitB.status &&
      (limitA.status === 'POSITIVE_THROUGH_4M' ||
       (limitA.status === 'CUTOFF_FOUND' && Math.abs(cutoffA-cutoffB) <= 0.1));

    const knownLimit = widthIndependentLimit && limitA.status === 'CUTOFF_FOUND'
      ? Math.min(cutoffA,cutoffB)
      : null;

    const safeHigh = knownLimit ? Math.max(1.3, Math.min(1.8, knownLimit - 0.1)) : 1.8;
    const heights = uniq([1.3, safeHigh]);
    const dimensions = [
      [0.8,heights[0]],[1.0,heights[0]],[1.4,heights[0]],[1.8,heights[0]],
      [1.0,heights[1]],[1.4,heights[1]]
    ];

    const points = [];
    for (let i=0;i<dimensions.length;i++) {
      const [width,height] = dimensions[i];
      const p = await livePrice(target,width,height);
      priceReads += 1;
      points.push({ id:'p'+(i+1), width, height, ...p });
    }

    const model = fitAreaModel(source,points);
    const currentRate = Number(source.rate || 0);
    const percentChange = model.proposedRate && currentRate
      ? round(((model.proposedRate-currentRate)/currentRate)*100,2)
      : null;

    let status = 'REVIEW_REQUIRED';
    if (!widthIndependentLimit) status = 'LIMIT_NOT_REPRODUCIBLE';
    else if (limitA.status === 'POSITIVE_THROUGH_4M') status = 'LIMIT_ABOVE_4M_UNRESOLVED';
    else if (!model.ok) status = 'PRICE_MODEL_NOT_REPRODUCIBLE';
    else status = 'MODEL_CERTIFIABLE';

    rows.push({
      ...target,
      status,
      current: {
        rate:currentRate,
        minHeight:Number(source.minHeight || 0),
        minArea:Number(source.minArea || 0)
      },
      proposed: model.proposedRate ? {
        rate:model.proposedRate,
        minHeight:model.minHeight,
        minArea:model.minArea,
        maxHeight:knownLimit,
        percentChange
      } : null,
      priceModel: {
        ok:Boolean(model.ok),
        maxDifference:model.maxDifference ?? null,
        spread:model.spread ?? null
      },
      limits: {
        width10:{ status:limitA.status,lastPositiveHeight:limitA.lastPositiveHeight ?? null,firstZeroHeight:limitA.firstZeroHeight ?? null },
        width18:{ status:limitB.status,lastPositiveHeight:limitB.lastPositiveHeight ?? null,firstZeroHeight:limitB.firstZeroHeight ?? null },
        widthIndependent:widthIndependentLimit
      },
      points: points.map(p=>({id:p.id,width:p.width,height:p.height,total:p.total ?? null,ok:p.ok,code:p.code || null}))
    });
  }

  const counts = rows.reduce((acc,row)=>{ acc[row.status]=(acc[row.status]||0)+1; return acc; },{});
  console.log(JSON.stringify({
    summary:{ targets:rows.length, priceReads, counts },
    rows
  }));
})().catch(error => {
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_MODEL_DIAGNOSTIC_FAILED')}));
  process.exitCode=1;
});
