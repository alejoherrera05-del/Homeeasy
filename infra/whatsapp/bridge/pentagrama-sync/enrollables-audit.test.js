'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const baseline = require('./enrollables-live-products.json');
const {
  PentagramaEnrollablesAudit,
  baselineSummary,
  routeKey,
  excludedPortalRouteNames
} = require('./enrollables-audit');

function entries() {
  return Object.values(baseline.products || {});
}

function category3Rows() {
  const map = new Map();
  for (const item of entries()) {
    const code = String(item.categories && item.categories.Cat3 || '');
    if (!map.has(code)) map.set(code, String(item.subfamily || code).toUpperCase());
  }
  return [...map.entries()].map(([Code, Name]) => ({ Code, Name }));
}

function category4Rows(cat3, extraRoute) {
  const map = new Map();
  for (const item of entries()) {
    if (String(item.categories && item.categories.Cat3 || '') !== String(cat3)) continue;
    const code = String(item.categories && item.categories.Cat4 || '');
    if (!map.has(code)) map.set(code, String(item.reference || code));
  }

  if (extraRoute && String(extraRoute.Cat3) === String(cat3)) {
    map.set(String(extraRoute.Cat4), String(extraRoute.Name));
  }

  return [...map.entries()].map(([Code, Name]) => ({ Code, Name }));
}

function productRows(cat3, cat4, options = {}) {
  if (
    options.omitRoute &&
    String(options.omitRoute.Cat3) === String(cat3) &&
    String(options.omitRoute.Cat4) === String(cat4)
  ) {
    return [];
  }

  const rows = entries()
    .filter(item =>
      String(item.categories && item.categories.Cat3 || '') === String(cat3) &&
      String(item.categories && item.categories.Cat4 || '') === String(cat4)
    )
    .map(item => ({
      ProductName: item.friendlyName,
      ProductCode: item.productCode,
      GroupCode: item.groupCode,
      GrupAsoc: item.associationGroup,
      CalculationType: item.calculationType
    }));

  if (
    options.extraVariant &&
    String(options.extraVariant.Cat3) === String(cat3) &&
    String(options.extraVariant.Cat4) === String(cat4)
  ) {
    rows.push(options.extraVariant.row);
  }

  if (
    options.extraRoute &&
    String(options.extraRoute.Cat3) === String(cat3) &&
    String(options.extraRoute.Cat4) === String(cat4)
  ) {
    rows.push(...options.extraRoute.rows);
  }

  return rows;
}

function gatewayWith(options = {}) {
  return {
    dispatch: async (type, payload) => {
      assert.equal(type, 'catalog');
      const params = payload.params || {};

      if (payload.operation === 'categories' && params.level === 3) {
        assert.equal(String(params.Category1), '4');
        assert.equal(String(params.Category2), '79');
        return category3Rows();
      }

      if (payload.operation === 'categories' && params.level === 4) {
        return category4Rows(params.Category3, options.extraRoute);
      }

      if (payload.operation === 'products') {
        return productRows(params.Category3, params.Category4, options);
      }

      throw new Error('unexpected audit request');
    }
  };
}

test('baseline has 279 HomeEasy entries, 278 product identities and 278 fabric routes', () => {
  const summary = baselineSummary();

  assert.equal(summary.entries.length, 279);
  assert.equal(summary.byKey.size, 278);
  assert.equal(summary.byRoute.size, 278);
  assert.equal(summary.logicalDuplicates.length, 1);

  assert.equal(
    summary.logicalDuplicates[0].routeKey,
    routeKey({ Cat1: '4', Cat2: '79', Cat3: '79', Cat4: '42' })
  );

  assert.deepEqual(summary.logicalDuplicates[0].homeeasyIds.sort(), [
    'enrollable-trasluz-calais-blanco-crema',
    'enrollable-trasluz-calais-otros'
  ].sort());
});

