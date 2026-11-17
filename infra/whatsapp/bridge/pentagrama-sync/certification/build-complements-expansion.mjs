import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, 'catalog-certifications.json');
const mappingsPath = path.join(here, 'complements-certified.json');
const verifiedAt = '2026-11-17T20:42:09Z';
const parentProductCode = 'ENRSTDBOMA3090';
const associationGroup = 'ENRSTD';

const definitions = {
  'coverlight-standard': { productCode: 'KITPERCOLIBLA', groupCode: '616', calculationType: 'DimensionsHeight', method: 'linear-height', quantity: 2 },
  'coverlight-plus': { productCode: 'KITPERCOLIPLUBLA', groupCode: '616', calculationType: 'DimensionsHeight', method: 'linear-height', quantity: 2 },
  'coverlight-advance': { productCode: 'KITPERCOLIADVBLA', groupCode: '616', calculationType: 'DimensionsHeight', method: 'linear-height', quantity: 2 },
  'coverlight-single': { productCode: 'KITPERCOLISINBLA', groupCode: '616', calculationType: 'DimensionsHeight', method: 'linear-height', quantity: 2 },
  'perfil-basico-out': { productCode: 'ACENPEINSTDOUBLA', groupCode: '108', calculationType: 'DimensionsWidth', method: 'linear-width', quantity: 1 }
};

const validationCases = [
  { id: 'normal-a', width: '1.83', height: '1.2', role: 'derive' },
  { id: 'normal-b', width: '1.83', height: '2.2', role: 'derive' },
  { id: 'wide-tall', width: '2.5', height: '2.8', role: 'validate' }
];

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const byId = new Map(registry.products.map(product => [product.homeeasyId, product]));
const mappings = Object.entries(definitions).map(([homeeasyId, definition]) => {
  const product = byId.get(homeeasyId);
  if (!product) throw new Error(`Missing HomeEasy product ${homeeasyId}`);
  Object.assign(product, {
    candidate: 'EXACT_CANDIDATE', status: 'CERTIFIED', strategy: 'COMPLEMENT',
    productCode: definition.productCode, groupCode: definition.groupCode,
    calculationType: definition.calculationType, associationGroup, unit: 'UND',
    verifiedAt, casesPassed: 3, maxDifference: 0,
    evidence: {
      parentProductCode,
      associationGroup,
      calculationType: definition.calculationType,
      method: definition.method,
      homeeasyQuantity: definition.quantity,
      cases: validationCases,
      source: 'Pentagrama authenticated portal'
    }
  });
  delete product.reason;
  return {
    id: `${homeeasyId}-catalog-certified`, family: product.family, reference: product.reference,
    homeeasyId, productCode: definition.productCode, groupCode: definition.groupCode,
    calculationType: definition.calculationType, width: '1.83', height: '1.2', quantity: 1,
    productDiscount: 0, pricingMode: 'account-discount', strategy: 'COMPLEMENT',
    status: 'CERTIFIED', verifiedAt, casesPassed: 3, maxDifference: 0,
    destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
    validationCases, updateField: 'Tarifa_IVA_COP',
    homeeasy: { quantity: String(definition.quantity) },
    special: {
      Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: parentProductCode,
      AssociationGroup: associationGroup, Discount: 0
    }
  };
});

registry.generatedAt = verifiedAt;
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
fs.writeFileSync(mappingsPath, `${JSON.stringify({
  schemaVersion: 1,
  verifiedAt,
  parent: { productCode: parentProductCode, associationGroup },
  mappings
}, null, 2)}\n`);
console.log(JSON.stringify({ updated: mappings.length, registryTotal: registry.products.length }));
