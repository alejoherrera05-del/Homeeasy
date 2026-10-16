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

function controlsFromHtml(html) {
  const source = String(html || '');
  const controls = [];
  const inputRe = /<input\b[^>]*>/gi;
  const selectRe = /<select\b[^>]*>[\s\S]*?<\/select>/gi;
  const textareaRe = /<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi;
  let m;

  while ((m = inputRe.exec(source))) {
    const tag = m[0];
    const name = attr(tag, 'name') || attr(tag, 'id');
    if (!name) continue;
    controls.push({
      kind: 'input',
      name,
      type: attr(tag, 'type') || 'text',
      value: attr(tag, 'value'),
      checked: /\bchecked\b/i.test(tag)
    });
  }

  while ((m = selectRe.exec(source))) {
    const block = m[0];
    const open = block.match(/<select\b[^>]*>/i)?.[0] || '';
    const name = attr(open, 'name') || attr(open, 'id');
    if (!name) continue;
    const selected = block.match(/<option\b[^>]*selected[^>]*>[\s\S]*?<\/option>/i)?.[0] || '';
    const firstOption = block.match(/<option\b[^>]*>[\s\S]*?<\/option>/i)?.[0] || '';
    const option = selected || firstOption;
    controls.push({
      kind: 'select',
      name,
      value: attr(option, 'value'),
      text: option.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    });
  }

  while ((m = textareaRe.exec(source))) {
    const block = m[0];
    const open = block.match(/<textarea\b[^>]*>/i)?.[0] || '';
    const name = attr(open, 'name') || attr(open, 'id');
    if (!name) continue;
    controls.push({
      kind: 'textarea',
      name,
      value: block.replace(/^<textarea\b[^>]*>/i, '').replace(/<\/textarea>$/i, '').trim()
    });
  }

  return controls;
}

function cleanControls(controls) {
  const ignored = /token|requestverification|distdiscount|csrf/i;
  return controls
    .filter(item => !ignored.test(item.name))
    .map(item => ({
      kind: item.kind,
      name: item.name,
      ...(item.type ? { type: item.type } : {}),
      ...(item.value !== '' ? { value: item.value } : {}),
      ...(item.text ? { text: item.text } : {}),
      ...(item.checked ? { checked: true } : {})
    }));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
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

    let html = '';
    let defaults = null;
    let attributesError = null;
    let defaultsError = null;

    try { html = await catalog('attributes', params); }
    catch (error) { attributesError = String(error.code || error.message); }

    try { defaults = await catalog('defaults', params); }
    catch (error) { defaultsError = String(error.code || error.message); }

    const controls = cleanControls(controlsFromHtml(html));
    const signaturePayload = stable({
      controlNames: controls.map(item => item.name).sort(),
      defaults
    });
    const signature = crypto.createHash('sha256').update(JSON.stringify(signaturePayload)).digest('hex').slice(0, 10);

    rows.push({
      ...target,
      signature,
      controls,
      defaults,
      attributesError,
      defaultsError
    });
  }

  const groups = {};
  for (const row of rows) {
    if (!groups[row.signature]) groups[row.signature] = [];
    groups[row.signature].push(row);
  }

  const output = {
    summary: {
      targets: rows.length,
      attributesOk: rows.filter(row => !row.attributesError).length,
      defaultsOk: rows.filter(row => !row.defaultsError).length,
      signatures: Object.keys(groups).length
    },
    signatures: Object.entries(groups).map(([signature, items]) => ({
      signature,
      count: items.length,
      references: items.map(item => item.reference),
      representative: {
        homeeasyId: items[0].homeeasyId,
        productCode: items[0].productCode,
        groupCode: items[0].groupCode,
        controls: items[0].controls,
        defaults: items[0].defaults,
        attributesError: items[0].attributesError,
        defaultsError: items[0].defaultsError
      }
    }))
  };

  console.log(JSON.stringify(output));
})().catch(error => {
  console.error(JSON.stringify({ ok: false, code: String(error.code || error.message || 'SHEER_CONFIGURATION_DIAGNOSTIC_FAILED') }));
  process.exitCode = 1;
});
