'use strict';

const PRICE_STRATEGIES = Object.freeze({
  RATE_M2: 'RATE_M2', MATRIX: 'MATRIX', FIXED_PRICE: 'FIXED_PRICE',
  COMPLEMENT: 'COMPLEMENT', SPECIAL_CONFIGURATION: 'SPECIAL_CONFIGURATION'
});

const INITIAL_MAPPINGS = Object.freeze([
  Object.freeze({
    id: 'vertical-matte-blanco-120x130',
    family: 'Vertical',
    reference: 'Black Out Matte',
    homeeasyId: 'vertical-111',
    productCode: 'VERBOMATCAD090',
    groupCode: '446',
    calculationType: 'NormalProduct',
    width: '1.2',
    height: '1.3',
    quantity: 1,
    productDiscount: 0,
    pricingMode: 'account-discount',
    strategy: PRICE_STRATEGIES.RATE_M2,
    destination: Object.freeze({ sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' }),
    validationCases: Object.freeze([
      Object.freeze({ id: 'normal-a', width: '2', height: '2', role: 'derive' }),
      Object.freeze({ id: 'normal-b', width: '2.4', height: '2', role: 'derive' }),
      Object.freeze({ id: 'minimum-regression', width: '1.2', height: '1.3', role: 'boundary' })
    ]),
    updateField: 'Tarifa_IVA_COP',
    special: Object.freeze({ Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '', AssociationGroup: 'VERTELCA', Discount: 0 })
  }),
  Object.freeze({
    id: 'onda-coral-white-100x100',
    family: 'Onda Serena',
    reference: 'Coral White',
    homeeasyId: 'onda-67',
    productCode: 'CORONSEVECORWH2.8',
    groupCode: '1345',
    calculationType: 'NormalProduct',
    width: '1',
    height: '1',
    quantity: 1,
    productDiscount: 0,
    pricingMode: 'account-discount',
    strategy: PRICE_STRATEGIES.RATE_M2,
    destination: Object.freeze({ sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' }),
    validationCases: Object.freeze([
      Object.freeze({ id: 'normal-a', width: '2', height: '2', role: 'derive' }),
      Object.freeze({ id: 'normal-b', width: '2.2', height: '1.8', role: 'derive' }),
      Object.freeze({ id: 'minimum-regression', width: '1', height: '1', role: 'boundary' })
    ]),
    updateField: 'Tarifa_IVA_COP',
    special: Object.freeze({ Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '' })
  }),
  Object.freeze({
    id: 'enrollable-blackout-matte3-200x320',
    family: 'Enrollable',
    reference: 'Matte 3',
    homeeasyId: 'enrollable-blackout-matte3',
    productCode: 'ENRSTDBOMA3090',
    groupCode: '599',
    calculationType: 'NormalProduct',
    width: '2',
    height: '3.2',
    quantity: 1,
    productDiscount: 0,
    pricingMode: 'net-before-vat',
    strategy: PRICE_STRATEGIES.SPECIAL_CONFIGURATION,
    destination: Object.freeze({ sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' }),
    autoApplicable: false,
    reviewReason: 'La referencia depende de reglas de fabricación/configuración; falta demostrar todas las variantes antes de actualizar la tarifa.',
    validationCases: Object.freeze([
      Object.freeze({ id: 'standard-known', width: '2', height: '3.2', role: 'evidence' })
    ]),
    updateField: 'Tarifa_IVA_COP',
    special: Object.freeze({ Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '' })
  })
]);

function mappingIsReady(mapping) {
  return Boolean(mapping && PRICE_STRATEGIES[mapping.strategy] && mapping.destination &&
    !JSON.stringify(mapping).includes('__PENDING_DISCOVERY__'));
}

function selectMappings(ids, mappings = INITIAL_MAPPINGS) {
  const requested = Array.isArray(ids) ? new Set(ids.map(value => String(value))) : null;
  const selected = requested ? mappings.filter(mapping => requested.has(mapping.id)) : mappings.slice();
  if (requested && selected.length !== requested.size) {
    throw Object.assign(new Error('One or more mappingIds are unknown'), { statusCode: 400 });
  }
  return selected;
}

function pentagramaParams(mapping) {
  return {
    ProductCode: mapping.productCode,
    Quantity: mapping.quantity,
    Width: mapping.width,
    Height: mapping.height,
    GroupCode: mapping.groupCode,
    calculationType: mapping.calculationType,
    ...(mapping.special || {})
  };
}

function pentagramaParamsForCase(mapping, validationCase) {
  return Object.assign({}, pentagramaParams(mapping), {
    Width: String(validationCase.width), Height: String(validationCase.height),
    ...(validationCase.pentagrama || {})
  });
}

function homeEasyItem(mapping) {
  return {
    product: mapping.homeeasyId,
    width: mapping.width,
    height: mapping.height,
    quantity: String(mapping.quantity),
    extras: '0',
    ...(mapping.homeeasy || {})
  };
}

function homeEasyItemForCase(mapping, validationCase) {
  return Object.assign({}, homeEasyItem(mapping), {
    width: String(validationCase.width), height: String(validationCase.height),
    ...(validationCase.homeeasy || {})
  });
}

module.exports = Object.freeze({ PRICE_STRATEGIES, INITIAL_MAPPINGS, mappingIsReady, selectMappings,
  pentagramaParams, pentagramaParamsForCase, homeEasyItem, homeEasyItemForCase });
