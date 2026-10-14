'use strict';

const fs = require('node:fs');

const BASE_URL = process.env.HOMEEASY_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = String(process.env.BRIDGE_TOKEN || '').trim();

if (!TOKEN) {
  console.error('ABORTADO: falta BRIDGE_TOKEN.');
  process.exit(1);
}

async function call(route, body) {
  const response = await fetch(BASE_URL + route, {
    method: 'POST',
    headers: {
      'X-HomeEasy-Token': TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    const error = new Error(data.error || data.code || ('HTTP ' + response.status));
    error.details = data;
    throw error;
  }
  return data.result;
}

async function catalog(operation, params = {}) {
  return call('/api/pentagrama-sync/catalog', { operation, params });
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.Data)) return value.Data;
  if (Array.isArray(value && value.data)) return value.data;
  return [];
}

function valueOf(item, names) {
  for (const name of names) {
    const value = item && item[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function categoryCode(item) {
  return String(valueOf(item, ['Code', 'code', 'Id', 'id', 'CategoryCode', 'categoryCode'])).trim();
}
function categoryName(item) {
  return String(valueOf(item, ['Name', 'name', 'Description', 'description', 'CategoryName', 'categoryName'])).trim();
}
function categoryLevels(item) {
  const n = Number(valueOf(item, ['Levels', 'levels', 'LevelCount', 'levelCount']));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function productView(item) {
  return {
    name: String(valueOf(item, ['ProductName', 'productName', 'Name', 'name', 'Description', 'description'])).trim(),
    productCode: String(valueOf(item, ['ProductCode', 'productCode', 'Code', 'code'])).trim(),
    groupCode: String(valueOf(item, ['GroupCode', 'groupCode', 'Group', 'group'])).trim(),
    associationGroup: String(valueOf(item, ['GrupAsoc', 'grupAsoc', 'AssociationGroup', 'associationGroup'])).trim(),
    primaryGroup: String(valueOf(item, ['PrimaryGroup', 'primaryGroup'])).trim(),
    calculationType: String(valueOf(item, ['CalculationType', 'calculationType'])).trim(),
    unit: String(valueOf(item, ['UnidadMedida', 'unidadMedida', 'Unit', 'unit'])).trim(),
    discount: Number(valueOf(item, ['Discount', 'discount']) || 0),
    encode: String(valueOf(item, ['Encode', 'encode'])).trim()
  };
}

function parseAttributes(html) {
  const source = String(html || '');
  const selects = [];

  for (const match of source.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const attr = key => (attrs.match(new RegExp('\\b' + key + '=["\\\']([^"\\\']*)["\\\']', 'i')) || [])[1] || '';
    const options = [];

    for (const option of body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const oa = option[1] || '';
      const oaVal = key => (oa.match(new RegExp('\\b' + key + '=["\\\']([^"\\\']*)["\\\']', 'i')) || [])[1] || '';
      const label = String(option[2] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!label || /seleccione/i.test(label)) continue;
      options.push({
        label,
        value: oaVal('value'),
        idAttributeValue: oaVal('idAttributeValues'),
        itemCode: oaVal('itemCode'),
        calculationType: oaVal('calculationType')
      });
    }

    if (!options.length) continue;
    selects.push({
      id: attr('id'),
      name: attr('name'),
      selectName: attr('selectName'),
      idAttribute: attr('idAttribute'),
      dependency: attr('dependency'),
      required: attr('Requerido') || attr('required'),
      options
    });
  }
  return selects;
}

async function leavesFor(pathItems, totalLevels) {
  if (pathItems.length >= totalLevels) return [pathItems];

  const params = { level: pathItems.length + 1 };
  pathItems.forEach((item, index) => { params['Category' + (index + 1)] = categoryCode(item); });

  const children = listOf(await catalog('categories', params));
  if (!children.length) return [pathItems];

  const leaves = [];
  for (const child of children) {
    leaves.push(...await leavesFor([...pathItems, child], totalLevels));
  }
  return leaves;
}

function typeOfPath(path) {
  const text = path.join(' > ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (text.includes('BLACK')) return 'BLACKOUT';
  if (text.includes('VELO')) return 'VELO';
  if (text.includes('TRASLUC')) return 'TRASLUCENTE';
  return 'OTRO';
}

async function main() {
  console.log('=== PENTAGRAMA · CORTINA RING · DISCOVERY SOLO LECTURA ===');

  const top = listOf(await catalog('categories', { level: 1 }));
  const ring = top.filter(item => /CORTINA\s+RING/i.test(categoryName(item)));

  console.log('Categorias nivel 1:', top.length);
  console.log('CORTINA RING encontrada:', ring.map(item => ({
    code: categoryCode(item),
    name: categoryName(item),
    levels: categoryLevels(item)
  })));

  if (!ring.length) {
    console.log('NO se encontro CORTINA RING en nivel 1.');
    return;
  }

  const products = [];
  const leavesSummary = [];

  for (const root of ring) {
    const leaves = await leavesFor([root], categoryLevels(root));
    for (const leaf of leaves) {
      const params = {};
      leaf.forEach((item, index) => { params['Category' + (index + 1)] = categoryCode(item); });
      const raw = listOf(await catalog('products', params));
      const path = leaf.map(categoryName).filter(Boolean);
      const viewed = raw.map(productView).filter(item => item.productCode);

      leavesSummary.push({
        path,
        type: typeOfPath(path),
        products: viewed.length
      });

      for (const product of viewed) products.push({ ...product, path, type: typeOfPath(path) });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const product of products) {
    const key = [product.productCode, product.groupCode, product.associationGroup].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(product);
  }

  const byType = unique.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});

  console.log();
  console.log('=== JERARQUIA RING ===');
  for (const leaf of leavesSummary) {
    console.log({
      path: leaf.path.join(' > '),
      type: leaf.type,
      products: leaf.products
    });
  }

  console.log();
  console.log('=== RESUMEN PRODUCTOS ===');
  console.log('Total productos unicos:', unique.length);
  console.log('Por tipo:', byType);
  console.log('GroupCodes:', [...new Set(unique.map(item => item.groupCode).filter(Boolean))].sort());
  console.log('AssociationGroups:', [...new Set(unique.map(item => item.associationGroup).filter(Boolean))].sort());
  console.log('CalculationTypes:', [...new Set(unique.map(item => item.calculationType).filter(Boolean))].sort());
  console.log('Unidades:', [...new Set(unique.map(item => item.unit).filter(Boolean))].sort());

  console.log();
  console.log('=== MUESTRA POR TIPO ===');
  for (const type of ['VELO', 'BLACKOUT', 'TRASLUCENTE', 'OTRO']) {
    const sample = unique.filter(item => item.type === type).slice(0, 8);
    if (!sample.length) continue;
    console.log(type + ':');
    for (const item of sample) {
      console.log({
        path: item.path.join(' > '),
        name: item.name,
        productCode: item.productCode,
        groupCode: item.groupCode,
        associationGroup: item.associationGroup,
        calculationType: item.calculationType,
        unit: item.unit,
        discount: item.discount
      });
    }
  }

  console.log();
  console.log('=== ATRIBUTOS REPRESENTATIVOS ===');

  const representatives = [];
  for (const type of ['VELO', 'BLACKOUT', 'TRASLUCENTE', 'OTRO']) {
    const found = unique.find(item => item.type === type);
    if (found) representatives.push(found);
  }

  for (const product of representatives) {
    try {
      const html = await catalog('attributes', {
        ProductCode: product.productCode,
        Group: product.associationGroup,
        GroupCode: product.groupCode,
        LineNumber: '',
        PrimaryGroup: product.primaryGroup,
        Discount: product.discount,
        CalculationType: product.calculationType,
        Modified: ''
      });
      console.log(JSON.stringify({
        type: product.type,
        product: {
          name: product.name,
          productCode: product.productCode,
          groupCode: product.groupCode,
          associationGroup: product.associationGroup,
          calculationType: product.calculationType,
          path: product.path
        },
        attributes: parseAttributes(html)
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        type: product.type,
        productCode: product.productCode,
        attributeError: error.message
      }, null, 2));
    }
  }

  console.log();
  console.log('=== DATOS PARA MAPEO ===');
  console.log(JSON.stringify(unique.map(item => ({
    type: item.type,
    path: item.path,
    name: item.name,
    productCode: item.productCode,
    groupCode: item.groupCode,
    associationGroup: item.associationGroup,
    primaryGroup: item.primaryGroup,
    calculationType: item.calculationType,
    unit: item.unit,
    discount: item.discount
  })), null, 2));

  console.log();
  console.log('=== FIN ===');
  console.log('SOLO LECTURA.');
  console.log('NO Scan.');
  console.log('NO Apply.');
  console.log('NO Spreadsheet.');
}

main().catch(error => {
  console.error('DISCOVERY ERROR:', error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