test('exact live baseline has zero route deltas', async () => {
  const audit = new PentagramaEnrollablesAudit({
    gateway: gatewayWith(),
    wait: async () => {}
  });

  const result = await audit.run();

  assert.equal(result.baseline.entries, 279);
  assert.equal(result.baseline.uniqueIdentities, 278);
  assert.equal(result.baseline.uniqueRoutes, 278);

  assert.equal(result.live.uniqueIdentities, 278);
  assert.equal(result.live.uniqueRoutes, 278);

  assert.equal(result.routeComparison.presentRoutes, 278);
  assert.equal(result.routeComparison.addedRoutes, 0);
  assert.equal(result.routeComparison.missingRoutes, 0);
  assert.equal(result.routeComparison.movedExpectedProducts, 0);
  assert.equal(result.routeComparison.missingExpectedProductsInRoute, 0);
  assert.equal(result.routeComparison.additionalVariantsInKnownRoutes, 0);
  assert.equal(result.routeComparison.addedRouteProductCount, 0);
  assert.equal(result.routeComparison.exactReferenceStructure, true);

  assert.equal(result.skuComparison.present, 278);
  assert.equal(result.skuComparison.added, 0);
  assert.equal(result.skuComparison.missing, 0);
});

test('an extra color SKU inside an existing fabric route is a variant, not a new reference', async () => {
  const first = entries()[0];

  const audit = new PentagramaEnrollablesAudit({
    gateway: gatewayWith({
      extraVariant: {
        Cat3: first.categories.Cat3,
        Cat4: first.categories.Cat4,
        row: {
          ProductName: 'Angora variante color',
          ProductCode: 'ENRSTDBOANGTEST',
          GroupCode: first.groupCode,
          GrupAsoc: first.associationGroup,
          CalculationType: first.calculationType
        }
      }
    }),
    wait: async () => {}
  });

  const result = await audit.run();

  assert.equal(result.live.uniqueRoutes, 278);
  assert.equal(result.routeComparison.addedRoutes, 0);
  assert.equal(result.routeComparison.missingRoutes, 0);
  assert.equal(result.routeComparison.additionalVariantsInKnownRoutes, 1);
  assert.equal(result.routeComparison.exactReferenceStructure, true);

  assert.equal(result.skuComparison.present, 278);
  assert.equal(result.skuComparison.added, 1);
  assert.equal(result.skuComparison.missing, 0);
});

test('a genuinely new Cat4 fabric route is reported separately from its color SKUs', async () => {
  const first = entries()[0];

  const audit = new PentagramaEnrollablesAudit({
    gateway: gatewayWith({
      extraRoute: {
        Cat3: first.categories.Cat3,
        Cat4: '999999',
        Name: 'TELA NUEVA REAL',
        rows: [
          {
            ProductName: 'Tela nueva White',
            ProductCode: 'ENRNEWW',
            GroupCode: '999',
            GrupAsoc: 'ENRSTD',
            CalculationType: 'NormalProduct'
          },
          {
            ProductName: 'Tela nueva Grey',
            ProductCode: 'ENRNEWG',
            GroupCode: '999',
            GrupAsoc: 'ENRSTD',
            CalculationType: 'NormalProduct'
          }
        ]
      }
    }),
    wait: async () => {}
  });

  const result = await audit.run();

  assert.equal(result.live.uniqueRoutes, 279);
  assert.equal(result.routeComparison.presentRoutes, 278);
  assert.equal(result.routeComparison.addedRoutes, 1);
  assert.equal(result.routeComparison.missingRoutes, 0);
  assert.equal(result.routeComparison.addedRouteProductCount, 2);
  assert.equal(result.routeComparison.additionalVariantsInKnownRoutes, 0);
  assert.equal(result.routeComparison.exactReferenceStructure, false);

  assert.equal(result.deltas.addedRoutes.length, 1);
  assert.equal(result.deltas.addedRoutes[0].referenceName, 'TELA NUEVA REAL');
  assert.equal(result.deltas.addedRoutes[0].productCount, 2);
});

test('a missing expected fabric route is reported as a removed reference route', async () => {
  const first = entries()[0];

  const audit = new PentagramaEnrollablesAudit({
    gateway: gatewayWith({
      omitRoute: {
        Cat3: first.categories.Cat3,
        Cat4: first.categories.Cat4
      }
    }),
    wait: async () => {}
  });

  const result = await audit.run();

  // The category route still exists in this fixture, but its expected ProductCode is missing.
  assert.equal(result.routeComparison.missingRoutes, 0);
  assert.equal(result.routeComparison.missingExpectedProductsInRoute, 1);
  assert.equal(result.routeComparison.exactReferenceStructure, false);
  assert.equal(result.skuComparison.missing, 1);
});


