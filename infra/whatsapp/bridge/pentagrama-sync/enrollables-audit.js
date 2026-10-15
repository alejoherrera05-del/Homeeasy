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

function liveProduct(item, path) {
  const product = {
    name: clean(first(item, ['ProductName', 'productName', 'Name', 'name', 'Description', 'description'])),
    productCode: clean(first(item, ['ProductCode', 'productCode', 'Code', 'code'])),
    groupCode: clean(first(item, ['GroupCode', 'groupCode', 'Group', 'group'])),
    associationGroup: clean(first(item, ['GrupAsoc', 'grupAsoc', 'AssociationGroup', 'associationGroup'])),
    calculationType: clean(first(item, ['CalculationType', 'calculationType'])),
    unit: clean(first(item, ['UnidadMedida', 'unidadMedida', 'Unit', 'unit'])),
    path: Array.isArray(path) ? path.slice() : []
  };
  product.externalKey = [upper(product.productCode), upper(product.groupCode), upper(product.associationGroup)].join('|');
  return product;
}

function baselineEntries() {
  return Object.values(baseline && baseline.products || {});
}

function baselineKey(item) {
  return [upper(item && item.productCode), upper(item && item.groupCode), upper(item && item.associationGroup)].join('|');
}

function baselineSummary() {
  const entries = baselineEntries();
  const byKey = new Map();
  const subfamilies = new Map();

  for (const item of entries) {
    const key = baselineKey(item);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);

    const subfamily = clean(item && item.subfamily) || 'sin-clasificar';
    subfamilies.set(subfamily, (subfamilies.get(subfamily) || 0) + 1);
  }

  const logicalDuplicates = [...byKey.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([externalKey, items]) => ({
      externalKey,
      homeeasyIds: items.map(item => item.homeeasyId),
      references: items.map(item => item.reference)
    }));

  return {
    entries,
    byKey,
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
    const subfamilies = new Map();
    let leaves = 0;
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
        leaves,
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
        const params = {
          Category1: '4',
          Category2: '79',
          Category3: group.code
        };
        if (leaf.code) params.Category4 = leaf.code;

        leaves += 1;
        const rawProducts = listOf(await this.catalog('products', params));

        for (const raw of rawProducts) {
          const product = liveProduct(raw, [
            'ENROLLABLE',
            'STANDARD/PLATINA SIN CABEZAL',
            group.name,
            leaf.name
          ].filter(Boolean));

          if (!product.productCode) {
            skippedWithoutCode += 1;
            continue;
          }

          if (byKey.has(product.externalKey)) {
            duplicateAppearances += 1;
            continue;
          }

          byKey.set(product.externalKey, product);

          const productCode = upper(product.productCode);
          if (!byProductCode.has(productCode)) byProductCode.set(productCode, []);
          byProductCode.get(productCode).push(product);
        }
      }

      subfamilies.set(group.name, byKey.size);

      await this.progress({
        status: 'RUNNING',
        groupsTotal: cat3.length,
        groupsCompleted: index + 1,
        currentGroup: index + 1 < cat3.length ? cat3[index + 1].name : null,
        leaves,
        products: byKey.size
      });
    }

    return {
      groups: cat3,
      byKey,
      byProductCode,
      leaves,
      duplicateAppearances,
      skippedWithoutCode
    };
  }

  async run() {
    const expected = baselineSummary();
    const live = await this.scanLive();

    const expectedKeys = new Set(expected.byKey.keys());
    const liveKeys = new Set(live.byKey.keys());

    const present = [...expectedKeys].filter(key => liveKeys.has(key));
    const missing = [...expectedKeys].filter(key => !liveKeys.has(key));
    const added = [...liveKeys].filter(key => !expectedKeys.has(key));

    const structureChanged = [];
    const structureChangedMissing = new Set();
    const structureChangedAdded = new Set();

    for (const missingKey of missing) {
      const baselineItems = expected.byKey.get(missingKey) || [];
      const reference = baselineItems[0] || {};
      const productCode = upper(reference.productCode);
      const candidates = live.byProductCode.get(productCode) || [];

      if (candidates.length) {
        structureChangedMissing.add(missingKey);
        for (const candidate of candidates) structureChangedAdded.add(candidate.externalKey);
        structureChanged.push({
          productCode: clean(reference.productCode),
          expected: {
            externalKey: missingKey,
            groupCode: clean(reference.groupCode),
            associationGroup: clean(reference.associationGroup),
            homeeasyIds: baselineItems.map(item => item.homeeasyId)
          },
          live: candidates.map(candidate => ({
            externalKey: candidate.externalKey,
            groupCode: candidate.groupCode,
            associationGroup: candidate.associationGroup,
            name: candidate.name,
            path: candidate.path
          }))
        });
      }
    }

    const trueMissing = missing.filter(key => !structureChangedMissing.has(key));
    const trueAdded = added.filter(key => !structureChangedAdded.has(key));

    const detailForBaseline = key => {
      const items = expected.byKey.get(key) || [];
      const firstItem = items[0] || {};
      return {
        externalKey: key,
        productCode: clean(firstItem.productCode),
        groupCode: clean(firstItem.groupCode),
        associationGroup: clean(firstItem.associationGroup),
        homeeasyIds: items.map(item => item.homeeasyId),
        references: items.map(item => item.reference)
      };
    };

    const detailForLive = key => {
      const item = live.byKey.get(key) || {};
      return {
        externalKey: key,
        productCode: item.productCode,
        groupCode: item.groupCode,
        associationGroup: item.associationGroup,
        name: item.name,
        path: item.path
      };
    };

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
        logicalDuplicates: expected.logicalDuplicates.length,
        logicalDuplicateDetails: expected.logicalDuplicates,
        subfamilies: expected.subfamilies
      },
      live: {
        uniqueIdentities: live.byKey.size,
        categoryGroups: live.groups.length,
        leaves: live.leaves,
        requests: this.requests,
        duplicateAppearances: live.duplicateAppearances,
        skippedWithoutCode: live.skippedWithoutCode
      },
      comparison: {
        present: present.length,
        added: trueAdded.length,
        missing: trueMissing.length,
        structureChanged: structureChanged.length,
        exactIdentityMatch: trueAdded.length === 0 && trueMissing.length === 0 && structureChanged.length === 0
      },
      deltas: {
        added: trueAdded.map(detailForLive),
        missing: trueMissing.map(detailForBaseline),
        structureChanged
      }
    };
  }
}

module.exports = Object.freeze({
  PentagramaEnrollablesAudit,
  baselineSummary,
  baselineKey,
  liveProduct,
  category,
  listOf
});
