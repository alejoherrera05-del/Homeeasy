'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const targets = registry.products
  .filter(item =>
    item.family === 'Sheer Elegance' &&
    item.status === 'REVIEW_REQUIRED' &&
    item.productCode
  )
  .map(item => ({
    homeeasyId: item.homeeasyId,
    reference: item.reference,
    productCode: String(item.productCode),
    groupCode: String(item.groupCode || '')
  }));

const WIDTH = 1.4;
const MIN_H = 1.3;
const MAX_H = 2.5;
const STEP = 0.1;

async function readPrice(target, height) {
  const response = await fetch(API + '/api/pentagrama-sync/price', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-HomeEasy-Token': TOKEN
    },
    body: JSON.stringify({
      params: {
        ProductCode: target.productCode,
        Quantity: 1,
        Width: String(WIDTH),
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
    return { ok: false, code: String(payload && (payload.code || payload.error) || 'PRICE_FAILED') };
  }
  return {
    ok: true,
    total: Number(payload.result && payload.result.total || 0),
    basePrice: Number(payload.result && payload.result.basePrice || 0)
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

(async () => {
  const rows = [];
  let reads = 0;

  for (const target of targets) {
    const cache = new Map();
    const probe = async (height) => {
      const h = round1(height);
      if (cache.has(h)) return cache.get(h);
      const result = await readPrice(target, h);
      reads += 1;
      cache.set(h, result);
      return result;
    };

    const low = await probe(MIN_H);
    const high = await probe(MAX_H);

    let status = 'UNKNOWN';
    let lastPositiveHeight = null;
    let firstZeroHeight = null;

    if (!low.ok || !high.ok) {
      status = 'ERROR';
    } else if (low.total <= 0) {
      status = 'ZERO_AT_MIN';
      firstZeroHeight = MIN_H;
    } else if (high.total > 0) {
      status = 'POSITIVE_THROUGH_MAX';
      lastPositiveHeight = MAX_H;
    } else {
      // Monotonic binary search on the 0.1 m grid.
      let lo = Math.round(MIN_H * 10);
      let hi = Math.round(MAX_H * 10);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const h = mid / 10;
        const p = await probe(h);
        if (!p.ok) {
          status = 'ERROR';
          break;
        }
        if (p.total > 0) lo = mid;
        else hi = mid;
      }
      if (status !== 'ERROR') {
        lastPositiveHeight = lo / 10;
        firstZeroHeight = hi / 10;

        // Verify local monotonicity around the detected edge.
        const before = lastPositiveHeight - STEP >= MIN_H ? await probe(lastPositiveHeight - STEP) : null;
        const after = firstZeroHeight + STEP <= MAX_H ? await probe(firstZeroHeight + STEP) : null;
        const monotonicOk =
          (!before || (before.ok && before.total > 0)) &&
          (!after || (after.ok && after.total === 0));
        status = monotonicOk ? 'CUTOFF_FOUND' : 'NON_MONOTONIC';
      }
    }

    const points = Array.from(cache.entries())
      .sort((a,b) => a[0]-b[0])
      .map(([height, value]) => ({ height, ...value }));

    rows.push({
      ...target,
      width: WIDTH,
      status,
      lastPositiveHeight,
      firstZeroHeight,
      tested: points
    });
  }

  const cutoffGroups = {};
  for (const row of rows) {
    const key =
      row.status === 'CUTOFF_FOUND' ? String(row.lastPositiveHeight) :
      row.status;
    if (!cutoffGroups[key]) cutoffGroups[key] = [];
    cutoffGroups[key].push(row.reference);
  }

  console.log(JSON.stringify({
    summary: {
      targets: rows.length,
      reads,
      errors: rows.filter(r => r.status === 'ERROR').length,
      nonMonotonic: rows.filter(r => r.status === 'NON_MONOTONIC').length,
      zeroAtMin: rows.filter(r => r.status === 'ZERO_AT_MIN').length,
      positiveThrough25: rows.filter(r => r.status === 'POSITIVE_THROUGH_MAX').length,
      cutoffsFound: rows.filter(r => r.status === 'CUTOFF_FOUND').length
    },
    cutoffGroups,
    rows
  }));
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: String(error.code || error.message || 'SHEER_ALL_HEIGHT_LIMITS_FAILED')
  }));
  process.exitCode = 1;
});
