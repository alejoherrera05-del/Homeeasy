'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ENV_PATH = path.join(ROOT, '.env');
const BASE_URL = process.env.HOMEEASY_BRIDGE_URL || 'http://127.0.0.1:8080';

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const source = fs.readFileSync(ENV_PATH, 'utf8');
    const line = source.split(/\r?\n/).find(item => item.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch (_) {
    return '';
  }
}

const TOKEN = envValue('BRIDGE_TOKEN');
if (!TOKEN) {
  console.error('ABORTADO: no se encontro BRIDGE_TOKEN.');
  process.exit(1);
}

async function catalog(operation, params = {}) {
  const response = await fetch(BASE_URL + '/api/pentagrama-sync/catalog', {
    method: 'POST',
    headers: {
      'X-HomeEasy-Token': TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ operation, params })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    const error = new Error(data.error || data.code || ('HTTP ' + response.status));
    error.details = data;
    throw error;
  }
  return data.result;
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.Data)) return value.Data;
  if (Array.isArray(value && value.data)) return value.data;
  return [];
}

function valueOf(item, names) {
  for (const name of names) {
    if (item && item[name] !== undefined && item[name] !== null && String(item[name]).trim() !== '') {
      return item[name];
    }
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
  const number = Number(valueOf(item, ['Levels', 'levels', 'LevelCount', 'levelCount']));
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function productView(item) {
  return {
    name: String(valueOf(item, ['ProductName', 'productName', 'Name', 'name', 'Description', 'description'])).trim(),
    productCode: String(valueOf(item, ['ProductCode', 'productCode', 'Code', 'code'])).trim(),
    groupCode: String(valueOf(item, ['GroupCode', 'groupCode', 'Group', 'group'])).trim(),
    associationGroup: String(valueOf(item, ['GrupAsoc', 'grupAsoc', 'AssociationGroup', 'associationGroup'])).trim(),
    primaryGroup: String(valueOf(item, ['PrimaryGroup', 'primaryGroup'])).trim(),
    calculationType: String(valueOf(item, ['CalculationType', 'calculationType'])).trim(),
    discount: Number(valueOf(item, ['Discount', 'discount']) || 0),
    raw: item
  };
}

function interestingText(value) {
  return /ONDA|SERENA|TUBO|RIEL|BAST[ÓO]N/i.test(String(value || ''));
}

function parseInterestingOptions(html) {
  const source = String(html || '');
  const found = [];
  for (const select of source.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const selectAttrs = select[1] || '';
    const selectId = (selectAttrs.match(/\bid=["']([^"']+)["']/i) || [])[1] || '';
    const selectName = (selectAttrs.match(/\bname=["']([^"']+)["']/i) || [])[1] || '';
    const options = [];
    for (const option of select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const attrs = option[1] || '';
      const label = String(option[2] || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!/TUBO|RIEL|BAST[ÓO]N|AL\s*2[.,]?8/i.test(label)) continue;
      options.push({
        label,
        value: (attrs.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '',
        itemCode: (attrs.match(/\bitemcode=["']([^"']*)["']/i) || [])[1] || '',
        calculationType: (attrs.match(/\bcalculationtype=["']([^"']*)["']/i) || [])[1] || '',
        idAttributeValue: (attrs.match(/\bidattributevalues=["']([^"']*)["']/i) || [])[1] || ''
      });
    }
    if (options.length) found.push({ selectId, selectName, options });
  }
  return found;
}

async function childCategories(pathItems, totalLevels) {
  const depth = pathItems.length;
  if (depth >= totalLevels) return [pathItems];

  const params = { level: depth + 1 };
  pathItems.forEach((item, index) => {
    params['Category' + (index + 1)] = categoryCode(item);
  });
  const children = listOf(await catalog('categories', params));
  if (!children.length) return [pathItems];

  const leaves = [];
  for (const child of children) {
    leaves.push(...await childCategories([...pathItems, child], totalLevels));
  }
  return leaves;
}

async function main() {
  console.log('=== PENTAGRAMA · ONDA SERENA · DISCOVERY SOLO LECTURA ===');

  const top = listOf(await catalog('categories', { level: 1 }));
  const direct = top.filter(item => /ONDA\s*SERENA/i.test(categoryName(item)));
  const candidates = direct.length
    ? direct
    : top.filter(item => /ONDA|SERENA|CORTINA/i.test(categoryName(item)));

  console.log('Categorias nivel 1:', top.length);
  console.log('Candidatas:', candidates.map(item => ({ code: categoryCode(item), name: categoryName(item), levels: categoryLevels(item) })));

  if (!candidates.length) {
    console.log('NO se encontro una categoria Onda Serena en nivel 1.');
    console.log('Nombres relacionados:', top.filter(item => interestingText(categoryName(item))).map(item => categoryName(item)));
    return;
  }

  const allProducts = [];
  for (const root of candidates) {
    const totalLevels = categoryLevels(root);
    const leaves = await childCategories([root], totalLevels);
    for (const leaf of leaves) {
      const params = {};
      leaf.forEach((item, index) => { params['Category' + (index + 1)] = categoryCode(item); });
      const products = listOf(await catalog('products', params)).map(productView);
      for (const product of products) {
        allProducts.push({ ...product, path: leaf.map(categoryName).filter(Boolean) });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const product of allProducts) {
    const key = product.productCode + '|' + product.groupCode;
    if (!product.productCode || seen.has(key)) continue;
    seen.add(key);
    unique.push(product);
  }

  console.log();
  console.log('=== PRODUCTOS ONDA SERENA ===');
  console.log('Total unicos:', unique.length);
  console.log(unique.map(product => ({
    path: product.path.join(' > '),
    name: product.name,
    productCode: product.productCode,
    groupCode: product.groupCode,
    associationGroup: product.associationGroup,
    calculationType: product.calculationType
  })));

  const systemNamed = unique.filter(product =>
    interestingText(product.name) ||
    interestingText(product.productCode) ||
    product.path.some(interestingText)
  );

  console.log();
  console.log('=== COINCIDENCIAS TUBO / RIEL / BASTON ===');
  console.log(systemNamed.map(product => ({
    path: product.path.join(' > '),
    name: product.name,
    productCode: product.productCode,
    groupCode: product.groupCode,
    associationGroup: product.associationGroup,
    calculationType: product.calculationType
  })));

  console.log();
  console.log('=== ATRIBUTOS REPRESENTATIVOS ===');
  const representative = [];
  const familySeen = new Set();
  for (const product of unique) {
    const familyKey = product.path.slice(0, 3).join('|') || product.name.split(/\s+/).slice(0, 3).join(' ');
    if (familySeen.has(familyKey)) continue;
    familySeen.add(familyKey);
    representative.push(product);
    if (representative.length >= 10) break;
  }

  for (const product of representative) {
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
      const options = parseInterestingOptions(html);
      if (!options.length) continue;
      console.log(JSON.stringify({
        product: {
          name: product.name,
          productCode: product.productCode,
          groupCode: product.groupCode,
          associationGroup: product.associationGroup,
          path: product.path
        },
        systemOptions: options
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        productCode: product.productCode,
        attributeError: error.message
      }, null, 2));
    }
  }

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