test('blank Cat4 and zero Cat4 are the same logical fabric route', () => {
  assert.equal(
    routeKey({ Cat1: '4', Cat2: '79', Cat3: '499', Cat4: '' }),
    routeKey({ Cat1: '4', Cat2: '79', Cat3: '499', Cat4: '0' })
  );
  assert.equal(
    routeKey({ Cat1: '4', Cat2: '79', Cat3: '499', Cat4: '' }),
    '4|79|499|0'
  );
});

test('known portal-only Enrollables remain explicit exclusions', () => {
  const exclusions = excludedPortalRouteNames();

  assert.equal(exclusions.has('TRASLUZ|AMORE'), true);
  assert.equal(exclusions.has('TRASLUZ|ECOSCREEN'), true);
  assert.equal(exclusions.has('TRASLUZ|NATURA'), true);
  assert.equal(exclusions.size, 3);
});

test('portal-only routes are reported separately and do not become HomeEasy additions', async () => {
  const first = entries().find(item => String(item.categories && item.categories.Cat3) === '79') || entries()[0];

  const exclusionRows = [
    { Cat4: '2324', Name: 'AMORE', ProductCode: 'ENRSTDTRAMCO' },
    { Cat4: '2325', Name: 'ECOSCREEN', ProductCode: 'ENRSTDTRECOAL' },
    { Cat4: '2326', Name: 'NATURA', ProductCode: 'ENRSTDTRNAWHLI' }
  ];

  const originalCategory4Rows = category4Rows;
  const originalProductRows = productRows;

  const gateway = {
    dispatch: async (type, payload) => {
      assert.equal(type, 'catalog');
      const params = payload.params || {};

      if (payload.operation === 'categories' && params.level === 3) {
        return category3Rows();
      }

      if (payload.operation === 'categories' && params.level === 4) {
        const rows = originalCategory4Rows(params.Category3);
        if (String(params.Category3) === '79') {
          rows.push(...exclusionRows.map(item => ({ Code: item.Cat4, Name: item.Name })));
        }
        return rows;
      }

      if (payload.operation === 'products') {
        const extra = exclusionRows.find(item =>
          String(params.Category3) === '79' &&
          String(params.Category4) === item.Cat4
        );

        if (extra) {
          return [{
            ProductName: extra.Name + ' sample',
            ProductCode: extra.ProductCode,
            GroupCode: '326',
            GrupAsoc: 'ENRSTD',
            CalculationType: 'NormalProduct'
          }];
        }

        return originalProductRows(params.Category3, params.Category4);
      }

      throw new Error('unexpected audit request');
    }
  };

  const audit = new PentagramaEnrollablesAudit({
    gateway,
    wait: async () => {}
  });

  const result = await audit.run();

  assert.equal(result.routeComparison.addedRoutes, 0);
  assert.equal(result.routeComparison.missingRoutes, 0);
  assert.equal(result.routeComparison.exactReferenceStructure, true);
  assert.equal(result.live.excludedPortalRoutes, 3);
  assert.equal(result.live.excludedPortalSkuCount, 3);
  assert.deepEqual(
    result.exclusions.portalOnlyRoutes.map(route => route.referenceName).sort(),
    ['AMORE', 'ECOSCREEN', 'NATURA']
  );
});

test('live Lona with blank Cat4 matches baseline Lona stored as Cat4 zero', async () => {
  const gateway = {
    dispatch: async (type, payload) => {
      assert.equal(type, 'catalog');
      const params = payload.params || {};

      if (payload.operation === 'categories' && params.level === 3) {
        return category3Rows();
      }

      if (payload.operation === 'categories' && params.level === 4) {
        const rows = category4Rows(params.Category3);
        if (String(params.Category3) === '499') {
          return rows.map(row =>
            String(row.Code) === '0'
              ? { Code: '', Name: row.Name }
              : row
          );
        }
        return rows;
      }

      if (payload.operation === 'products') {
        const cat4 = String(params.Category4 || '');
        if (String(params.Category3) === '499' && cat4 === '') {
          return productRows('499', '0');
        }
        return productRows(params.Category3, params.Category4);
      }

      throw new Error('unexpected audit request');
    }
  };

  const audit = new PentagramaEnrollablesAudit({
    gateway,
    wait: async () => {}
  });

  const result = await audit.run();

  assert.equal(result.routeComparison.presentRoutes, 278);
  assert.equal(result.routeComparison.addedRoutes, 0);
  assert.equal(result.routeComparison.missingRoutes, 0);
  assert.equal(result.routeComparison.exactReferenceStructure, true);
});
