'use strict';

const baseline = require('./enrollables-live-products.json');
const { RETRYABLE_CODES } = require('./catalog-inventory');

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.Data)) return value.Data;
  if (Array.isArray(value && value.data)) return value.data;
  return [];
}

function clean(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function first(item, names) {
  for (const name of names) {
    const value = item && item[name];
    if (value !== undefined && value !== null && clean(value)) return value;
  }
  return '';
}

function category(item) {
  return {
    code: clean(first(item, ['Code', 'code', 'Id', 'id', 'CategoryCode', 'categoryCode'])),
    name: clean(first(item, ['Name', 'name', 'Description', 'description', 'CategoryName', 'categoryName']))
  };
}

function routeKey(parts) {
  return [
    clean(parts && parts.Cat1),
    clean(parts && parts.Cat2),
    clean(parts && parts.Cat3),
    clean(parts && parts.Cat4)
  ].join('|');
}

function productKey(item) {
  return [
    upper(item && item.productCode),
    upper(item && item.groupCode),
    upper(item && item.associationGroup)
  ].join('|');
}

function liveProduct(item, route) {
  const product = {
    name: clean(first(item, ['ProductName', 'productName', 'Name', 'name', 'Description', 'description'])),
    productCode: clean(first(item, ['ProductCode', 'productCode', 'Code', 'code'])),
    groupCode: clean(first(item, ['GroupCode', 'groupCode', 'Group', 'group'])),
    associationGroup: clean(first(item, ['GrupAsoc', 'grupAsoc', 'AssociationGroup', 'associationGroup'])),
    calculationType: clean(first(item, ['CalculationType', 'calculationType'])),
    unit: clean(first(item, ['UnidadMedida', 'unidadMedida', 'Unit', 'unit'])),
    routeKey: route.routeKey,
    categories: { ...route.categories },
    path: route.path.slice()
  };
  product.externalKey = productKey(product);
  return product;
}

function baselineEntries() {
  return Object.values(baseline && baseline.products || {});
}

function baselineSummary() {
  const entries = baselineEntries();
  const byKey = new Map();
  const byRoute = new Map();
  const subfamilies = new Map();

  for (const item of entries) {
    const key = productKey(item);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);

    const categories = item && item.categories || {};
    const rKey = routeKey(categories);
    if (!byRoute.has(rKey)) {
      byRoute.set(rKey, {
        routeKey: rKey,
        categories: {
          Cat1: clean(categories.Cat1),
          Cat2: clean(categories.Cat2),
          Cat3: clean(categories.Cat3),
          Cat4: clean(categories.Cat4)
        },
        subfamily: clean(item && item.subfamily),
        references: [],
        homeeasyIds: [],
        productKeys: new Set()
      });
    }
    const route = byRoute.get(rKey);
    route.references.push(clean(item && item.reference));
    route.homeeasyIds.push(clean(item && item.homeeasyId));
    route.productKeys.add(key);

    const subfamily = clean(item && item.subfamily) || 'sin-clasificar';
    subfamilies.set(subfamily, (subfamilies.get(subfamily) || 0) + 1);
  }

  const logicalDuplicates = [...byRoute.values()]
    .filter(route => route.homeeasyIds.length > 1)
    .map(route => ({
      routeKey: route.routeKey,
      categories: route.categories,
      homeeasyIds: route.homeeasyIds,
      references: route.references,
      productKeys: [...route.productKeys]
    }));

  return {
    entries,
    byKey,
    byRoute,
    logicalDuplicates,
    subfamilies: [...subfamilies.entries()]
      .map(([subfamily, count]) => ({ subfamily, count }))
      .sort((a, b) => b.count - a.count || a.subfamily.localeCompare(b.subfamily))
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class PentagramaEnrollablesAudit {
  constructor(options = {}) {
    if (!options.gateway || typeof options.gateway.dispatch !== 'function') {
      throw new TypeError('PentagramaEnrollablesAudit requires a gateway');
    }
    this.gateway = options.gateway;
    this.retryWindowMs = Math.max(0, Number(options.retryWindowMs || 60 * 60 * 1000));
    this.retryDelayMs = Math.max(1000, Number(options.retryDelayMs || 10000));
    this.wait = typeof options.wait === 'function' ? options.wait : wait;
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    this.requests = 0;
  }

  async progress(patch) {
    if (!this.onProgress) return;
    await this.onProgress({ requests: this.requests, ...patch });
  }

  async catalog(operation, params) {
    this.requests += 1;
    const startedAt = Date.now();

    while (true) {
      try {
        return await this.gateway.dispatch('catalog', { operation, params }, {
          lockKey: 'enrollables-audit:' + operation + ':' + JSON.stringify(params || {})
        });
      } catch (error) {
        const code = String(error && error.code || 'CATALOG_ERROR');
        const elapsed = Date.now() - startedAt;
        if (!RETRYABLE_CODES.has(code) || elapsed >= this.retryWindowMs) throw error;

        await this.progress({
          status: 'WAITING_AGENT',
          waitingCode: code
        });
        await this.wait(this.retryDelayMs);
      }
    }
  }

  async scanLive() {
    this.requests = 0;

    const cat3 = listOf(await this.catalog('categories', {
      level: 3,
      Category1: '4',
      Category2: '79'
    })).map(category).filter(item => item.code);

    const byKey = new Map();
    const byProductCode = new Map();
    const byRoute = new Map();
    let duplicateAppearances = 0;
    let skippedWithoutCode = 0;

    await this.progress({
      status: 'RUNNING',
      groupsTotal: cat3.length,
      groupsCompleted: 0,
      currentGroup: null,
      leaves: 0,
      products: 0
    });

    for (let index = 0; index < cat3.length; index++) {
      const group = cat3[index];

      await this.progress({
        status: 'RUNNING',
        groupsTotal: cat3.length,
        groupsCompleted: index,
        currentGroup: group.name,
        leaves: byRoute.size,
        products: byKey.size
      });

      const cat4 = listOf(await this.catalog('categories', {
        level: 4,
        Category1: '4',
        Category2: '79',
        Category3: group.code
      })).map(category).filter(item => item.code);

      const productPaths = cat4.length ? cat4 : [{ code: '', name: '' }];

      for (const leaf of productPaths) {
        const categories = {
          Cat1: '4',
          Cat2: '79',
          Cat3: group.code,
          Cat4: leaf.code
        };
        const rKey = routeKey(categories);
        const route = {
          routeKey: rKey,
          categories,
          groupName: group.name,
          referenceName: leaf.name,
          path: [
            'ENROLLABLE',
            'STANDARD/PLATINA SIN CABEZAL',
            group.name,
            leaf.name
          ].filter(Boolean),
          products: new Map()
        };
        byRoute.set(rKey, route);

        const params = {
          Category1: '4',
          Category2: '79',
          Category3: group.code
        };
        if (leaf.code) params.Category4 = leaf.code;

        const rawProducts = listOf(await this.catalog('products', params));

        for (const raw of rawProducts) {
          const product = liveProduct(raw, route);

          if (!product.productCode) {
            skippedWithoutCode += 1;
            continue;
          }

          if (route.products.has(product.externalKey)) continue;
          route.products.set(product.externalKey, product);

          if (byKey.has(product.externalKey)) {
            duplicateAppearances += 1;
          } else {
            byKey.set(product.externalKey, product);
          }

          const pCode = upper(product.productCode);
          if (!byProductCode.has(pCode)) byProductCode.set(pCode, []);
          if (!byProductCode.get(pCode).some(item => item.routeKey === product.routeKey && item.externalKey === product.externalKey)) {
            byProductCode.get(pCode).push(product);
          }
        }
      }

      await this.progress({
        status: 'RUNNING',
        groupsTotal: cat3.length,
        groupsCompleted: index + 1,
        currentGroup: index + 1 < cat3.length ? cat3[index + 1].name : null,
        leaves: byRoute.size,
        products: byKey.size
      });
    }

    return {
      groups: cat3,
      byKey,
      byProductCode,
      byRoute,
      duplicateAppearances,
      skippedWithoutCode
    };
  }

  async run() {
    const expected = baselineSummary();
    const live = await this.scanLive();

    const expectedRouteKeys = new Set(expected.byRoute.keys());
    const liveRouteKeys = new Set(live.byRoute.keys());

    const presentRoutes = [...expectedRouteKeys].filter(key => liveRouteKeys.has(key));
    const missingRoutes = [...expectedRouteKeys].filter(key => !liveRouteKeys.has(key));
    const addedRoutes = [...liveRouteKeys].filter(key => !expectedRouteKeys.has(key));

    const movedExpectedProducts = [];
    const missingExpectedProductsInRoute = [];
    let expectedProductsPresentInOwnRoute = 0;
    let additionalVariantsInKnownRoutes = 0;

    for (const rKey of presentRoutes) {
      const expectedRoute = expected.byRoute.get(rKey);
      const liveRoute = live.byRoute.get(rKey);
      const expectedProductKeys = expectedRoute.productKeys;

      for (const key of expectedProductKeys) {
        if (liveRoute.products.has(key)) {
          expectedProductsPresentInOwnRoute += 1;
          continue;
        }

        const expectedItems = expected.byKey.get(key) || [];
        const firstItem = expectedItems[0] || {};
        const elsewhere = live.byKey.get(key);

        if (elsewhere) {
          movedExpectedProducts.push({
            externalKey: key,
            productCode: clean(firstItem.productCode),
            fromRoute: rKey,
            toRoute: elsewhere.routeKey,
            homeeasyIds: expectedItems.map(item => item.homeeasyId)
          });
        } else {
          missingExpectedProductsInRoute.push({
            externalKey: key,
            productCode: clean(firstItem.productCode),
            routeKey: rKey,
            homeeasyIds: expectedItems.map(item => item.homeeasyId)
          });
        }
      }

      for (const key of liveRoute.products.keys()) {
        if (!expectedProductKeys.has(key)) additionalVariantsInKnownRoutes += 1;
      }
    }

    const addedRouteDetails = addedRoutes.map(key => {
      const route = live.byRoute.get(key);
      return {
        routeKey: key,
        categories: route.categories,
        groupName: route.groupName,
        referenceName: route.referenceName,
        productCount: route.products.size,
        products: [...route.products.values()].slice(0, 12).map(product => ({
          externalKey: product.externalKey,
          productCode: product.productCode,
          groupCode: product.groupCode,
          associationGroup: product.associationGroup,
          name: product.name
        }))
      };
    });

    const missingRouteDetails = missingRoutes.map(key => {
      const route = expected.byRoute.get(key);
      return {
        routeKey: key,
        categories: route.categories,
        subfamily: route.subfamily,
        references: route.references,
        homeeasyIds: route.homeeasyIds,
        productKeys: [...route.productKeys]
      };
    });

    const addedRouteProductCount = addedRouteDetails
      .reduce((sum, route) => sum + route.productCount, 0);

    const liveIdentityKeys = new Set(live.byKey.keys());
    const expectedIdentityKeys = new Set(expected.byKey.keys());
    const presentIdentities = [...expectedIdentityKeys].filter(key => liveIdentityKeys.has(key));
    const addedIdentities = [...liveIdentityKeys].filter(key => !expectedIdentityKeys.has(key));
    const missingIdentities = [...expectedIdentityKeys].filter(key => !liveIdentityKeys.has(key));

    return {
      checkedAt: new Date().toISOString(),
      scope: {
        family: 'ENROLLABLE',
        system: 'STANDARD/PLATINA SIN CABEZAL',
        Cat1: '4',
        Cat2: '79'
      },
      baseline: {
        entries: expected.entries.length,
        uniqueIdentities: expected.byKey.size,
        uniqueRoutes: expected.byRoute.size,
        logicalDuplicates: expected.logicalDuplicates.length,
        logicalDuplicateDetails: expected.logicalDuplicates,
        subfamilies: expected.subfamilies
      },
      live: {
        uniqueIdentities: live.byKey.size,
        uniqueRoutes: live.byRoute.size,
        categoryGroups: live.groups.length,
        requests: this.requests,
        duplicateAppearances: live.duplicateAppearances,
        skippedWithoutCode: live.skippedWithoutCode
      },
      routeComparison: {
        presentRoutes: presentRoutes.length,
        addedRoutes: addedRoutes.length,
        missingRoutes: missingRoutes.length,
        expectedProductsPresentInOwnRoute,
        movedExpectedProducts: movedExpectedProducts.length,
        missingExpectedProductsInRoute: missingExpectedProductsInRoute.length,
        additionalVariantsInKnownRoutes,
        addedRouteProductCount,
        exactReferenceStructure:
          addedRoutes.length === 0 &&
          missingRoutes.length === 0 &&
          movedExpectedProducts.length === 0 &&
          missingExpectedProductsInRoute.length === 0
      },
      skuComparison: {
        present: presentIdentities.length,
        added: addedIdentities.length,
        missing: missingIdentities.length
      },
      deltas: {
        addedRoutes: addedRouteDetails,
        missingRoutes: missingRouteDetails,
        movedExpectedProducts,
        missingExpectedProductsInRoute
      }
    };
  }
}

module.exports = Object.freeze({
  PentagramaEnrollablesAudit,
  baselineSummary,
  productKey,
  routeKey,
  liveProduct,
  category,
  listOf
});
