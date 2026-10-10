import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, 'catalog-certifications.json');
const panelEvidencePath = path.join(here, 'panel-japones-live-evidence.json');
const sheerEvidencePath = path.join(here, 'sheer-elegance-live-evidence.json');

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const panelEvidence = JSON.parse(fs.readFileSync(panelEvidencePath, 'utf8'));
const sheerEvidence = JSON.parse(fs.readFileSync(sheerEvidencePath, 'utf8'));
const byId = new Map(registry.products.map(product => [product.homeeasyId, product]));

function requireProduct(homeeasyId) {
  const product = byId.get(homeeasyId);
  if (!product) throw new Error(`Missing HomeEasy product ${homeeasyId}`);
  return product;
}

function markExactReview(result, details) {
  const product = requireProduct(result.homeeasyId);
  Object.assign(product, {
    candidate: 'EXACT_CANDIDATE',
    status: 'REVIEW_REQUIRED',
    strategy: 'RATE_M2',
    productCode: result.productCode,
    groupCode: result.groupCode,
    calculationType: 'NormalProduct',
    associationGroup: details.associationGroup,
    unit: 'UND',
    verifiedAt: details.verifiedAt,
    casesPassed: result.casesPassed,
    maxDifference: result.maxDifference,
    reason: details.reason,
    evidence: {
      source: 'Pentagrama authenticated price endpoint',
      cases: result.cases
    }
  });
}

for (const result of panelEvidence.failed) {
  markExactReview(result, {
    associationGroup: 'PANEL',
    verifiedAt: panelEvidence.checkedAt,
    reason: 'ProductCode y GroupCode exactos. Las dos medidas normales reproducen Pentagrama, pero el borde 1.00 x 1.30 usa 1.6 m2 en el endpoint y contradice la regresion critica HomeEasy/portal configurado. No se certifica ni se fuerza un minimo generico de 1.6 m2.'
  });
}

for (const result of sheerEvidence.failed) {
  markExactReview(result, {
    associationGroup: 'SHEERSTD',
    verifiedAt: sheerEvidence.checkedAt,
    reason: `ProductCode y GroupCode exactos bajo SHEER ELEGANCE / STANDARD, pero el precio no fue reproducible en los tres casos (${result.casesPassed}/3 PASS). Faltan atributos o configuracion inequívoca; no se equipara con Penta13.`
  });
}

const ambiguous = {
  'panel-80': 'HomeEasy agrega Visualle I y II; Pentagrama expone ProductCode/GroupCode distintos y no existe un destino unico seguro.',
  'panel-83': 'HomeEasy agrega Tretto 5% y 10%; Pentagrama los expone como referencias separadas.',
  'panel-109': 'HomeEasy agrega Serenade Screen y Serenade Eco; Pentagrama usa ProductCode distintos dentro del grupo 582.',
  'sheer-130': 'HomeEasy Screen coincide con mas de un GroupCode STANDARD; falta separar el destino antes de certificar.',
  'sheer-141': 'HomeEasy agrega Crystal basicos y especiales; Pentagrama los separa en grupos 871 y 886.',
  'sheer-142': 'HomeEasy Elegance corresponde a mas de un GroupCode STANDARD (872 y 1301).',
  'sheer-149': 'HomeEasy Natural corresponde a referencias STANDARD en grupos 1306 y 874.',
  'sheer-155': 'Kosta existe en mas de una estructura/configuracion; no hay un unico ProductCode STANDARD demostrado para el destino HomeEasy.'
};

for (const [homeeasyId, reason] of Object.entries(ambiguous)) {
  const product = requireProduct(homeeasyId);
  const isPanel = homeeasyId.startsWith('panel-');
  Object.assign(product, {
    candidate: 'AMBIGUOUS',
    status: 'REVIEW_REQUIRED',
    strategy: 'RATE_M2',
    calculationType: 'NormalProduct',
    associationGroup: isPanel ? 'PANEL' : 'SHEERSTD',
    unit: 'UND',
    verifiedAt: isPanel ? panelEvidence.checkedAt : sheerEvidence.checkedAt,
    reason
  });
  delete product.productCode;
  delete product.groupCode;
  delete product.casesPassed;
  delete product.maxDifference;
  delete product.evidence;
}

registry.generatedAt = sheerEvidence.checkedAt;

const counts = registry.products.reduce((result, product) => {
  result[product.status] = (result[product.status] || 0) + 1;
  result[product.candidate] = (result[product.candidate] || 0) + 1;
  return result;
}, {});

const panel = registry.products.filter(product => product.family === 'Panel Japonés');
const sheer = registry.products.filter(product => product.family === 'Sheer Elegance');
const familyCounts = products => Object.fromEntries(['CERTIFIED', 'REVIEW_REQUIRED', 'UNMAPPED'].map(status => [status, products.filter(product => product.status === status).length]));

if (counts.CERTIFIED !== 90 || counts.REVIEW_REQUIRED !== 82 || counts.UNMAPPED !== 280) {
  throw new Error(`Unexpected registry counts: ${JSON.stringify(counts)}`);
}

fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ total: registry.products.length, counts, panel: familyCounts(panel), sheer: familyCounts(sheer) }));
