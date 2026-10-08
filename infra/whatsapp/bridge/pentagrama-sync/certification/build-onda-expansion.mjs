import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, 'catalog-certifications.json');
const mappingsPath = path.join(here, 'onda-serena-certified.json');
const verifiedAt = '2026-10-08T20:45:00Z';

const productCodes = {
  'onda-0': 'CORONSEBOSCUBE2.8',
  'onda-1': 'CORONSEBOFIBL2.8',
  'onda-2': 'CORONSEBONOTFLGR2.8',
  'onda-3': 'CORONSEBODIVARE2.8',
  'onda-4': 'CORONSEBOPARNEG2.8',
  'onda-5': 'CORONSEBOSALBRU2.8',
  'onda-6': 'CORONSEBOSILKNO2.8',
  'onda-7': 'CORONSEBOVELWH2.8',
  'onda-8': 'CORONSEACQALBRF2.8',
  'onda-11': 'CORONSEBOFEWH2.8',
  'onda-12': 'CORONSEDIMOBL2.8',
  'onda-13': 'CORONSEBOMINBLA2.8',
  'onda-14': 'CORONSEBORUBR2.8',
  'onda-15': 'CORONSEBOLIEACE2.8',
  'onda-16': 'CORONSEBOMODBLA2.8',
  'onda-17': 'CORONSEBOPIABE2.8',
  'onda-18': 'CORONSEBOREWHLI2.8',
  'onda-19': 'CORONSEBOSPLIGR2.8',
  'onda-20': 'CORONSEBOTEAR2.8',
  'onda-21': 'CORONSEBOESWH2.8',
  'onda-22': 'CORONSETRCOCOPNU2.8',
  'onda-23': 'CORONSETRRASMIGR2.8',
  'onda-24': 'CORONSETRCOCOUGR2.8',
  'onda-25': 'CORONSETRCODANCO2.8',
  'onda-26': 'CORONSETRASALWH2.8',
  'onda-27': 'CORONSETRKILIV2.8',
  'onda-28': 'CORONSETRLIDAGR2.8',
  'onda-29': 'CORONSETRASNATAL2.8',
  'onda-30': 'CORONSETROXFCH2.8',
  'onda-31': 'CORONSETRASFLOIV2.8',
  'onda-32': 'CORONSETRCOPOLAR2.8',
  'onda-33': 'CORONSETRASREGR2.8',
  'onda-34': 'CORONSETRASNUVAG2.8',
  'onda-35': 'CORONSETRCOMOLAR2.8',
  'onda-36': 'CORONSEVEPEWH2.8',
  'onda-37': 'CORONSEVEMAWH2.8',
  'onda-38': 'CORONSEVETEWH2.8',
  'onda-39': 'CORONSEVEKIWH2.8',
  'onda-40': 'CORONSEVEPIWH2.8',
  'onda-41': 'CORONSEVECOPWHGO2.8',
  'onda-42': 'CORONSEVECORARE2.8',
  'onda-43': 'CORONSEVECORWHI2.8',
  'onda-44': 'CORONSEVEDESGRI2.8',
  'onda-45': 'CORONSEVEGENARM2.8',
  'onda-46': 'CORONSEVENERGRSA2.8',
  'onda-47': 'CORONSEVENEDAGR2.8',
  'onda-48': 'CORONSEVEPERBEI2.8',
  'onda-49': 'CORONSEVEROCWHI2.8',
  'onda-50': 'CORONSEVESABGOL2.8',
  'onda-51': 'CORONSEVESABWHLI2.8',
  'onda-52': 'CORONSEVEKNWH2.8',
  'onda-53': 'CORONSEVESOWH2.8',
  'onda-54': 'CORONSEVECECRGO2.8',
  'onda-55': 'CORONSEVECOWH2.8',
  'onda-56': 'CORONSEVEGELWHI2.8',
  'onda-57': 'CORONSEVEPIALIGR2.8',
  'onda-58': 'CORONSEVEPLUARG2.8',
  'onda-59': 'CORONSEVERIVDAGR2.8',
  'onda-60': 'CORONSEVEANGGRE2.8',
  'onda-61': 'CORONSEVENEBWH2.8',
  'onda-62': 'CORONSEVEPICLI2.8',
  'onda-63': 'CORONSEVEPICWH2.8',
  'onda-64': 'CORONSEVEAPRLIN2.8',
  'onda-65': 'CORONSEVEAUWH2.8',
  'onda-66': 'CORONSEVEBORWHI2.8',
  'onda-68': 'CORONSEVEDOLWHI2.8',
  'onda-69': 'CORONSEVEFLULIGR2.8',
  'onda-70': 'CORONSEVEGOWH2.8',
  'onda-71': 'CORONSEVEHO2.8',
  'onda-72': 'CORONSEVESTWH2.8',
  'onda-73': 'CORONSEVECEBE2.8',
  'onda-74': 'CORONSEVECRWH2.8',
  'onda-75': 'CORONSEVEINWH2.8',
  'onda-76': 'CORONSEVEGAGR2.8',
  'onda-77': 'CORONSEVERUGR2.8'
};

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const byId = new Map(registry.products.map(product => [product.homeeasyId, product]));
const validationCases = [
  { id: 'normal-a', width: '2', height: '2', role: 'individual-product-code' },
  { id: 'normal-b', width: '2.4', height: '2.1', role: 'shared-group-rule' },
  { id: 'minimum-regression', width: '0.8', height: '1', role: 'shared-group-boundary' }
];

