'use strict';

const { INITIAL_MAPPINGS } = require('./mapper');
const DEFAULT_ENROLLABLES = require('./enrollables-live-products.json');
const { externalKey } = require('./catalog-inventory');

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function bindingFromSource(item) {
  const external = item && item.external && typeof item.external === 'object' ? item.external : {};
  const productCode = clean(external.productCode || item && item.productCode);
  if (!productCode) return null;
  return {
    homeeasyId: clean(item.id || item.homeeasyId),
    reference: clean(item.reference || item.name),
    family: clean(item.familyName || item.family),
    active: item.active !== false,
    productCode,
    groupCode: clean(external.groupCode || item.groupCode),
    associationGroup: clean(external.associationGroup || item.associationGroup),
    primaryGroup: clean(external.primaryGroup || item.primaryGroup),
    calculationType: clean(external.calculationType || item.calculationType),
    unit: clean(external.unit || item.unit),
    source: clean(external.source || item.source || 'HOMEEASY_CATALOG')
  };
}

function bindingFromMapping(mapping) {
  if (!mapping || !mapping.homeeasyId || !mapping.productCode) return null;
  const special = mapping.special || {};
  return {
    homeeasyId: clean(mapping.homeeasyId),
    reference: clean(mapping.reference),
    family: clean(mapping.family),
    active: true,
    productCode: clean(mapping.productCode),
    groupCode: clean(mapping.groupCode),
    associationGroup: clean(mapping.associationGroup || special.AssociationGroup),
    primaryGroup: clean(mapping.primaryGroup),
    calculationType: clean(mapping.calculationType),
    unit: clean(mapping.unit),
    source: 'CERTIFIED_MAPPING'
  };
}

function bindingFromEnrollables(item) {
  if (!item || !item.homeeasyId || !item.productCode) return null;
  return {
    homeeasyId: clean(item.homeeasyId),
    reference: clean(item.reference),
    family: clean(item.family || 'Enrollable'),
    active: String(item.status || '').toUpperCase() !== 'DISCONTINUED',
    productCode: clean(item.productCode),
    groupCode: clean(item.groupCode),
    associationGroup: clean(item.associationGroup),
    primaryGroup: clean(item.primaryGroup),
    calculationType: clean(item.calculationType),
    unit: clean(item.unit),
    source: 'ENROLLABLES_LIVE_REGISTRY'
  };
}

function buildCatalogBindings(sourceProducts, options = {}) {
  const mappings = Array.isArray(options.mappings) ? options.mappings : INITIAL_MAPPINGS;
  const enrollables = options.enrollables || DEFAULT_ENROLLABLES;
  const candidates = [];

  for (const item of Array.isArray(sourceProducts) ? sourceProducts : []) {
    const binding = bindingFromSource(item);
    if (binding) candidates.push(binding);
  }
  for (const mapping of mappings) {
    const binding = bindingFromMapping(mapping);
    if (binding) candidates.push(binding);
  }
  for (const item of Object.values(enrollables && enrollables.products || {})) {
    const binding = bindingFromEnrollables(item);
    if (binding) candidates.push(binding);
  }

  const byKey = new Map();
  const conflicts = [];
  for (const binding of candidates) {
    binding.externalKey = externalKey(binding);
    if (!binding.externalKey) continue;
    const current = byKey.get(binding.externalKey);
    if (!current) {
      byKey.set(binding.externalKey, binding);
      continue;
    }
    if (current.homeeasyId && binding.homeeasyId && current.homeeasyId !== binding.homeeasyId) {
      conflicts.push({
        externalKey: binding.externalKey,
        homeeasyIds: [...new Set([current.homeeasyId, binding.homeeasyId])].sort(),
        sources: [...new Set([current.source, binding.source])].sort()
      });
      byKey.delete(binding.externalKey);
      continue;
    }
    if (current.source !== 'HOMEEASY_CATALOG' && binding.source === 'HOMEEASY_CATALOG') byKey.set(binding.externalKey, binding);
  }

  const conflictKeys = new Set(conflicts.map(item => item.externalKey));
  for (const key of conflictKeys) byKey.delete(key);

  return {
    bindings: [...byKey.values()].sort((a, b) => a.externalKey.localeCompare(b.externalKey)),
    conflicts
  };
}

module.exports = Object.freeze({
  buildCatalogBindings,
  bindingFromSource,
  bindingFromMapping,
  bindingFromEnrollables
});
