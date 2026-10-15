'use strict';

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value && value.Data)) return value.Data;
  if (Array.isArray(value && value.data)) return value.data;
  return [];
}

function firstValue(item, names) {
  for (const name of names) {
    const value = item && item[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function cleanText(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeCode(value) {
  return cleanText(value).toUpperCase();
}

function categoryView(item) {
  const levels = Number(firstValue(item, ['Levels', 'levels', 'LevelCount', 'levelCount']));
  return {
    code: cleanText(firstValue(item, ['Code', 'code', 'Id', 'id', 'CategoryCode', 'categoryCode'])),
    name: cleanText(firstValue(item, ['Name', 'name', 'Description', 'description', 'CategoryName', 'categoryName'])),
    levels: Number.isFinite(levels) && levels > 0 ? Math.trunc(levels) : 1
  };
}

function externalKey(product) {
  const productCode = normalizeCode(product && product.productCode);
  const groupCode = normalizeCode(product && product.groupCode);
  const associationGroup = normalizeCode(product && product.associationGroup);
  if (!productCode) return '';
  return [productCode, groupCode, associationGroup].join('|');
}

function productView(item, path = [], categoryCodes = []) {
  const product = {
    name: cleanText(firstValue(item, ['ProductName', 'productName', 'Name', 'name', 'Description', 'description'])),
    productCode: cleanText(firstValue(item, ['ProductCode', 'productCode', 'Code', 'code'])),
    groupCode: cleanText(firstValue(item, ['GroupCode', 'groupCode', 'Group', 'group'])),
    associationGroup: cleanText(firstValue(item, ['GrupAsoc', 'grupAsoc', 'AssociationGroup', 'associationGroup'])),
    primaryGroup: cleanText(firstValue(item, ['PrimaryGroup', 'primaryGroup'])),
    calculationType: cleanText(firstValue(item, ['CalculationType', 'calculationType'])),
    unit: cleanText(firstValue(item, ['UnidadMedida', 'unidadMedida', 'Unit', 'unit'])),
    discount: Number(firstValue(item, ['Discount', 'discount']) || 0),
    encode: cleanText(firstValue(item, ['Encode', 'encode'])),
    path: path.map(cleanText).filter(Boolean),
    categoryCodes: categoryCodes.map(cleanText).filter(Boolean)
  };
  product.externalKey = externalKey(product);
  return product;
}

function categoryParams(path, includeLevel) {
  const params = {};
  if (includeLevel) params.level = path.length + 1;
  path.forEach((item, index) => { params['Category' + (index + 1)] = item.code; });
  return params;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const RETRYABLE_CODES = new Set([
  'AGENT_OFFLINE',
  'AGENT_TIMEOUT',
  'PENTAGRAMA_BROWSER_SESSION_REQUIRED',
  'PENTAGRAMA_SESSION_EXPIRED',
  'PENTAGRAMA_CAPTCHA_REQUIRED'
]);

class PentagramaCatalogInventory {
  constructor(options = {}) {
    if (!options.gateway || typeof options.gateway.dispatch !== 'function') {
      throw new TypeError('PentagramaCatalogInventory requires a gateway');
    }
    this.gateway = options.gateway;
    this.maxDepth = Math.max(1, Number(options.maxDepth || 8));
    this.maxLeaves = Math.max(1, Number(options.maxLeaves || 10000));
    this.maxRequests = Math.max(1, Number(options.maxRequests || 20000));
    this.retryWindowMs = Math.max(0, Number(options.retryWindowMs || 30 * 60 * 1000));
    this.retryDelayMs = Math.max(1000, Number(options.retryDelayMs || 10000));
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    this.requests = 0;
    this.startedAt = null;
  }

  async progress(patch = {}) {
    if (!this.onProgress) return;
    await this.onProgress({
      requests: this.requests,
      ...patch
    });
  }

  async catalog(operation, params) {
    this.requests += 1;
    if (this.requests > this.maxRequests) {
      throw Object.assign(new Error('Pentagrama catalog inventory exceeded request limit'), {
        code: 'PENTAGRAMA_CATALOG_INVENTORY_LIMIT'
      });
    }

    const retryStartedAt = Date.now();

    while (true) {
      try {
        const result = await this.gateway.dispatch('catalog', { operation, params: params || {} }, {
          lockKey: 'catalog-inventory:' + operation + ':' + JSON.stringify(params || {})
        });

        if (Date.now() - retryStartedAt > 1000) {
          await this.progress({
            status: 'RUNNING',
            waitingCode: null
          });
        }

        return result;
      } catch (error) {
        const code = String(error && error.code || 'CATALOG_ERROR');
        const elapsed = Date.now() - retryStartedAt;

        if (!RETRYABLE_CODES.has(code) || elapsed >= this.retryWindowMs) throw error;

        await this.progress({
          status: 'WAITING_AGENT',
          waitingCode: code,
          retryElapsedMs: elapsed
        });

        await wait(this.retryDelayMs);
      }
    }
  }

  async leavesFor(root) {
    const targetDepth = Math.min(this.maxDepth, Math.max(1, Number(root.levels || 1)));
    const leaves = [];
    const queue = [[root]];
    const seen = new Set();

    while (queue.length) {
      const path = queue.shift();
      const signature = path.map(item => item.code).join('>');
      if (seen.has(signature)) continue;
      seen.add(signature);

      if (leaves.length >= this.maxLeaves) {
        throw Object.assign(new Error('Pentagrama catalog inventory exceeded leaf limit'), {
          code: 'PENTAGRAMA_CATALOG_INVENTORY_LIMIT'
        });
      }

      if (path.length >= targetDepth) {
        leaves.push(path);
        continue;
      }

      const rawChildren = listOf(await this.catalog('categories', categoryParams(path, true)));
      const children = rawChildren.map(categoryView).filter(item => item.code);

      if (!children.length) {
        leaves.push(path);
        continue;
      }

      for (const child of children) queue.push([...path, child]);
    }

    return leaves;
  }

  async scan() {
    this.requests = 0;
    this.startedAt = Date.now();

    const roots = listOf(await this.catalog('categories', { level: 1 }))
      .map(categoryView)
      .filter(item => item.code);

    const byKey = new Map();
    const leafPaths = [];
    let skippedWithoutCode = 0;
    let duplicateAppearances = 0;

    await this.progress({
      status: 'RUNNING',
      rootsTotal: roots.length,
      rootsCompleted: 0,
      currentFamily: null,
      leaves: 0,
      products: 0,
      skippedWithoutCode: 0,
      duplicateAppearances: 0
    });

    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];

      await this.progress({
        status: 'RUNNING',
        rootsTotal: roots.length,
        rootsCompleted: index,
        currentFamily: root.name,
        currentFamilyCode: root.code,
        leaves: leafPaths.length,
        products: byKey.size,
        skippedWithoutCode,
        duplicateAppearances
      });

      const leaves = await this.leavesFor(root);

      for (const leaf of leaves) {
        leafPaths.push(leaf.map(item => item.name).filter(Boolean));
        const rawProducts = listOf(await this.catalog('products', categoryParams(leaf, false)));

        for (const raw of rawProducts) {
          const product = productView(raw, leaf.map(item => item.name), leaf.map(item => item.code));

          if (!product.externalKey) {
            skippedWithoutCode += 1;
            continue;
          }

          const current = byKey.get(product.externalKey);

          if (!current) {
            byKey.set(product.externalKey, { ...product, paths: [product.path] });
            continue;
          }

          duplicateAppearances += 1;
          const pathKey = product.path.join(' > ');
          if (!current.paths.some(item => item.join(' > ') === pathKey)) current.paths.push(product.path);
        }
      }

      await this.progress({
        status: 'RUNNING',
        rootsTotal: roots.length,
        rootsCompleted: index + 1,
        currentFamily: index + 1 < roots.length ? roots[index + 1].name : null,
        leaves: leafPaths.length,
        products: byKey.size,
        skippedWithoutCode,
        duplicateAppearances
      });
    }

    const products = [...byKey.values()].sort((a, b) =>
      a.productCode.localeCompare(b.productCode) ||
      a.groupCode.localeCompare(b.groupCode) ||
      a.associationGroup.localeCompare(b.associationGroup)
    );

    await this.progress({
      status: 'COMPLETED',
      rootsTotal: roots.length,
      rootsCompleted: roots.length,
      currentFamily: null,
      leaves: leafPaths.length,
      products: products.length,
      skippedWithoutCode,
      duplicateAppearances
    });

    return {
      checkedAt: new Date().toISOString(),
      roots: roots.length,
      leaves: leafPaths.length,
      requests: this.requests,
      skippedWithoutCode,
      duplicateAppearances,
      products,
      counts: {
        products: products.length,
        roots: roots.length,
        leaves: leafPaths.length,
        skippedWithoutCode,
        duplicateAppearances
      }
    };
  }
}

module.exports = Object.freeze({
  PentagramaCatalogInventory,
  categoryView,
  productView,
  externalKey,
  listOf,
  RETRYABLE_CODES
});