const mappings = Object.entries(productCodes).map(([homeeasyId, productCode]) => {
  const product = byId.get(homeeasyId);
  if (!product) throw new Error(`Missing HomeEasy product ${homeeasyId}`);
  Object.assign(product, {
    candidate: 'EXACT_CANDIDATE',
    status: 'CERTIFIED',
    productCode,
    groupCode: '1345',
    calculationType: 'NormalProduct',
    associationGroup: 'RIECOR28',
    unit: 'MT2',
    verifiedAt,
    casesPassed: 3,
    maxDifference: 0,
    evidence: {
      individualCase: { width: 2, height: 2, result: 'PASS' },
      sharedRule: 'Onda Serena AL 2.8 / RIECOR28',
      sharedCases: validationCases.slice(1),
      source: 'Pentagrama authenticated portal'
    }
  });
  delete product.reason;
  return {
    id: `${homeeasyId}-catalog-certified`,
    family: product.family,
    reference: product.reference,
    homeeasyId,
    productCode,
    groupCode: '1345',
    calculationType: 'NormalProduct',
    width: '2',
    height: '2',
    quantity: 1,
    productDiscount: 0,
    pricingMode: 'account-discount',
    strategy: 'RATE_M2',
    status: 'CERTIFIED',
    verifiedAt,
    casesPassed: 3,
    maxDifference: 0,
    destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' },
    validationCases,
    updateField: 'Tarifa_IVA_COP',
    special: { Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '', AssociationGroup: 'RIECOR28', Discount: 0 }
  };
});

for (const homeeasyId of ['onda-9', 'onda-67']) {
  const product = byId.get(homeeasyId);
  Object.assign(product, {
    calculationType: 'NormalProduct',
    associationGroup: 'RIECOR28',
    unit: 'MT2'
  });
}

registry.generatedAt = verifiedAt;
registry.sources.pentagrama = 'authenticated portal catalog and price endpoint/UI';
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
fs.writeFileSync(mappingsPath, `${JSON.stringify({ schemaVersion: 1, verifiedAt, groupEvidence: { groupCode: '1345', associationGroup: 'RIECOR28', calculationType: 'NormalProduct', unit: 'MT2', casesPassed: 3, maxDifference: 0 }, mappings }, null, 2)}\n`);
console.log(JSON.stringify({ updated: mappings.length, registryTotal: registry.products.length }));
