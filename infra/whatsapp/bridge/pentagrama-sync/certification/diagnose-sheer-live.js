'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'catalog-certifications.json'),
  'utf8'
));

const targets = registry.products
  .filter(item => item.family === 'Sheer Elegance' && item.status === 'REVIEW_REQUIRED' && item.productCode)
  .map(item => ({
    homeeasyId: item.homeeasyId,
    reference: item.reference,
    productCode: String(item.productCode),
    groupCode: String(item.groupCode || '')
  }));

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.Data)) return value.Data;
  if (Array.isArray(value && value.data)) return value.data;
  return [];
}
function text(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function first(item, names) {
  for (const name of names) if (item && item[name] != null && text(item[name])) return item[name];
  return '';
}
function categoryView(item) {
  return {
    code: text(first(item, ['Code','code','Id','id','CategoryCode','categoryCode'])),
    name: text(first(item, ['Name','name','Description','description','CategoryName','categoryName'])),
    levels: Math.max(1, Number(first(item, ['Levels','levels','LevelCount','levelCount']) || 1))
  };
}
function productView(item, pathNames, pathCodes) {
  return {
    name: text(first(item, ['ProductName','productName','Name','name','Description','description'])),
    productCode: text(first(item, ['ProductCode','productCode','Code','code'])),
    groupCode: text(first(item, ['GroupCode','groupCode','Group','group'])),
    associationGroup: text(first(item, ['GrupAsoc','grupAsoc','AssociationGroup','associationGroup'])),
    primaryGroup: text(first(item, ['PrimaryGroup','primaryGroup'])),
    calculationType: text(first(item, ['CalculationType','calculationType'])),
    unit: text(first(item, ['UnidadMedida','unidadMedida','Unit','unit'])),
    discount: Number(first(item, ['Discount','discount']) || 0),
    encode: text(first(item, ['Encode','encode'])),
    path: pathNames,
    categoryCodes: pathCodes
  };
}
function categoryParams(path, includeLevel) {
  const params = {};
  if (includeLevel) params.level = path.length + 1;
  path.forEach((item, index) => { params['Category' + (index + 1)] = item.code; });
  return params;
}
async function catalog(operation, params) {
  const response = await fetch(API + '/api/pentagrama-sync/catalog', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-HomeEasy-Token': TOKEN
    },
    body: JSON.stringify({ operation, params: params || {} })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.code || 'PENTAGRAMA_CATALOG_FAILED');
    error.code = payload.code;
    throw error;
  }
  return payload.result;
}

(async () => {
  const roots = listOf(await catalog('categories', { level: 1 }))
    .map(categoryView)
    .filter(item => item.code);

  const root = roots.find(item => {
    const n = item.name.toUpperCase();
    return n.includes('SHEER') && n.includes('ELEGANCE');
  });

  if (!root) {
    console.log(JSON.stringify({ ok: false, code: 'SHEER_ROOT_NOT_FOUND', roots: roots.map(r => r.name) }, null, 2));
    process.exitCode = 1;
    return;
  }

  const targetCodes = new Set(targets.map(item => item.productCode.toUpperCase()));
  const found = new Map();
  const queue = [[root]];
  const seen = new Set();
  let requests = 1;

  while (queue.length) {
    const pathItems = queue.shift();
    const signature = pathItems.map(item => item.code).join('>');
    if (seen.has(signature)) continue;
    seen.add(signature);

    if (pathItems.length < root.levels) {
      const children = listOf(await catalog('categories', categoryParams(pathItems, true)))
        .map(categoryView)
        .filter(item => item.code);
      requests += 1;
      if (children.length) {
        children.forEach(child => queue.push([...pathItems, child]));
        continue;
      }
    }

    const rawProducts = listOf(await catalog('products', categoryParams(pathItems, false)));
    requests += 1;
    for (const raw of rawProducts) {
      const product = productView(
        raw,
        pathItems.map(item => item.name),
        pathItems.map(item => item.code)
      );
      if (!targetCodes.has(product.productCode.toUpperCase())) continue;
      const key = product.productCode.toUpperCase();
      if (!found.has(key)) found.set(key, []);
      found.get(key).push(product);
    }
  }

  const results = targets.map(target => ({
    ...target,
    live: found.get(target.productCode.toUpperCase()) || []
  }));

  const summary = {
    ok: true,
    root: root.name,
    requests,
    targets: targets.length,
    exactLiveSingle: results.filter(item => item.live.length === 1).length,
    ambiguousLive: results.filter(item => item.live.length > 1).length,
    missingLive: results.filter(item => item.live.length === 0).length
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: String(error.code || error.message || 'SHEER_DIAGNOSTIC_FAILED')
  }));
  process.exitCode = 1;
});
