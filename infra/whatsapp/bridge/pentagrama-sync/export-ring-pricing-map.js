'use strict';

const fs = require('node:fs');

const BASE_URL = process.env.HOMEEASY_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = String(process.env.BRIDGE_TOKEN || '').trim();
const INPUT = process.argv[2] || '/tmp/ring-family.txt';
const OUTPUT = process.argv[3] || '/tmp/ring-pricing-map.json';

if (!TOKEN) {
  console.error('ABORTADO: falta BRIDGE_TOKEN.');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function post(route, body) {
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

function extractProducts(text) {
  const match = text.match(/=== DATOS PARA MAPEO ===\s*(\[[\s\S]*?\])\s*=== FIN ===/);
  if (!match) throw new Error('No se encontro DATOS PARA MAPEO.');
  return JSON.parse(match[1]);
}

function isNewRing(item) {
  const name = String(item && item.name || '').trim();
  const assoc = String(item && item.associationGroup || '').trim().toUpperCase();
  const group = String(item && item.groupCode || '').trim();
  return !/^renueva\s+/i.test(name) && assoc === 'RIECORIN' && group === '1346';
}

function cleanName(name) {
  return String(name || '')
    .replace(/^Cortina\s+Onda\s+Serena\s+Ring\s+al\s+2\.0\s+/i, '')
    .trim();
}

function slug(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

async function getCost(product, width, height) {
  return post('/api/pentagrama-sync/price', {
    params: {
      ProductCode: product.productCode,
      Quantity: 1,
      Width: width,
      Height: height,
      GroupCode: product.groupCode,
      AssociationGroup: product.associationGroup,
      calculationType: product.calculationType || 'NormalProduct',
      Discount: Number(product.discount || 0)
    },
    options: { productDiscount: Number(product.discount || 0) }
  });
}

function money2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function main() {
  const text = fs.readFileSync(INPUT, 'utf8');
  const products = extractProducts(text).filter(isNewRing);

  console.log('=== CORTINA RING · MAPA COMPLETO DE TARIFAS LIVE ===');
  console.log('Referencias nuevas:', products.length);
  console.log('Validacion por referencia: 1.00x1.00 y 1.83x2.20');
  console.log('Tolerancia de linealidad: COP 0.02 por caso');
  console.log();

  const entries = [];
  let failures = 0;
  let nonlinear = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const prefix = '[' + String(i + 1).padStart(3, '0') + '/' + products.length + ']';
    try {
      const a = await getCost(product, 1, 1);
      await sleep(60);
      const b = await getCost(product, 1.83, 2.20);

      const areaB = 1.83 * 2.20;
      const expectedB = Number(a.total || 0) * areaB;
      const difference = Math.abs(Number(b.total || 0) - expectedB);
      const isLinear = difference <= 0.02;

      if (!isLinear) nonlinear++;

      const entry = {
        id: 'ring-' + slug(product.type + '-' + cleanName(product.name)),
        family: 'ring',
        familyName: 'Cortina Ring',
        type: product.type,
        name: cleanName(product.name),
        pentagramaName: product.name,
        productCode: product.productCode,
        groupCode: product.groupCode,
        associationGroup: product.associationGroup,
        calculationType: product.calculationType,
        unit: product.unit,
        productDiscount: Number(product.discount || 0),
        method: isLinear ? 'area' : 'review',
        tariffVatCopPerM2: money2(a.total),
        portalBaseCopPerM2: money2(a.basePrice),
        distributorDiscount: Number(a.distributorDiscount || 0),
        vatRate: Number(a.vatRate || 0),
        validation: {
          case1: { width: 1, height: 1, total: money2(a.total) },
          case2: { width: 1.83, height: 2.20, total: money2(b.total), expected: money2(expectedB), difference: money2(difference) },
          linear: isLinear
        }
      };
      entries.push(entry);
      consecutiveFailures = 0;

      console.log(prefix,
        product.type,
        product.productCode,
        '|', cleanName(product.name),
        '| tarifa=', entry.tariffVatCopPerM2,
        '|', isLinear ? 'PASS' : ('REVIEW diff=' + money2(difference))
      );
    } catch (error) {
      failures++;
      consecutiveFailures++;
      entries.push({
        family: 'ring',
        type: product.type,
        name: cleanName(product.name),
        pentagramaName: product.name,
        productCode: product.productCode,
        groupCode: product.groupCode,
        associationGroup: product.associationGroup,
        error: error.message,
        details: error.details || null
      });
      console.log(prefix, 'ERROR', product.productCode, error.message);

      if (consecutiveFailures >= 3) {
        console.log('ABORTADO: 3 fallos consecutivos; no se seguira golpeando Pentagrama.');
        break;
      }
    }

    await sleep(90);
  }

  const completed = entries.filter(x => !x.error);
  const byType = {};
  for (const item of completed) byType[item.type] = (byType[item.type] || 0) + 1;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'Pentagrama Live /Order/GetProductPrice',
    filters: {
      excludedRenueva: true,
      groupCode: '1346',
      associationGroup: 'RIECORIN'
    },
    expectedProducts: products.length,
    completed: completed.length,
    failures,
    nonlinear,
    byType,
    allLinear: failures === 0 && nonlinear === 0 && completed.length === products.length,
    entries
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));

  console.log();
  console.log('=== RESUMEN ===');
  console.log('Esperadas:', products.length);
  console.log('Completadas:', completed.length);
  console.log('Errores:', failures);
  console.log('No lineales:', nonlinear);
  console.log('Por tipo:', JSON.stringify(byType));
  console.log('ALL_LINEAR:', payload.allLinear);
  console.log('Archivo:', OUTPUT);
  console.log();
  console.log('SOLO LECTURA.');
  console.log('NO Scan.');
  console.log('NO Apply.');
  console.log('NO Spreadsheet.');
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
