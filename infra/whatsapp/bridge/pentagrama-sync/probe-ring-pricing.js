'use strict';

const fs = require('node:fs');

const BASE_URL = process.env.HOMEEASY_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = String(process.env.BRIDGE_TOKEN || '').trim();
const INPUT = process.argv[2] || '/tmp/ring-family.txt';

if (!TOKEN) {
  console.error('ABORTADO: falta BRIDGE_TOKEN.');
  process.exit(1);
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
  if (!match) throw new Error('No se encontro DATOS PARA MAPEO en ' + INPUT);
  return JSON.parse(match[1]);
}

function isNewRing(item) {
  const name = String(item && item.name || '').trim();
  const assoc = String(item && item.associationGroup || '').trim().toUpperCase();
  const group = String(item && item.groupCode || '').trim();
  return !/^renueva\s+/i.test(name) && assoc === 'RIECORIN' && group === '1346';
}

function firstOf(products, type) {
  return products.find(item => item.type === type);
}

async function catalog(operation, params) {
  return post('/api/pentagrama-sync/catalog', { operation, params });
}

function parseDefaults(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.Data)) return value.Data;
  if (Array.isArray(value && value.data)) return value.data;
  return value;
}

async function main() {
  const text = fs.readFileSync(INPUT, 'utf8');
  const products = extractProducts(text).filter(isNewRing);

  const selected = [
    firstOf(products, 'VELO'),
    firstOf(products, 'TRASLUCENTE'),
    firstOf(products, 'BLACKOUT')
  ].filter(Boolean);

  if (selected.length !== 3) throw new Error('No se encontraron representantes VELO/TRASLUCENTE/BLACKOUT.');

  const dimensions = [
    [0.60, 1.00],
    [0.80, 1.00],
    [1.00, 1.00],
    [1.20, 1.50],
    [1.83, 2.20],
    [2.50, 2.20],
    [3.00, 2.50]
  ];

  console.log('=== CORTINA RING · PRICING LIVE · SOLO LECTURA ===');
  console.log('Catalogo nuevo:', products.length);
  console.log('Renueva excluido por nombre + RIECORIN + 1346.');

  for (const product of selected) {
    console.log();
    console.log('===', product.type, '===');
    console.log('Producto:', product.name);
    console.log('ProductCode:', product.productCode);
    console.log('GroupCode:', product.groupCode);
    console.log('AssociationGroup:', product.associationGroup);
    console.log('CalculationType:', product.calculationType);
    console.log('Unidad:', product.unit);

    try {
      const defaults = await catalog('defaults', {
        ProductCode: product.productCode,
        Group: product.associationGroup,
        GroupCode: product.groupCode,
        CalculationType: product.calculationType || 'NormalProduct'
      });
      console.log('Defaults:', JSON.stringify(parseDefaults(defaults)));
    } catch (error) {
      console.log('Defaults: ERROR', error.message);
    }

    console.log('Precios:');
    for (const [width, height] of dimensions) {
      try {
        const result = await post('/api/pentagrama-sync/price', {
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
          options: {
            productDiscount: Number(product.discount || 0)
          }
        });

        const area = width * height;
        console.log(JSON.stringify({
          width,
          height,
          area: Math.round(area * 10000) / 10000,
          basePrice: result.basePrice,
          subtotal: result.subtotal,
          total: result.total,
          effectiveSupplierPerM2: area > 0 ? Math.round((Number(result.total || 0) / area) * 100) / 100 : null,
          distributorDiscount: result.distributorDiscount,
          vatRate: result.vatRate
        }));
      } catch (error) {
        console.log(JSON.stringify({
          width,
          height,
          error: error.message,
          code: error.details && (error.details.code || error.details.error) || null
        }));
      }
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
  console.error('ERROR:', error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
