import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, 'catalog-certifications.json');
const inventoryPath = path.join(here, 'enrollables-live-inventory.tsv');
const outputPath = path.join(here, '..', 'enrollables-live-products.json');

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const lines = fs.readFileSync(inventoryPath, 'utf8').trim().split(/\r?\n/);
const headings = lines.shift().split('\t');
const inventory = lines.map(line => Object.fromEntries(line.split('\t').map((value, index) => [headings[index], value])));

const portalSubfamily = Object.freeze({
  blackout: 'BLACK OUT',
  screen: 'SCREEN',
  trasluz: 'TRASLUZ',
  serenade: 'SERENADE',
  dimout: 'DIM OUT',
  soltis: 'MEMBRANA BIOCLIMÁTICA',
  lona: 'LONA TRANSPARENTE'
});

const cat3 = Object.freeze({
  'BLACK OUT': '8',
  'DIM OUT': '440',
  'LONA TRANSPARENTE': '499',
  'MEMBRANA BIOCLIMÁTICA': '454',
  SCREEN: '49',
  SERENADE: '892',
  TRASLUZ: '79'
});

// These are portal taxonomy labels, not fuzzy name substitutions. Each alias is
// confined to the matching HomeEasy subfamily and names the same exact product.
const exactAliases = Object.freeze({
  'enrollable-blackout-ziame': 'ZIAME',
  'enrollable-trasluz-calais-blanco-crema': 'CALAIS',
  'enrollable-trasluz-calais-otros': 'CALAIS',
  'enrollable-trasluz-ziame': 'ZIAME',
  'enrollable-soltis-soltisw96': 'IMPERMEABLE SOLTIS W96',
  'enrollable-soltis-soltis96': 'MICROPERFORADA SOLTIS 96',
  'enrollable-lona-lonatransparentecristaltec': 'LONA TRANSPARENTE'
});

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' Y ')
    .replace(/\bMAS DE 30\s*M2\b/gi, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toUpperCase();
}

function subfamilyFor(homeeasyId) {
  return String(homeeasyId).split('-')[1] || '';
}

const portalByFamilyAndName = new Map();
for (const product of inventory) {
  const key = `${product.subfamily}|${normalized(product.reference)}`;
  const bucket = portalByFamilyAndName.get(key) || [];
  bucket.push(product);
  portalByFamilyAndName.set(key, bucket);
}

const products = {};
const review = [];
const notFound = [];
const usedProductCodes = new Set();
const homeeasy = registry.products.filter(product => product.family === 'Enrollables');

for (const product of homeeasy) {
  const subfamily = subfamilyFor(product.homeeasyId);
  const family = portalSubfamily[subfamily];
  const target = exactAliases[product.homeeasyId] || product.reference;
  const matches = portalByFamilyAndName.get(`${family}|${normalized(target)}`) || [];
  if (matches.length !== 1) {
    const entry = { homeeasyId: product.homeeasyId, reference: product.reference, subfamily, matches: matches.map(match => match.productCode) };
    (matches.length > 1 ? review : notFound).push(entry);
    continue;
  }
  const match = matches[0];
  usedProductCodes.add(match.productCode);
  products[product.homeeasyId] = {
    homeeasyId: product.homeeasyId,
    family: 'Enrollable',
    subfamily,
    reference: product.reference,
    productCode: match.productCode,
    groupCode: match.groupCode,
    associationGroup: match.associationGroup,
    primaryGroup: 'ENROLLABLE',
    system: 'STANDARD/PLATINA SIN CABEZAL',
    head: '',
    calculationType: match.calculationType,
    discount: Number(match.discount || 0),
    categories: {
      Cat1: '4',
      Cat2: '79',
      Cat3: cat3[match.subfamily],
      Cat4: match.category4 || '0',
      Cat5: '0'
    },
    friendlyName: match.friendlyName,
    status: 'LIVE_SUPPORTED'
  };
}

const excludedPortal = inventory
  .filter(product => !usedProductCodes.has(product.productCode))
  .map(product => ({ subfamily: product.subfamily, reference: product.reference, productCode: product.productCode, groupCode: product.groupCode }));

const output = {
  schemaVersion: 1,
  generatedAt: '2026-10-10T00:00:00.000-05:00',
  source: 'Pentagrama authenticated catalog: ENROLLABLE / STANDARD-PLATINA SIN CABEZAL',
  products,
  review,
  notFound,
  excludedPortal
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ homeeasy: homeeasy.length, portal: inventory.length, exact: Object.keys(products).length, review, notFound, excludedPortal }, null, 2));
