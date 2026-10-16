'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

async function catalog(operation, params) {
  const response = await fetch(API + '/api/pentagrama-sync/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': TOKEN },
    body: JSON.stringify({ operation, params })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.code || 'PENTAGRAMA_CATALOG_FAILED');
    error.code = payload.code || 'PENTAGRAMA_CATALOG_FAILED';
    throw error;
  }
  return payload.result;
}

function attr(tag, name) {
  const m = String(tag).match(new RegExp('\\b' + name + '=["\\\']([^"\\\']*)["\\\']', 'i'));
  return m ? m[1] : '';
}
function cleanText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function selectDetails(html) {
  const out = [];
  const re = /<select\b[^>]*>[\s\S]*?<\/select>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const block = m[0];
    const open = block.match(/<select\b[^>]*>/i)?.[0] || '';
    const name = attr(open, 'name') || attr(open, 'id');
    if (!name) continue;
    const options = [];
    const ore = /<option\b[^>]*>[\s\S]*?<\/option>/gi;
    let om;
    while ((om = ore.exec(block))) {
      const tag = om[0];
      options.push({
        value: attr(tag, 'value'),
        text: cleanText(tag),
        selected: /\bselected\b/i.test(tag)
      });
    }
    out.push({
      name,
      optionsCount: options.length,
      selected: options.filter(x => x.selected),
      sample: options.slice(0, 8)
    });
  }
  return out;
}
function hiddenDetails(html) {
  const out = [];
  const re = /<input\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const type = (attr(tag, 'type') || '').toLowerCase();
    if (type !== 'hidden') continue;
    const name = attr(tag, 'name') || attr(tag, 'id');
    if (!name || /token|requestverification|csrf/i.test(name)) continue;
    out.push({ name, value: attr(tag, 'value') });
  }
  return out;
}
function signatureOf(selects, hidden) {
  const value = JSON.stringify({
    selects: selects.map(x => x.name).sort(),
    hidden: hidden.map(x => x.name).sort()
  });
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

(async () => {
  const rows = [];
  for (const target of targets) {
    const params = {
      ProductCode: target.productCode,
      Group: 'SHEERSTD',
      GroupCode: target.groupCode,
      LineNumber: '',
      PrimaryGroup: '',
      Discount: 0,
      CalculationType: 'NormalProduct',
      Modified: ''
    };
    try {
      const html = await catalog('attributes', params);
      const selects = selectDetails(html);
      const hidden = hiddenDetails(html);
      rows.push({
        ...target,
        ok: true,
        signature: signatureOf(selects, hidden),
        selects,
        hidden
      });
    } catch (error) {
      rows.push({ ...target, ok: false, error: String(error.code || error.message) });
    }
  }

  const groups = new Map();
  for (const row of rows.filter(x => x.ok)) {
    if (!groups.has(row.signature)) groups.set(row.signature, []);
    groups.get(row.signature).push(row);
  }

  console.log(JSON.stringify({
    summary: {
      targets: rows.length,
      attributesOk: rows.filter(x => x.ok).length,
      errors: rows.filter(x => !x.ok).length,
      signatures: groups.size
    },
    groups: Array.from(groups.entries()).map(([signature, items]) => ({
      signature,
      count: items.length,
      references: items.map(x => x.reference),
      representative: {
        reference: items[0].reference,
        productCode: items[0].productCode,
        groupCode: items[0].groupCode,
        selects: items[0].selects,
        hidden: items[0].hidden
      }
    })),
    errors: rows.filter(x => !x.ok)
  }));
})().catch(error => {
  console.error(JSON.stringify({ ok: false, code: String(error.code || error.message || 'SHEER_ATTRIBUTES_DIAGNOSTIC_FAILED') }));
  process.exitCode = 1;
});
