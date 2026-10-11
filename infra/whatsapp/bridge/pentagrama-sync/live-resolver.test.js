'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaLiveResolver, SUPPORTED_PRODUCTS } = require('./live-resolver');

function fixture(options = {}) {
  const calls = [];
  const catalog = {
    attributes: async params => {
      calls.push(['attributes', params]);
      return '<select id="direccion-de-la-tela"><option value="DIN">Normal</option></select><select id="mecanismo"><option value="M03">VTX15B / CLIC M</option></select><select id="cenefa" idAttribute="2482"><option value="CP13BLA" idattributevalues="30328" itemcode="CENPEN13BLA" calculationtype="DimensionsWidth">PENTA13 BLANCA</option></select>';
    },
    alerts: async params => {
      calls.push(['alerts', params]);
      return { codigo: 100, AlertDefinitions: [], haveRestrictive: false };
    },
    defaults: async params => {
      calls.push(['defaults', params]);
      const width = Number(params.Width);
      return [
        { Name: 'Dirección de la tela', FriendlyName: 'direccion-de-la-tela', DefaultValue: width >= 4 ? 'TAN' : width >= 3 ? 'TAT' : 'DIN' },
        { Name: 'Mecanismo', FriendlyName: 'mecanismo', DefaultValue: width >= 4 ? 'NA' : width >= 3 ? 'M08' : width >= 1.8 ? 'M03' : 'M01' }
      ];
    },
    fixedPrice: async params => {
      calls.push(['fixedPrice', params]);
      return { Price: Math.max(1, Number(params.ancho) * Number(params.alto)) * 58900 };
    },
    validateRoller: async params => {
      calls.push(['validateRoller', params]);
      return { codigo: 100, altMaxEnrollable: 1, mensajeAlerta: '' };
    },
    dependencies: async params => {
      calls.push(['dependencies', params]);
      return { codigo: 100, ProductAttributeList: [] };
    },
    ...options.catalog
  };
  const pricing = {
    supplierCost: async params => {
      calls.push(['supplierCost', params]);
      return { basePrice: 100, distributorDiscount: 0, productDiscount: 0, pricingMode: 'account-discount', subtotal: 100, vatRate: .19, total: 119 };
    },
    ...options.pricing
  };
  return { resolver: new PentagramaLiveResolver({ catalog, pricing }), calls };
}

test('live resolver reproduces fixed-price Matte 3 and returns portal defaults', async () => {
  const { resolver, calls } = fixture();
  const result = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1.83, height: 2.2, quantity: 1 });
  assert.equal(result.outcome, 'PRICE');
  assert.equal(result.pricing.subtotal, 237131.4);
  assert.equal(result.pricing.total, 282186.37);
  assert.equal(result.configuration.mechanism, 'M03');
  assert.equal(result.configuration.orientationCode, 'DIN');
  assert.equal(result.configuration.system, 'STANDARD/PLATINA SIN CABEZAL');
  assert.equal(result.configuration.head, '');
  assert.equal(result.fallback.allowed, false);
  assert.equal(calls.find(call => call[0] === 'defaults')[1].PrimaryGroup, 'ENROLLABLE');
  assert.deepEqual(calls.map(call => call[0]), ['attributes', 'alerts', 'fixedPrice', 'supplierCost', 'defaults', 'validateRoller']);
  const boundary = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: .5, height: .5, quantity: 1 });
  assert.equal(boundary.pricing.total, 70091);
});

test('live resolver exposes the complete exact HomeEasy Enrollables crosswalk', () => {
  assert.equal(Object.keys(SUPPORTED_PRODUCTS).length, 279);
  assert.equal(SUPPORTED_PRODUCTS['enrollable-serenade-serenadebavaro'].productCode, 'ENRSTDTRSEBABRO');
  assert.equal(SUPPORTED_PRODUCTS['enrollable-dimout-bloom'].groupCode.length > 0, true);
  assert.equal(SUPPORTED_PRODUCTS['enrollable-soltis-soltisw96'].categories.Cat3, '454');
  assert.equal(SUPPORTED_PRODUCTS['enrollable-lona-lonatransparentecristaltec'].categories.Cat3, '499');
});

