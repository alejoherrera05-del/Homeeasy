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

class PentagramaCatalogInventory {
  constructor(options = {}) {
    const hasGateway = options.gateway && typeof options.gateway.dispatch === 'function';
    const hasCatalog = options.catalog && typeof options.catalog.categories === 'function' && typeof options.catalog.products === 'function';
    if (!hasGateway && !hasCatalog) {
      throw new TypeError('PentagramaCatalogInventory requires a gateway or catalog client');
    }
    this.gateway = hasGateway ? options.gateway : null;
    this.catalogApi = hasCatalog ? options.catalog : null;
    this.maxDepth = Math.max(1, Number(options.maxDepth || 8));
    this.maxLeaves = Math.max(1, Number(options.maxLeaves || 10000));
    this.maxRequests = Math.max(1, Number(options.maxRequests || 20000));
    this.requests = 0;
  }

  async catalog(operation, params) {
    this.requests += 1;
    if (this.requests > this.maxRequests) {
      throw Object.assign(new Error('Pentagrama catalog inventory exceeded request limit'), {
        code: 'PENTAGRAMA_CATALOG_INVENTORY_LIMIT'
      });
    }
    if (this.catalogApi) {
      if (!['categories', 'products'].includes(operation) || typeof this.catalogApi[operation] !== 'function') {
        throw Object.assign(new Error('Unsupported local catalog inventory operation'), {
          code: 'PENTAGRAMA_CATALOG_INVENTORY_OPERATION_NOT_ALLOWED'
        });
      }
      return this.catalogApi[operation](params || {});
    }
    return this.gateway.dispatch('catalog', { operation, params: params || {} }, {
      lockKey: 'catalog-inventory:' + operation + ':' + JSON.stringify(params || {})
    });
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
    const roots = listOf(await this.catalog('categories', { level: 1 }))
      .map(categoryView)
      .filter(item => item.code);

    const byKey = new Map();
    const leafPaths = [];
    let skippedWithoutCode = 0;
    let duplicateAppearances = 0;

    for (const root of roots) {
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
    }

    const products = [...byKey.values()].sort((a, b) =>
      a.productCode.localeCompare(b.productCode) ||
      a.groupCode.localeCompare(b.groupCode) ||
      a.associationGroup.localeCompare(b.associationGroup)
    );

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

function bindingExternalKey(binding) {
  if (binding && binding.externalKey) return String(binding.externalKey);
  return externalKey(binding || {});
}

function compareInventory(bindings, inventoryProducts, options = {}) {
  const bound = Array.isArray(bindings) ? bindings : [];
  const live = Array.isArray(inventoryProducts) ? inventoryProducts : [];
  const liveByKey = new Map(live.filter(item => item && item.externalKey).map(item => [item.externalKey, item]));
  const boundByKey = new Map(bound.map(item => [bindingExternalKey(item), item]).filter(([key]) => key));
  const liveByProductCode = new Map();
  const boundByProductCode = new Map();

  for (const item of live) {
    const code = normalizeCode(item && item.productCode);
    if (!code) continue;
    if (!liveByProductCode.has(code)) liveByProductCode.set(code, []);
    liveByProductCode.get(code).push(item);
  }
  for (const item of bound) {
    const code = normalizeCode(item && item.productCode);
    if (!code) continue;
    if (!boundByProductCode.has(code)) boundByProductCode.set(code, []);
    boundByProductCode.get(code).push(item);
  }

  const results = [];
  const consumedBindings = new Set();

  for (const liveItem of live) {
    const binding = boundByKey.get(liveItem.externalKey);
    if (binding) {
      consumedBindings.add(binding);
      const oldName = cleanText(binding.reference || binding.name);
      const newName = cleanText(typeof options.nameResolver === 'function' ? options.nameResolver(liveItem, binding) : liveItem.name);
      results.push({
        status: oldName && newName && oldName !== newName ? 'RENAMED' : 'PRESENT',
        externalKey: liveItem.externalKey,
        homeeasyId: binding.homeeasyId || binding.id || '',
        productCode: liveItem.productCode,
        oldName,
        newName,
        live: liveItem,
        binding
      });
      continue;
    }

    const sameCodeBindings = boundByProductCode.get(normalizeCode(liveItem.productCode)) || [];
    const unmatchedSameCode = sameCodeBindings.filter(item => !consumedBindings.has(item));
    if (unmatchedSameCode.length === 1 && (liveByProductCode.get(normalizeCode(liveItem.productCode)) || []).length === 1) {
      const structuralBinding = unmatchedSameCode[0];
      consumedBindings.add(structuralBinding);
      results.push({
        status: 'STRUCTURE_CHANGED',
        externalKey: liveItem.externalKey,
        previousExternalKey: bindingExternalKey(structuralBinding),
        homeeasyId: structuralBinding.homeeasyId || structuralBinding.id || '',
        productCode: liveItem.productCode,
        oldName: cleanText(structuralBinding.reference || structuralBinding.name),
        newName: cleanText(typeof options.nameResolver === 'function' ? options.nameResolver(liveItem, structuralBinding) : liveItem.name),
        live: liveItem,
        binding: structuralBinding
      });
      continue;
    }

    results.push({
      status: 'NEW',
      externalKey: liveItem.externalKey,
      homeeasyId: '',
      productCode: liveItem.productCode,
      oldName: '',
      newName: cleanText(typeof options.nameResolver === 'function' ? options.nameResolver(liveItem, null) : liveItem.name),
      live: liveItem,
      binding: null
    });
  }

  for (const binding of bound) {
    if (consumedBindings.has(binding)) continue;
    const key = bindingExternalKey(binding);
    if (!key || liveByKey.has(key)) continue;
    results.push({
      status: binding.active === false ? 'INACTIVE_MISSING' : 'DISCONTINUED',
      externalKey: key,
      homeeasyId: binding.homeeasyId || binding.id || '',
      productCode: cleanText(binding.productCode),
      oldName: cleanText(binding.reference || binding.name),
      newName: '',
      live: null,
      binding
    });
  }

  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return { counts, results };
}

module.exports = Object.freeze({
  PentagramaCatalogInventory,
  categoryView,
  productView,
  externalKey,
  compareInventory,
  listOf
});
