import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, 'catalog-certifications.json');
const mappingsPath = path.join(here, 'verticales-certified.json');
const verifiedAt = '2026-10-09T15:24:26Z';

const certified = {
  'vertical-113': { productCode: 'VERSCCADTRE3EBO', groupCode: '455' },
  'vertical-114': { productCode: 'VERSCCADTRE1EBO', groupCode: '455' },
  'vertical-115': { productCode: 'VERSCCADLINDUN', groupCode: '455' },
  'vertical-116': { productCode: 'VERSCCADDIFASH', groupCode: '455' },
  'vertical-117': { productCode: 'VERSCCADESAS', groupCode: '455' },
  'vertical-120': { productCode: 'VERSCCADECCRYCRE', groupCode: '455' },
  'vertical-121': { productCode: 'VERSCCADJACPRICRBR', groupCode: '455' },
  'vertical-122': { productCode: 'VERSCCADPAPBE', groupCode: '455' },
  'vertical-123': { productCode: 'VERSCCADJADEQUEBAM', groupCode: '455' },
  'vertical-124': { productCode: 'VERCADSCJADESKBRWH', groupCode: '438' },
  'vertical-127': { productCode: 'VERSCCASCJASTYCHA', groupCode: '455' },
  'vertical-128': { productCode: 'VERSCMECAD50500277', groupCode: '456' },
  'vertical-129': { productCode: 'VERSCCADSPSTCOBR', groupCode: '455' }
};

const review = {
  'vertical-110': {
    candidate: 'AMBIGUOUS',
    strategy: 'RATE_M2',
    reason: 'HomeEasy agrega April Showers, Nevada y Sinfonia. Pentagrama expone las tres como referencias independientes; no existe un unico ProductCode seguro para auto-apply.'
  },
  'vertical-111': {
    candidate: 'EXACT_CANDIDATE',
    strategy: 'SPECIAL_CONFIGURATION',
    productCode: 'VERBOMATCAD090',
    groupCode: '446',
    reason: 'La lama de 9 cm resulta lineal a 87941 COP/m2, distinta de HomeEasy (90732.92), y la configuracion de 13 cm no quedo certificada. No se reduce a RATE_M2 unica.'
  },
  'vertical-112': {
    candidate: 'AMBIGUOUS',
    strategy: 'RATE_M2',
    reason: 'HomeEasy agrupa Tretto 5% y 10%, pero Pentagrama usa ProductCode distintos. Ambos deben permanecer separados para detectar futuras divergencias.'
  },
  'vertical-118': {
    candidate: 'EXACT_CANDIDATE', productCode: 'VERSCCADFAOF3WHBL', groupCode: '455', strategy: 'RATE_M2',
    reason: 'ProductCode exacto, pero el caso 2x2 vigente difiere de HomeEasy por 1581.03 COP; no se certifica sin resolver la tarifa.'
  },
  'vertical-119': {
    candidate: 'EXACT_CANDIDATE', productCode: 'VERSCCADSIBA5BL', groupCode: '455', strategy: 'RATE_M2',
    reason: 'ProductCode exacto, pero el caso 2x2 vigente difiere de HomeEasy por 47600 COP; no se certifica sin resolver la tarifa.'
  },
  'vertical-125': {
    candidate: 'EXACT_CANDIDATE', productCode: 'VERSCCADJADE47604', groupCode: '455', strategy: 'RATE_M2',
    reason: 'ProductCode exacto, pero el caso 2x2 vigente difiere de HomeEasy por 61880 COP; no se certifica sin resolver la tarifa.'
  },
  'vertical-126': {
    candidate: 'EXACT_CANDIDATE', productCode: 'VERCADSCJADEGRESAN', groupCode: '438', strategy: 'RATE_M2',
    reason: 'ProductCode exacto, pero el caso 2x2 vigente difiere de HomeEasy por 14280 COP; no se certifica sin resolver la tarifa.'
  }
};

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const byId = new Map(registry.products.map(product => [product.homeeasyId, product]));
const validationCases = [
  { id: 'normal-a', width: '2', height: '2', role: 'individual-product-code' },
  { id: 'normal-b', width: '2.4', height: '2.1', role: 'shared-group-rule' },
  { id: 'minimum-regression', width: '1', height: '1', role: 'shared-group-boundary-1.3m2' }
];

const mappings = Object.entries(certified).map(([homeeasyId, identity]) => {
  const product = byId.get(homeeasyId);
  if (!product) throw new Error(`Missing HomeEasy product ${homeeasyId}`);
  Object.assign(product, {
    candidate: 'EXACT_CANDIDATE', status: 'CERTIFIED', strategy: 'RATE_M2',
    productCode: identity.productCode, groupCode: identity.groupCode,
    calculationType: 'NormalProduct', associationGroup: 'VERTELCA', unit: 'UND',
    verifiedAt, casesPassed: 3, maxDifference: 0,
    evidence: {
      individualCase: { width: 2, height: 2, result: 'PASS' },
      sharedRule: `Vertical con cadenilla sin cenefa / VERTELCA / grupo ${identity.groupCode}`,
      sharedCases: validationCases.slice(1),
      billingMinimum: 'width * max(height, 1.3); no minimum 1.6m2',
      source: 'Pentagrama authenticated portal'
    }
  });
  delete product.reason;
  return {
    id: `${homeeasyId}-catalog-certified`, family: product.family, reference: product.reference,
    homeeasyId, productCode: identity.productCode, groupCode: identity.groupCode,
    calculationType: 'NormalProduct', width: '2', height: '2', quantity: 1,
    productDiscount: 0, pricingMode: 'account-discount', strategy: 'RATE_M2',
    status: 'CERTIFIED', verifiedAt, casesPassed: 3, maxDifference: 0,
    destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
    validationCases, updateField: 'Tarifa_IVA_COP',
    special: { Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '', AssociationGroup: 'VERTELCA', Discount: 0 }
  };
});

for (const [homeeasyId, details] of Object.entries(review)) {
  const product = byId.get(homeeasyId);
  if (!product) throw new Error(`Missing HomeEasy product ${homeeasyId}`);
  Object.assign(product, details, {
    status: 'REVIEW_REQUIRED', calculationType: 'NormalProduct', associationGroup: 'VERTELCA', unit: 'UND', verifiedAt
  });
  delete product.evidence;
  delete product.casesPassed;
  delete product.maxDifference;
}

registry.generatedAt = verifiedAt;
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
fs.writeFileSync(mappingsPath, `${JSON.stringify({
  schemaVersion: 1, verifiedAt,
  groupEvidence: [
    { groupCode: '455', associationGroup: 'VERTELCA', calculationType: 'NormalProduct', unit: 'UND', casesPassed: 3, maxDifference: 0 },
    { groupCode: '438', associationGroup: 'VERTELCA', calculationType: 'NormalProduct', unit: 'UND', casesPassed: 3, maxDifference: 0 },
    { groupCode: '456', associationGroup: 'VERTELCA', calculationType: 'NormalProduct', unit: 'UND', casesPassed: 3, maxDifference: 0 }
  ], mappings
}, null, 2)}\n`);
console.log(JSON.stringify({ updated: mappings.length, review: Object.keys(review).length, registryTotal: registry.products.length }));