test('live resolver reports portal manufacturing alternatives with exact prices', async () => {
  const { resolver } = fixture();
  const crossed = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 3.5, height: 2, quantity: 1 });
  assert.equal(crossed.outcome, 'ALTERNATIVE');
  assert.equal(crossed.configuration.orientationCode, 'TAT');
  assert.equal(crossed.configuration.mechanism, 'M08');
  assert.equal(crossed.pricing.total, 490637);
  const joined = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 4.5, height: 3.2, quantity: 1 });
  assert.equal(joined.outcome, 'ALTERNATIVE');
  assert.equal(joined.configuration.orientationCode, 'TAN');
  assert.equal(joined.pricing.total, 1009310.4);
  assert.equal(joined.fabrication.requiresAuthorization, true);
});

test('live resolver prices Penta13 from the real portal option instead of hardcoding its codes', async () => {
  const { resolver, calls } = fixture();
  const result = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1.83, height: 2.2, configuration: 'penta13' });
  assert.equal(result.ok, true);
  assert.equal(result.configuration.head, 'PENTA13 BLANCA');
  assert.equal(result.pricing.complements[0].productCode, 'CENPEN13BLA');
  assert.equal(result.pricing.subtotal, 237231.4);
  assert.deepEqual(calls.find(call => call[0] === 'dependencies')[1], {
    idAttribute: '2482', idValueSelected: 'CP13BLA', productCode: 'ENRSTDBOMA3090', idAttributeValue: '30328'
  });
});

test('live resolver adds only explicitly mapped complements through Pentagrama', async () => {
  const { resolver, calls } = fixture();
  const result = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1, height: 2, quantity: 1, coverlight: 'coverlight-standard' });
  assert.equal(result.pricing.complements[0].productCode, 'KITPERCOLIBLA');
  assert.equal(result.pricing.total, 140301);
  assert.equal(calls.at(-1)[1].ItemCodeFather, 'ENRSTDBOMA3090');
  const unsupported = await resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1, height: 2, coverlight: 'unknown' });
  assert.equal(unsupported.outcome, 'UNSUPPORTED');
  assert.equal(unsupported.fallback.allowed, false);
});

test('live resolver never invents a price for an unmapped product', async () => {
  const { resolver } = fixture();
  const result = await resolver.resolve({ homeeasyId: 'unknown', width: 1, height: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'UNSUPPORTED');
  assert.equal(result.fallback.allowed, false);
});

test('live resolver separates unresolved configuration from explicit non-manufacturability', async () => {
  const unresolvedFixture = fixture({
    catalog: {
      defaults: async () => [{ FriendlyName: 'direccion-de-la-tela', DefaultValue: null }, { FriendlyName: 'mecanismo', DefaultValue: null }]
    }
  });
  const unresolvedResult = await unresolvedFixture.resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1.83, height: 2.2 });
  assert.equal(unresolvedResult.outcome, 'CONFIGURATION_UNRESOLVED');
  assert.equal(unresolvedResult.code, 'PENTAGRAMA_CONFIGURATION_UNRESOLVED');

  const rejectedFixture = fixture({
    catalog: {
      defaults: async () => [{ FriendlyName: 'direccion-de-la-tela', DefaultValue: 'NAN' }, { FriendlyName: 'mecanismo', DefaultValue: 'M03' }]
    }
  });
  const rejectedResult = await rejectedFixture.resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1.83, height: 2.2 });
  assert.equal(rejectedResult.outcome, 'NOT_MANUFACTURABLE');
  assert.equal(rejectedResult.code, 'PENTAGRAMA_NOT_MANUFACTURABLE');

  const validationFixture = fixture({
    catalog: {
      validateRoller: async () => ({ codigo: 100, altMaxEnrollable: 0, mensajeAlerta: 'Configuración inválida' })
    }
  });
  const validationResult = await validationFixture.resolver.resolve({ homeeasyId: 'enrollable-blackout-matte3', width: 1.83, height: 2.2 });
  assert.equal(validationResult.outcome, 'NOT_MANUFACTURABLE');
  assert.equal(validationResult.code, 'PENTAGRAMA_NOT_MANUFACTURABLE');
});
