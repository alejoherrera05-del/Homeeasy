'use strict';

const crypto = require('crypto');
const { INITIAL_MAPPINGS, MAPPING_STATUSES, mappingIsReady, mappingIsCertified, pentagramaParamsForCase, homeEasyItemForCase } = require('./mapper');
const { roundMoney } = require('./comparison');
const { buildProposal, same } = require('./strategies');
const { HomeEasySyncClient } = require('./homeeasy-sync');
const { Phase2Store } = require('./phase2-store');
const { registry: DEFAULT_CERTIFICATION_REGISTRY } = require('./catalog-certification');
const { PentagramaCatalogInventory, compareInventory } = require('./catalog-inventory');
const { PentagramaEnrollablesAudit } = require('./enrollables-audit');
const { buildCatalogBindings } = require('./catalog-bindings');
const DEFAULT_ENROLLABLES_REGISTRY = require('./enrollables-live-products.json');
const ENROLLABLE_IDS = new Set(Object.keys(DEFAULT_ENROLLABLES_REGISTRY.products || {}));
const { CatalogCertifier, isRing, isRenueva, referenceName, sourceRowValues } = require('./catalog-certifier');

const SCAN_MAX_AGE_MS = 30 * 60 * 1000;

function certifiedLocalCandidate(scan) {
  const summary = scan && scan.localModelCandidate && scan.localModelCandidate.summary;
  return Boolean(summary &&
    Number(summary.enrollables) === 279 &&
    Number(summary.fail) === 0 &&
    Number(summary.maxDifference) <= 0.02 &&
    Number(summary.monetaryExpectedSelfReferential || 0) === 0);
}

function isEnrollablesStandardProduct(product) {
  const paths = Array.isArray(product && product.paths) && product.paths.length
    ? product.paths
    : [product && product.path];
  return paths
    .filter(Array.isArray)
    .some(path => {
      const family = String(path[0] || '').trim().toUpperCase();
      const system = String(path[1] || '').trim().toUpperCase();
      return family === 'ENROLLABLE' && /STANDARD/.test(system) && /PLATINA/.test(system);
    });
}

function statusFor(oldCost, newCost) {
  if (!Number.isFinite(newCost)) return 'ERROR';
  if (!Number.isFinite(oldCost)) return 'NEW';
  const difference = roundMoney(newCost - oldCost);
  if (Math.abs(difference) < 0.01) return 'UNCHANGED';
  const percent = oldCost ? Math.abs(difference / oldCost) * 100 : 100;
  if (percent >= 30) return 'REVIEW_REQUIRED';
  return difference > 0 ? 'INCREASED' : 'DECREASED';
}

function operationContext(req) {
  return {
    sessionToken: req.headers['x-homeeasy-session'], deviceId: req.headers['x-homeeasy-device-id'],
    deviceName: req.headers['x-homeeasy-device-name'], platform: req.headers['x-homeeasy-platform'], browser: req.headers['x-homeeasy-browser']
  };
}


function publicInventorySummary(inventory) {
  const products = Array.isArray(inventory && inventory.products) ? inventory.products : [];
  const families = new Map();

  for (const product of products) {
    const key = String(product && product.externalKey || [
      product && product.productCode,
      product && product.groupCode,
      product && product.associationGroup
    ].map(value => String(value || '').trim().toUpperCase()).join('|'));

    const paths = Array.isArray(product && product.paths) && product.paths.length
      ? product.paths
      : [product && product.path];

    const names = new Set(
      paths
        .filter(Array.isArray)
        .map(path => String(path[0] || '').trim())
        .filter(Boolean)
    );

    for (const name of names) {
      const normalizedName = name.toUpperCase();
      if (!families.has(normalizedName)) {
        families.set(normalizedName, {
          family: name,
          keys: new Set(),
          renuevaKeys: new Set()
        });
      }
      const item = families.get(normalizedName);
      item.keys.add(key);
      if (isRenueva(product)) item.renuevaKeys.add(key);
    }
  }

  const familyList = [...families.values()]
    .map(item => ({
      family: item.family,
      products: item.keys.size,
      renueva: item.renuevaKeys.size,
      eligibleProducts: item.keys.size - item.renuevaKeys.size
    }))
    .sort((a, b) => b.products - a.products || a.family.localeCompare(b.family));

  const findFamily = name => familyList.find(item => String(item.family).trim().toUpperCase() === name) || null;

  return {
    checkedAt: inventory && inventory.checkedAt || new Date().toISOString(),
    counts: {
      roots: Number(inventory && inventory.counts && inventory.counts.roots || inventory && inventory.roots || 0),
      leaves: Number(inventory && inventory.counts && inventory.counts.leaves || inventory && inventory.leaves || 0),
      products: Number(inventory && inventory.counts && inventory.counts.products || products.length),
      requests: Number(inventory && inventory.requests || 0),
      duplicateAppearances: Number(inventory && inventory.counts && inventory.counts.duplicateAppearances || inventory && inventory.duplicateAppearances || 0),
      skippedWithoutCode: Number(inventory && inventory.counts && inventory.counts.skippedWithoutCode || inventory && inventory.skippedWithoutCode || 0)
    },
    families: familyList,
    critical: {
      ring: findFamily('CORTINA RING'),
      enrollable: findFamily('ENROLLABLE')
    }
  };
}

class PentagramaPhase2 {
  constructor(options = {}) {
    this.pricing = options.pricing;
    this.homeeasyCost = options.homeeasyCost;
    this.homeeasy = options.homeeasy || new HomeEasySyncClient(options);
    this.gateway = options.gateway;
    this.mappings = options.mappings || INITIAL_MAPPINGS;
    this.certificationRegistry = options.certificationRegistry || DEFAULT_CERTIFICATION_REGISTRY;
    this.enrollablesRegistry = options.enrollablesRegistry || DEFAULT_ENROLLABLES_REGISTRY;
    this.inventoryOptions = options.inventoryOptions || {};
    this.inventory = options.inventory || (this.gateway && typeof this.gateway.dispatch === 'function'
      ? new PentagramaCatalogInventory({ ...this.inventoryOptions, gateway: this.gateway })
      : null);
    this.catalogCertifier = options.catalogCertifier || (this.pricing && typeof this.pricing.supplierCost === 'function' ? new CatalogCertifier({ pricing: this.pricing }) : null);
    this.store = options.store || new Phase2Store(options);
  }

  startScan(actor, context) {
    const operation = this.store.operation('scan', actor);
    setImmediate(() => this.runScan(operation.id, context).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  startInventory(actor) {
    const operation = this.store.operation('inventory', actor);
    setImmediate(() => this.runInventory(operation.id).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  startEnrollablesAudit(actor) {
    const operation = this.store.operation('enrollablesAudit', actor);
    setImmediate(() => this.runEnrollablesAudit(operation.id).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  async runEnrollablesAudit(operationId) {
    this.store.updateOperation(operationId, {
      state: 'running',
      stage: 'READING_ENROLLABLES',
      progress: {
        status: 'STARTING',
        groupsTotal: 0,
        groupsCompleted: 0,
        currentGroup: null,
        requests: 0,
        leaves: 0,
        products: 0
      }
    });

    if (!this.gateway || typeof this.gateway.dispatch !== 'function') {
      throw Object.assign(new Error('Pentagrama gateway is unavailable'), { code: 'AGENT_OFFLINE' });
    }

    const audit = new PentagramaEnrollablesAudit({
      ...this.inventoryOptions,
      gateway: this.gateway,
      onProgress: async progress => {
        this.store.updateOperation(operationId, {
          stage: progress.status === 'WAITING_AGENT' ? 'WAITING_AGENT' : 'READING_ENROLLABLES',
          progress
        });
      }
    });

    const result = await audit.run();

    this.store.updateOperation(operationId, {
      state: 'completed',
      stage: 'COMPLETED',
      progress: {
        status: 'COMPLETED',
        groupsTotal: result.live.categoryGroups,
        groupsCompleted: result.live.categoryGroups,
        currentGroup: null,
        requests: result.live.requests,
        leaves: result.live.uniqueRoutes,
        products: result.live.uniqueIdentities
      },
      result
    });

    return result;
  }


  async runInventory(operationId) {
    this.store.updateOperation(operationId, {
      state: 'running',
      stage: 'READING_PENTAGRAMA',
      progress: {
        status: 'STARTING',
        rootsTotal: 0,
        rootsCompleted: 0,
        currentFamily: null,
        requests: 0,
        leaves: 0,
        products: 0
      }
    });

    if (!this.gateway || typeof this.gateway.dispatch !== 'function') {
      throw Object.assign(new Error('Pentagrama gateway is unavailable'), { code: 'AGENT_OFFLINE' });
    }

    // Ejecutamos el inventario como una secuencia de jobs cortos de catálogo.
    // El job compuesto catalogInventory puede durar más que el timeout del Gateway
    // y además no publica progreso mientras el Agent está ocupado.
    const reader = new PentagramaCatalogInventory({
      ...this.inventoryOptions,
      gateway: this.gateway,
      onProgress: async progress => {
        this.store.updateOperation(operationId, {
          stage: progress.status === 'WAITING_AGENT' ? 'WAITING_AGENT' : 'READING_PENTAGRAMA',
          progress
        });
      }
    });
    const inventory = await reader.scan();

    const result = publicInventorySummary(inventory);
    this.store.updateOperation(operationId, {
      state: 'completed',
      stage: 'COMPLETED',
      progress: {
        status: 'COMPLETED',
        rootsTotal: result.counts.roots,
        rootsCompleted: result.counts.roots,
        currentFamily: null,
        requests: result.counts.requests,
        leaves: result.counts.leaves,
        products: result.counts.products
      },
      result
    });
    return result;
  }

  validationCases(mapping) {
    const cases = Array.isArray(mapping.validationCases) ? mapping.validationCases.slice() : [];
    if (!cases.some(item => String(item.width) === String(mapping.width) && String(item.height) === String(mapping.height))) {
      cases.push({ id: 'primary', width: String(mapping.width), height: String(mapping.height), role: 'evidence' });
    }
    return cases;
  }

  async validateMapping(mapping, sourceItem, context) {
    if (!mappingIsReady(mapping)) return { autoApplicable: false, reason: 'El mapping está incompleto.', evidence: [] };
    const evidence = [];
    for (const sample of this.validationCases(mapping)) {
      const [pentagrama, homeeasy] = await Promise.all([
        this.pricing.supplierCost(pentagramaParamsForCase(mapping, sample), { productDiscount: mapping.productDiscount, pricingMode: mapping.pricingMode }),
        this.homeeasyCost.cost(homeEasyItemForCase(mapping, sample), context)
      ]);
      evidence.push({ ...sample, pentagrama, homeeasy: roundMoney(homeeasy.amount) });
    }
    return { ...buildProposal(mapping, sourceItem, evidence), evidence };
  }

  async fullCatalogInventory() {
    if (!this.gateway) throw Object.assign(new Error('Pentagrama gateway is unavailable'), { code: 'AGENT_OFFLINE' });
    if (!this.inventory) throw Object.assign(new Error('Pentagrama catalog inventory is unavailable'), { code: 'AGENT_OFFLINE' });
    // Mantener el recorrido en jobs cortos evita dejar al Agent bloqueado por un
    // único trabajo largo y permite que cada petición tenga su propio timeout/reintento.
    return this.inventory.scan();
  }

  inventoryAudit(sourceProducts, inventory) {
    const genericSource = (sourceProducts || []).filter(item => !ENROLLABLE_IDS.has(String(item && item.id)));
    const genericInventory = (inventory && inventory.products || []).filter(item => !isEnrollablesStandardProduct(item));
    const bindingState = buildCatalogBindings(genericSource, {
      mappings: this.mappings.filter(item => !ENROLLABLE_IDS.has(String(item && item.homeeasyId))),
      enrollables: { products: {} }
    });
    const comparison = compareInventory(bindingState.bindings, genericInventory, {
      nameResolver: (live, binding) => {
        if ((binding && String(binding.family || '').toLowerCase() === 'ring') || isRing(live)) return referenceName(live);
        return live && live.name;
      }
    });
    const changes = comparison.results
      .filter(item => !['PRESENT', 'INACTIVE_MISSING'].includes(item.status))
      .map(item => ({
        status: item.status,
        externalKey: item.externalKey,
        previousExternalKey: item.previousExternalKey || '',
        homeeasyId: item.homeeasyId || '',
        productCode: item.productCode || '',
        oldName: item.oldName || '',
        newName: item.newName || '',
        live: item.live ? {
          name: item.live.name,
          productCode: item.live.productCode,
          groupCode: item.live.groupCode,
          associationGroup: item.live.associationGroup,
          primaryGroup: item.live.primaryGroup,
          calculationType: item.live.calculationType,
          unit: item.live.unit,
          path: item.live.path
        } : null
      }));
    return {
      checkedAt: inventory && inventory.checkedAt || new Date().toISOString(),
      inventory: inventory && inventory.counts || { products: 0, roots: 0, leaves: 0 },
      counts: comparison.counts,
      bindingConflicts: bindingState.conflicts,
      changes
    };
  }


  async buildCatalogActions(source, inventory) {
    if (!this.catalogCertifier) return [];
    const sourceProducts = Array.isArray(source && source.products) ? source.products : [];
    const genericSource = sourceProducts.filter(item => !ENROLLABLE_IDS.has(String(item && item.id)));
    const genericInventory = (inventory && inventory.products || []).filter(item => !isEnrollablesStandardProduct(item));
    const sourceById = new Map(sourceProducts.map(item => [String(item.id), item]));
    const sourceIds = new Set(sourceProducts.map(item => String(item.id)));
    const bindingState = buildCatalogBindings(genericSource, {
      mappings: this.mappings.filter(item => !ENROLLABLE_IDS.has(String(item && item.homeeasyId))),
      enrollables: { products: {} }
    });
    const comparison = compareInventory(bindingState.bindings, genericInventory, {
      nameResolver: (live, binding) => {
        if ((binding && String(binding.family || '').toLowerCase() === 'ring') || isRing(live)) return referenceName(live);
        return live && live.name;
      }
    });
    const actions = [];

    for (const item of comparison.results) {
      const sourceItem = sourceById.get(String(item.homeeasyId || '')) || null;
      const sourceIsRing = Boolean(sourceItem && (
        String(sourceItem.family || '').toLowerCase() === 'ring' ||
        /Cortina\s+Ring/i.test(String(sourceItem.familyName || '')) ||
        String(sourceItem.external && sourceItem.external.associationGroup || '').toUpperCase() === 'RIECORIN'
      ));

      if (item.status === 'NEW' && item.live && isRing(item.live)) {
        if (isRenueva(item.live)) continue;
        try {
          const certified = await this.catalogCertifier.certifyRing(item.live, source);
          if (!certified.ok) {
            actions.push({
              id: 'catalog-review:' + item.externalKey,
              kind: 'REVIEW',
              status: 'REVIEW_REQUIRED',
              autoApplicable: false,
              certified: false,
              productCode: item.productCode,
              reference: item.newName,
              reason: certified.reason || 'La referencia nueva no pudo certificarse.'
            });
            continue;
          }
          if (sourceIds.has(certified.homeeasyId)) {
            actions.push({
              id: 'catalog-review:' + item.externalKey,
              kind: 'REVIEW',
              status: 'REVIEW_REQUIRED',
              autoApplicable: false,
              certified: false,
              productCode: item.productCode,
              reference: certified.reference,
              reason: 'El ID calculado para la nueva referencia ya existe en HomeEasy.'
            });
            continue;
          }
          actions.push({
            id: 'catalog-add:' + item.externalKey,
            kind: 'ADD',
            status: 'NEW',
            autoApplicable: true,
            certified: true,
            homeeasyId: certified.homeeasyId,
            externalKey: item.externalKey,
            productCode: item.productCode,
            reference: certified.reference,
            proposedRate: certified.rate,
            evidence: certified.evidence,
            mutation: {
              kind: 'ADD',
              certified: true,
              homeeasyId: certified.homeeasyId,
              expectedExternalKey: '',
              rowValues: certified.rowValues,
              qaCases: certified.qaCases
            }
          });
        } catch (error) {
          actions.push({
            id: 'catalog-review:' + item.externalKey,
            kind: 'REVIEW',
            status: 'ERROR',
            autoApplicable: false,
            certified: false,
            productCode: item.productCode,
            reference: item.newName,
            reason: String(error.code || error.message || 'PENTAGRAMA_RING_CERTIFICATION_FAILED')
          });
        }
        continue;
      }

      if (item.status === 'DISCONTINUED' && sourceIsRing && sourceItem) {
        const externalKey = String(item.externalKey || '');
        if (!externalKey || isRenueva({ name: sourceItem.reference, path: [] })) continue;
        actions.push({
          id: 'catalog-deactivate:' + externalKey,
          kind: 'DEACTIVATE',
          status: 'DISCONTINUED',
          autoApplicable: true,
          certified: true,
          homeeasyId: String(sourceItem.id),
          externalKey,
          productCode: String(sourceItem.external && sourceItem.external.productCode || item.productCode || ''),
          reference: String(sourceItem.reference || item.oldName || ''),
          mutation: {
            kind: 'DEACTIVATE',
            certified: true,
            homeeasyId: String(sourceItem.id),
            expectedExternalKey: externalKey,
            rowValues: sourceRowValues(sourceItem, source, { active: false, status: 'DESCONTINUADO' }),
            qaCases: []
          }
        });
        continue;
      }

      if (!sourceIsRing || !sourceItem || !item.live || !isRing(item.live) || isRenueva(item.live)) continue;
      if (!['PRESENT', 'RENAMED'].includes(item.status)) continue;

      try {
        const probe = await this.catalogCertifier.probeRing(item.live);
        if (!probe.ok) {
          actions.push({
            id: 'catalog-review:' + item.externalKey,
            kind: 'REVIEW',
            status: 'REVIEW_REQUIRED',
            autoApplicable: false,
            certified: false,
            homeeasyId: String(sourceItem.id),
            externalKey: item.externalKey,
            productCode: item.productCode,
            reference: probe.reference || item.newName || item.oldName,
            reason: probe.reason || 'Pentagrama no devolvió un precio válido.'
          });
          continue;
        }

        const currentRate = Number(sourceItem.rate || 0);
        const priceChanged = Math.abs(roundMoney(probe.rate - currentRate)) > 0.02;
        if (priceChanged) {
          const certified = await this.catalogCertifier.certifyRing(item.live, source);
          if (!certified.ok) {
            actions.push({
              id: 'catalog-review:' + item.externalKey,
              kind: 'REVIEW',
              status: 'REVIEW_REQUIRED',
              autoApplicable: false,
              certified: false,
              homeeasyId: String(sourceItem.id),
              externalKey: item.externalKey,
              productCode: item.productCode,
              reference: certified.reference || probe.reference || item.newName,
              reason: certified.reason || 'El nuevo precio no pudo certificarse.'
            });
            continue;
          }
          const priceStatus = statusFor(currentRate, certified.rate);
          const safeVariation = priceStatus !== 'REVIEW_REQUIRED' && priceStatus !== 'ERROR';
          const qaCases = certified.qaCases.map(testCase => ({
            ...testCase,
            homeeasy: { ...testCase.homeeasy, product: String(sourceItem.id) }
          }));
          actions.push({
            id: 'catalog-rate:' + item.externalKey,
            kind: 'UPDATE_RATE',
            status: safeVariation ? priceStatus : 'REVIEW_REQUIRED',
            autoApplicable: safeVariation,
            certified: safeVariation,
            homeeasyId: String(sourceItem.id),
            externalKey: item.externalKey,
            productCode: item.productCode,
            reference: certified.reference,
            oldRate: currentRate,
            proposedRate: certified.rate,
            difference: roundMoney(certified.rate - currentRate),
            percent: currentRate ? roundMoney(((certified.rate - currentRate) / currentRate) * 100) : null,
            evidence: certified.evidence,
            reason: safeVariation ? null : 'La variación certificada supera el umbral de seguridad del 30 %.',
            mutation: safeVariation ? {
              kind: 'UPDATE_RATE',
              certified: true,
              homeeasyId: String(sourceItem.id),
              expectedExternalKey: item.externalKey,
              expectedRate: currentRate,
              proposedRate: certified.rate,
              rowValues: sourceRowValues(sourceItem, source, {
                rate: certified.rate,
                reference: certified.reference,
                type: certified.type,
                active: true,
                status: 'VIGENTE',
                rules: certified.rules
              }),
              qaCases
            } : null
          });
          continue;
        }

        if (item.status === 'RENAMED' && probe.reference && probe.reference !== String(sourceItem.reference || '')) {
          actions.push({
            id: 'catalog-rename:' + item.externalKey,
            kind: 'RENAME',
            status: 'RENAMED',
            autoApplicable: true,
            certified: true,
            homeeasyId: String(sourceItem.id),
            externalKey: item.externalKey,
            productCode: item.productCode,
            reference: probe.reference,
            mutation: {
              kind: 'RENAME',
              certified: true,
              homeeasyId: String(sourceItem.id),
              expectedExternalKey: item.externalKey,
              newReference: probe.reference,
              rowValues: sourceRowValues(sourceItem, source, { reference: probe.reference }),
              qaCases: []
            }
          });
        }
      } catch (error) {
        actions.push({
          id: 'catalog-review:' + item.externalKey,
          kind: 'REVIEW',
          status: 'ERROR',
          autoApplicable: false,
          certified: false,
          homeeasyId: String(sourceItem.id),
          externalKey: item.externalKey,
          productCode: item.productCode,
          reference: item.newName || item.oldName,
          reason: String(error.code || error.message || 'PENTAGRAMA_RING_PRICE_CHECK_FAILED')
        });
      }
    }

    return actions;
  }

  async runScan(operationId, context) {
    this.store.updateOperation(operationId, { state: 'running', stage: 'READING_HOMEEASY' });
    const source = await this.homeeasy.catalog(context);
    this.store.updateOperation(operationId, { stage: 'READING_PENTAGRAMA' });
    const hasEnrollables = (source.products || []).some(item => ENROLLABLE_IDS.has(String(item.id)));
    let localModelCandidate = null;
    let localModelError = null;
    if (hasEnrollables) {
      try {
        localModelCandidate = await this.gateway.dispatch('buildLocalEnrollablesSnapshot', { source }, { lockKey: `local-enrollables:${source.version}` });
        if (!localModelCandidate || Number(localModelCandidate.summary && localModelCandidate.summary.enrollables) !== 279 ||
          Number(localModelCandidate.summary && localModelCandidate.summary.fail) !== 0 ||
          Number(localModelCandidate.summary && localModelCandidate.summary.monetaryExpectedSelfReferential || 0) !== 0) {
          throw Object.assign(new Error('El modelo Enrollables no quedó completamente certificado con evidencia Live actual.'), { code: 'PENTAGRAMA_LOCAL_MODEL_QA_FAILED' });
        }
      } catch (error) {
        localModelCandidate = null;
        localModelError = {
          code: String(error.code || 'PENTAGRAMA_LOCAL_MODEL_FAILED'),
          message: String(error.message || 'No se pudo construir el modelo Enrollables.').slice(0, 300),
          failures: Array.isArray(error.failures) ? error.failures.slice(0, 50) : [],
          missing: Array.isArray(error.missing) ? error.missing.slice(0, 300) : []
        };
      }
    }

    let enrollablesRouteAudit = null;
    let enrollablesRouteAuditError = null;
    if (hasEnrollables) {
      try {
        const routeAudit = new PentagramaEnrollablesAudit({
          ...this.inventoryOptions,
          gateway: this.gateway
        });
        enrollablesRouteAudit = await routeAudit.run();
      } catch (error) {
        enrollablesRouteAuditError = {
          code: String(error && error.code || 'PENTAGRAMA_ENROLLABLES_ROUTE_AUDIT_FAILED'),
          message: String(error && error.message || 'No se pudo validar la estructura de Enrollables.').slice(0, 300)
        };
      }
    }

    const inventory = await this.fullCatalogInventory();
    const catalogInventoryAudit = this.inventoryAudit(source.products || [], inventory);
    const catalogActions = await this.buildCatalogActions(source, inventory);

    const enrollablesCatalogChanges = [];
    if (enrollablesRouteAudit) {
      for (const route of enrollablesRouteAudit.deltas && enrollablesRouteAudit.deltas.addedRoutes || []) {
        enrollablesCatalogChanges.push({
          status: 'NEW',
          externalKey: 'ENROLLABLE_ROUTE:' + String(route.routeKey || ''),
          homeeasyId: '',
          productCode: '',
          oldName: '',
          newName: String(route.referenceName || route.routeKey || ''),
          family: 'Enrollable',
          routeKey: route.routeKey,
          productCount: route.productCount,
          live: { path: ['ENROLLABLE', 'STANDARD/PLATINA SIN CABEZAL', route.groupName, route.referenceName].filter(Boolean) }
        });
      }
      for (const route of enrollablesRouteAudit.deltas && enrollablesRouteAudit.deltas.missingRoutes || []) {
        enrollablesCatalogChanges.push({
          status: 'DISCONTINUED',
          externalKey: 'ENROLLABLE_ROUTE:' + String(route.routeKey || ''),
          homeeasyId: Array.isArray(route.homeeasyIds) ? route.homeeasyIds[0] || '' : '',
          productCode: '',
          oldName: Array.isArray(route.references) ? route.references[0] || route.routeKey : route.routeKey,
          newName: '',
          family: 'Enrollable',
          routeKey: route.routeKey,
          live: null
        });
      }
    }

    const catalogSummary = {
      categories: Number(inventory && inventory.counts && inventory.counts.roots || inventory && inventory.roots || 0),
      leaves: Number(inventory && inventory.counts && inventory.counts.leaves || inventory && inventory.leaves || 0),
      products: Number(inventory && inventory.counts && inventory.counts.products || (inventory && inventory.products || []).length),
      requests: Number(inventory && inventory.requests || 0)
    };

    const results = [];
    const mappedIds = new Set([...this.mappings.map(item => item.homeeasyId), ...ENROLLABLE_IDS]);
    const certifiedMappingIds = new Set([...this.mappings.filter(mappingIsCertified).map(item => item.homeeasyId), ...(localModelCandidate ? ENROLLABLE_IDS : [])]);
    const certificationById = new Map((this.certificationRegistry.products || []).map(item => [item.homeeasyId, item]));
    if (localModelCandidate) {
      const changed = Number(localModelCandidate.summary && localModelCandidate.summary.changed || 0);
      const routeStructureSafe = Boolean(
        enrollablesRouteAudit &&
        enrollablesRouteAudit.routeComparison &&
        enrollablesRouteAudit.routeComparison.exactReferenceStructure === true
      );
      results.push({
        id: 'enrollables-local-model',
        homeeasyId: '__enrollables_local_model__',
        family: 'Enrollable',
        reference: `${localModelCandidate.summary.enrollables} Enrollables · modelo local ${localModelCandidate.version}`,
        strategy: 'LOCAL_MODEL',
        status: changed ? (routeStructureSafe ? 'NEW' : 'REVIEW_REQUIRED') : 'UNCHANGED',
        autoApplicable: changed > 0 && routeStructureSafe,
        oldCost: 0,
        newCost: changed,
        difference: changed,
        percent: null,
        reviewReason: routeStructureSafe ? null : (enrollablesRouteAuditError
          ? 'No se pudo validar la estructura actual de Enrollables.'
          : 'Pentagrama reportó una alta, baja o movimiento de ruta en Enrollables.'),
        severity: routeStructureSafe ? 'normal' : 'review_required',
        destination: { sheet: 'Costos_Pentagrama*', field: 'snapshot-atómico' }
      });
    } else if (hasEnrollables) {
      results.push({
        id: 'enrollables-local-model',
        homeeasyId: '__enrollables_local_model__',
        family: 'Enrollable',
        reference: '279 Enrollables',
        strategy: 'LOCAL_MODEL',
        status: 'ERROR',
        autoApplicable: false,
        error: localModelError && localModelError.code || 'PENTAGRAMA_LOCAL_MODEL_FAILED',
        diagnostics: localModelError
      });
    }

    for (const item of source.products || []) {
      if (mappedIds.has(item.id)) continue;
      const certification = certificationById.get(item.id);
      if (certification && certification.status === 'REVIEW_REQUIRED') {
        results.push({ homeeasyId: item.id, family: item.familyName, reference: item.reference,
          productCode: certification.productCode, strategy: certification.strategy,
          status: 'REVIEW_REQUIRED', autoApplicable: false, reviewReason: certification.reason || 'Mapping pendiente de certificación.' });
      } else {
        results.push({ homeeasyId: item.id, family: item.familyName, reference: item.reference, status: 'UNMAPPED' });
      }
    }
    this.store.updateOperation(operationId, { stage: 'COMPARING' });
    for (const mapping of this.mappings.filter(item => !ENROLLABLE_IDS.has(String(item.homeeasyId)))) {
      const sourceItem = (source.products || []).find(item => item.id === mapping.homeeasyId);
      if (!sourceItem) { results.push({ homeeasyId: mapping.homeeasyId, family: mapping.family, reference: mapping.reference, status: 'UNMAPPED' }); continue; }
      try {
        const validation = await this.validateMapping(mapping, sourceItem, context);
        const primary = validation.evidence.find(item => String(item.width) === String(mapping.width) && String(item.height) === String(mapping.height));
        if (!primary) throw Object.assign(new Error('Primary validation case is missing'), { code: 'MAPPING_PRIMARY_CASE_MISSING' });
        const oldCost = roundMoney(primary.homeeasy); const newCost = roundMoney(primary.pentagrama.total);
        const difference = roundMoney(newCost - oldCost); const percent = oldCost ? roundMoney((difference / oldCost) * 100) : null;
        let status = statusFor(oldCost, newCost);
        if (mapping.status === MAPPING_STATUSES.REVIEW_REQUIRED || (!same(oldCost, newCost) && !validation.autoApplicable)) status = 'REVIEW_REQUIRED';
        results.push({ id: mapping.id, homeeasyId: mapping.homeeasyId, family: mapping.family, reference: mapping.reference,
          productCode: mapping.productCode, oldCost, newCost, difference, percent, status,
          width: mapping.width, height: mapping.height, quantity: mapping.quantity,
          strategy: mapping.strategy, autoApplicable: Boolean(validation.autoApplicable), reviewReason: validation.reason || null,
          severity: status === 'REVIEW_REQUIRED' ? 'review_required' : Math.abs(percent || 0) >= 15 ? 'warning' : 'normal',
          sourceRow: sourceItem.row, expectedRate: Number(sourceItem.rate), proposedRate: validation.proposedRate || null,
          destination: mapping.destination, updateField: mapping.updateField, sourceModel: sourceItem,
          validationCases: (validation.cases || []).map(item => ({ ...item })),
          priceEvidence: validation.evidence.map(item => ({ id: item.id, role: item.role, width: item.width, height: item.height,
            homeeasy: item.homeeasy, basePrice: item.pentagrama.basePrice, distributorDiscount: item.pentagrama.distributorDiscount,
            productDiscount: item.pentagrama.productDiscount, vatRate: item.pentagrama.vatRate, total: item.pentagrama.total }))
        });
      } catch (error) {
        results.push({ id: mapping.id, homeeasyId: mapping.homeeasyId, family: mapping.family, reference: mapping.reference,
          strategy: mapping.strategy, autoApplicable: false, status: 'ERROR', error: String(error.code || 'SCAN_FAILED') });
      }
    }
    const counts = results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
    const strategyCounts = results.filter(item => item.strategy).reduce((acc, item) => { acc[item.strategy] = (acc[item.strategy] || 0) + 1; return acc; }, {});
    const scan = { id: crypto.randomUUID(), checkedAt: new Date().toISOString(), sourceVersion: source.version, sourceValidThrough: source.validThrough, catalogSummary, localModelCandidate, localModelError,
      catalogInventoryAudit,
      enrollablesRouteAudit,
      enrollablesRouteAuditError,
      catalogChanges: [...catalogInventoryAudit.changes, ...enrollablesCatalogChanges],
      catalogActions,
      catalogAudit: { total: (source.products || []).length, mapped: results.filter(item => item.id).length,
        certified: (source.products || []).filter(item => certifiedMappingIds.has(String(item.id))).length,
        autoUpdatable: results.filter(item => item.autoApplicable).length,
        reviewRequired: results.filter(item => item.status === 'REVIEW_REQUIRED').length,
        unmapped: results.filter(item => item.status === 'UNMAPPED').length, strategies: strategyCounts,
        pentagramaProducts: catalogSummary.products,
        newReferences: Number(catalogInventoryAudit.counts.NEW || 0) + Number(enrollablesRouteAudit && enrollablesRouteAudit.routeComparison && enrollablesRouteAudit.routeComparison.addedRoutes || 0),
        discontinued: Number(catalogInventoryAudit.counts.DISCONTINUED || 0) + Number(enrollablesRouteAudit && enrollablesRouteAudit.routeComparison && enrollablesRouteAudit.routeComparison.missingRoutes || 0),
        renamed: Number(catalogInventoryAudit.counts.RENAMED || 0),
        structureChanged: Number(catalogInventoryAudit.counts.STRUCTURE_CHANGED || 0),
        bindingConflicts: catalogInventoryAudit.bindingConflicts.length,
        enrollablesRoutesExpected: Number(enrollablesRouteAudit && enrollablesRouteAudit.baseline && enrollablesRouteAudit.baseline.uniqueRoutes || 0),
        enrollablesRoutesLive: Number(enrollablesRouteAudit && enrollablesRouteAudit.live && enrollablesRouteAudit.live.relevantUniqueRoutes || 0),
        enrollablesExtraVariants: Number(enrollablesRouteAudit && enrollablesRouteAudit.routeComparison && enrollablesRouteAudit.routeComparison.additionalVariantsInKnownRoutes || 0),
        enrollablesExcludedPortalRoutes: Number(enrollablesRouteAudit && enrollablesRouteAudit.live && enrollablesRouteAudit.live.excludedPortalRoutes || 0),
        enrollablesStructureExact: Boolean(enrollablesRouteAudit && enrollablesRouteAudit.routeComparison && enrollablesRouteAudit.routeComparison.exactReferenceStructure),
        enrollablesRouteAuditError: enrollablesRouteAuditError && enrollablesRouteAuditError.code || null,
        catalogAutoApplicable: catalogActions.filter(item => item.autoApplicable === true).length,
        catalogRateChanges: catalogActions.filter(item => item.kind === 'UPDATE_RATE' && item.autoApplicable === true).length,
        catalogCertifiedAdditions: catalogActions.filter(item => item.kind === 'ADD' && item.autoApplicable === true).length,
        catalogCertifiedDeactivations: catalogActions.filter(item => item.kind === 'DEACTIVATE' && item.autoApplicable === true).length,
        catalogReviewRequired: catalogActions.filter(item => item.autoApplicable !== true).length },
      expiresAt: new Date(Date.now() + SCAN_MAX_AGE_MS).toISOString(), counts, results };
    this.store.addScan(scan);
    this.store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', scanId: scan.id, result: { scanId: scan.id, counts } });
  }

  startApply(actor, context, payload) {
    const scan = this.store.scan(String(payload.scanId || ''));
    if (!scan || Date.parse(scan.expiresAt) < Date.now()) throw Object.assign(new Error('Scan is missing or expired'), { statusCode: 409, code: 'PENTAGRAMA_SCAN_EXPIRED' });
    const requested = Array.isArray(payload.changeIds) ? new Set(payload.changeIds.map(String)) : new Set();
    const requestedCatalog = Array.isArray(payload.catalogActionIds) ? new Set(payload.catalogActionIds.map(String)) : new Set();
    const changes = scan.results.filter(item => ['INCREASED', 'DECREASED', 'NEW'].includes(item.status) && item.autoApplicable === true && requested.has(String(item.id)));
    const catalogActions = (scan.catalogActions || []).filter(item => item.autoApplicable === true && requestedCatalog.has(String(item.id)));
    if (!changes.length && !catalogActions.length) throw Object.assign(new Error('No verified changes were selected'), { statusCode: 409, code: 'PENTAGRAMA_NO_APPLICABLE_CHANGES' });
    const operation = this.store.operation('apply', actor);
    setImmediate(() => this.runApply(operation.id, scan, changes, catalogActions, context).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  async verifyCatalogActions(scan, actions) {
    if (!actions.length) return [];
    const inventory = await this.fullCatalogInventory();
    const liveByKey = new Map((inventory.products || []).map(item => [String(item.externalKey || ''), item]));
    const verified = [];

    for (const action of actions) {
      const kind = String(action.kind || '');
      const key = String(action.externalKey || '');
      if (kind === 'DEACTIVATE') {
        if (liveByKey.has(key)) throw Object.assign(new Error('La referencia reapareció en Pentagrama antes de aplicar.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
        verified.push({ ...action, mutation: { ...action.mutation, certified: true } });
        continue;
      }

      const live = liveByKey.get(key);
      if (!live || isRenueva(live)) throw Object.assign(new Error('La referencia cambió o dejó de estar disponible antes de aplicar.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
      if (!isRing(live)) throw Object.assign(new Error('La identidad técnica de Cortina Ring cambió antes de aplicar.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });

      if (kind === 'RENAME') {
        const currentName = referenceName(live);
        if (!currentName || currentName !== String(action.reference || '')) throw Object.assign(new Error('El nombre cambió nuevamente antes de aplicar.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
        verified.push({ ...action, mutation: { ...action.mutation, certified: true, newReference: currentName } });
        continue;
      }

      if (kind === 'ADD' || kind === 'UPDATE_RATE') {
        const certified = await this.catalogCertifier.certifyRing(live, {
          version: scan.sourceVersion,
          validThrough: scan.sourceValidThrough
        });
        if (!certified.ok || Math.abs(Number(certified.rate) - Number(action.proposedRate)) > 0.005) {
          throw Object.assign(new Error('La tarifa dejó de coincidir con la evidencia del escaneo.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
        }
        if (kind === 'ADD' && String(certified.homeeasyId) !== String(action.homeeasyId)) {
          throw Object.assign(new Error('La identidad HomeEasy de la referencia nueva cambió.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
        }
        if (kind === 'ADD') {
          verified.push({
            ...action,
            mutation: {
              ...action.mutation,
              certified: true,
              rowValues: certified.rowValues,
              qaCases: certified.qaCases
            }
          });
        } else {
          const rowValues = Array.isArray(action.mutation && action.mutation.rowValues) ? action.mutation.rowValues.slice() : [];
          if (rowValues.length !== 21) throw Object.assign(new Error('La fila certificada de tarifa está incompleta.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
          rowValues[3] = certified.reference;
          rowValues[4] = certified.type;
          rowValues[6] = certified.rate;
          rowValues[20] = JSON.stringify(certified.rules);
          const qaCases = certified.qaCases.map(testCase => ({
            ...testCase,
            homeeasy: { ...testCase.homeeasy, product: String(action.homeeasyId) }
          }));
          verified.push({
            ...action,
            mutation: {
              ...action.mutation,
              certified: true,
              proposedRate: certified.rate,
              rowValues,
              qaCases
            }
          });
        }
        continue;
      }

      throw Object.assign(new Error('Acción de catálogo no soportada.'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
    }
    return verified;
  }

  async runApply(operationId, scan, changes, catalogActions, context) {
    this.store.updateOperation(operationId, { state: 'running', stage: 'PREWRITE_VALIDATION' });

    const localChanges = (changes || []).filter(item => item.strategy === 'LOCAL_MODEL');
    const normalChanges = (changes || []).filter(item => item.strategy !== 'LOCAL_MODEL');
    if (localChanges.length > 1) {
      throw Object.assign(new Error('El modelo local de Enrollables debe publicarse como un único lote.'), {
        code: 'PENTAGRAMA_LOCAL_MODEL_BATCH_REQUIRED'
      });
    }

    const localChange = localChanges[0] || null;
    if (localChange && !certifiedLocalCandidate(scan)) {
      throw Object.assign(new Error('El modelo local de Enrollables dejó de estar certificado.'), {
        code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED'
      });
    }

    if (localChange) {
      const currentSource = await this.homeeasy.catalog(context);
      if (!currentSource || String(currentSource.version || '') !== String(scan.sourceVersion || '')) {
        throw Object.assign(new Error('El catálogo HomeEasy cambió después de certificar las 279 Enrollables.'), {
          code: 'PENTAGRAMA_LOCAL_MODEL_SOURCE_CHANGED'
        });
      }
    }

    const verified = [];
    for (const item of normalChanges) {
      const mapping = this.mappings.find(candidate => candidate.id === item.id);
      if (!mapping) throw Object.assign(new Error('Mapping changed after scan'), { code: 'PENTAGRAMA_MAPPING_CHANGED' });
      const validation = await this.validateMapping(mapping, item.sourceModel, context);
      if (!validation.autoApplicable || !same(validation.proposedRate, item.proposedRate)) {
        throw Object.assign(new Error(validation.reason || 'Proposed tariff is no longer reproducible'), { code: 'PENTAGRAMA_PREWRITE_VALIDATION_FAILED' });
      }
      verified.push({ item, mapping, validation });
    }

    const verifiedCatalog = await this.verifyCatalogActions(scan, catalogActions || []);
    this.store.updateOperation(operationId, { stage: 'SNAPSHOT' });
    this.store.updateOperation(operationId, { stage: 'WRITING_SHEET' });

    let appliedPrices = null;
    let appliedCatalog = null;
    let appliedLocal = null;
    try {
      if (verified.length) {
        appliedPrices = await this.homeeasy.apply(scan, verified.map(({ item, mapping, validation }) => ({
          id: item.id, homeeasyId: item.homeeasyId, row: item.sourceRow, field: item.updateField,
          expectedRate: item.expectedRate, proposedRate: item.proposedRate, oldCost: item.oldCost, newCost: item.newCost,
          difference: item.difference, percent: item.percent, width: item.width, height: item.height, quantity: item.quantity,
          strategy: item.strategy, destination: item.destination,
          qaCases: validation.evidence.map(sample => ({ id: sample.id, width: sample.width, height: sample.height,
            quantity: item.quantity, expected: roundMoney(sample.pentagrama.total), homeeasy: homeEasyItemForCase(mapping, sample) }))
        })), context);
      }

      if (verifiedCatalog.length) {
        appliedCatalog = await this.homeeasy.applyCatalog(scan, verifiedCatalog.map(item => item.mutation), context);
      }

      if (localChange) {
        appliedLocal = await this.homeeasy.applyLocalModel(scan, scan.localModelCandidate, context);
        if (!appliedLocal || !appliedLocal.qa || appliedLocal.qa.ok !== true ||
          Number(appliedLocal.qa.maxDifference || 0) > 0.02) {
          throw Object.assign(new Error('El QA posterior del modelo Enrollables no coincidió.'), {
            code: 'PENTAGRAMA_POST_APPLY_QA_FAILED'
          });
        }
      }

      this.store.updateOperation(operationId, { stage: 'QA' });
      const postQa = [];
      for (const { item, mapping } of verified) {
        for (const sample of this.validationCases(mapping)) {
          const [pentagrama, current] = await Promise.all([
            this.pricing.supplierCost(pentagramaParamsForCase(mapping, sample), { productDiscount: mapping.productDiscount, pricingMode: mapping.pricingMode }),
            this.homeeasyCost.cost(homeEasyItemForCase(mapping, sample), context)
          ]);
          postQa.push({ mappingId: item.id, caseId: sample.id, expected: roundMoney(pentagrama.total), actual: roundMoney(current.amount),
            difference: roundMoney(current.amount - pentagrama.total) });
        }
      }
      if (postQa.some(item => Math.abs(item.difference) > 0.02)) {
        throw Object.assign(new Error('Post-apply Pentagrama QA failed'), { code: 'PENTAGRAMA_POST_APPLY_QA_FAILED' });
      }

      const localChecked = Number(appliedLocal && appliedLocal.qa && appliedLocal.qa.checked || 0);
      const catalogChecked = Number(appliedCatalog && appliedCatalog.qa && appliedCatalog.qa.checked || 0);
      const localMaxDifference = Number(appliedLocal && appliedLocal.qa && appliedLocal.qa.maxDifference || 0);
      const qa = {
        ok: true,
        checked: postQa.length + catalogChecked + localChecked,
        maxDifference: Math.max(
          localMaxDifference,
          postQa.reduce((max, item) => Math.max(max, Math.abs(item.difference)), 0)
        ),
        cases: postQa,
        priceSheet: appliedPrices && appliedPrices.qa || null,
        catalogSheet: appliedCatalog && appliedCatalog.qa || null,
        localModel: appliedLocal && appliedLocal.qa || null
      };

      const changedIds = new Set((changes || []).map(item => item.id));
      const appliedCatalogIds = new Set(verifiedCatalog.map(item => item.id));
      const appliedExternalKeys = new Set(verifiedCatalog.map(item => item.externalKey).filter(Boolean));
      const verifiedResults = scan.results.map(item => changedIds.has(item.id) ? {
        ...item,
        status: 'UNCHANGED',
        autoApplicable: false,
        oldCost: item.strategy === 'LOCAL_MODEL' ? item.oldCost : item.newCost,
        difference: 0,
        percent: item.strategy === 'LOCAL_MODEL' ? null : 0,
        appliedAt: new Date().toISOString()
      } : item);
      const verifiedCounts = verifiedResults.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
      const remainingCatalogChanges = (scan.catalogChanges || []).filter(item => !appliedExternalKeys.has(item.externalKey));
      const remainingCatalogActions = (scan.catalogActions || []).map(item => appliedCatalogIds.has(item.id)
        ? { ...item, autoApplicable: false, appliedAt: new Date().toISOString(), status: 'UNCHANGED' }
        : item);
      const catalogAudit = { ...(scan.catalogAudit || {}) };
      catalogAudit.newReferences = remainingCatalogChanges.filter(item => item.status === 'NEW').length;
      catalogAudit.discontinued = remainingCatalogChanges.filter(item => item.status === 'DISCONTINUED').length;
      catalogAudit.renamed = remainingCatalogChanges.filter(item => item.status === 'RENAMED').length;
      catalogAudit.structureChanged = remainingCatalogChanges.filter(item => item.status === 'STRUCTURE_CHANGED').length;
      catalogAudit.catalogAutoApplicable = remainingCatalogActions.filter(item => item.autoApplicable === true).length;
      catalogAudit.catalogRateChanges = remainingCatalogActions.filter(item => item.kind === 'UPDATE_RATE' && item.autoApplicable === true).length;
      catalogAudit.catalogCertifiedAdditions = remainingCatalogActions.filter(item => item.kind === 'ADD' && item.autoApplicable === true).length;
      catalogAudit.catalogCertifiedDeactivations = remainingCatalogActions.filter(item => item.kind === 'DEACTIVATE' && item.autoApplicable === true).length;
      catalogAudit.catalogReviewRequired = remainingCatalogActions.filter(item => item.autoApplicable !== true && item.status !== 'UNCHANGED').length;

      const verifiedScan = {
        ...scan,
        id: crypto.randomUUID(),
        parentScanId: scan.id,
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SCAN_MAX_AGE_MS).toISOString(),
        counts: verifiedCounts,
        results: verifiedResults,
        catalogChanges: remainingCatalogChanges,
        catalogActions: remainingCatalogActions,
        catalogAudit,
        localModelCandidate: localChange ? null : scan.localModelCandidate,
        localModelVersion: appliedLocal && appliedLocal.version || scan.localModelVersion || null
      };
      this.store.addScan(verifiedScan);

      const upstreamHistoryIds = [
        appliedPrices && appliedPrices.historyId,
        appliedCatalog && appliedCatalog.historyId,
        appliedLocal && appliedLocal.historyId
      ].filter(Boolean);
      const entry = {
        id: crypto.randomUUID(),
        type: 'APPLY',
        at: new Date().toISOString(),
        scanId: scan.id,
        verifiedScanId: verifiedScan.id,
        changed: normalChanges.length + verifiedCatalog.length + (localChange ? 1 : 0),
        priceChanges: normalChanges.length,
        catalogChanges: verifiedCatalog.length,
        localModelChanges: localChange ? 1 : 0,
        upstreamHistoryIds,
        qa,
        actor: this.store.operationById(operationId).actor
      };
      this.store.addHistory(entry);
      this.store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', result: entry });
    } catch (error) {
      const rollbackResults = [];
      for (const historyId of [
        appliedLocal && appliedLocal.historyId,
        appliedCatalog && appliedCatalog.historyId,
        appliedPrices && appliedPrices.historyId
      ].filter(Boolean)) {
        try {
          rollbackResults.push(await this.homeeasy.rollback(historyId, context));
        } catch (rollbackError) {
          rollbackResults.push({ status: 'error', historyId, error: String(rollbackError.code || rollbackError.message || rollbackError) });
        }
      }
      if (rollbackResults.length) {
        const causeCode = String(error.code || 'PENTAGRAMA_SYNC_FAILED');
        throw Object.assign(new Error('La transacción no pasó QA y HomeEasy intentó restaurar todos los cambios.'), {
          code: causeCode === 'PENTAGRAMA_POST_APPLY_QA_FAILED'
            ? 'PENTAGRAMA_POST_APPLY_QA_ROLLED_BACK'
            : 'PENTAGRAMA_TRANSACTION_ROLLED_BACK',
          causeCode,
          rollbackResults
        });
      }
      throw error;
    }
  }

  startRollback(actor, context, payload) {
    if (!payload || !payload.confirmed || !payload.historyId) throw Object.assign(new Error('Explicit rollback confirmation is required'), { statusCode: 400, code: 'ROLLBACK_CONFIRMATION_REQUIRED' });
    const operation = this.store.operation('rollback', actor);
    setImmediate(async () => {
      try {
        this.store.updateOperation(operation.id, { state: 'running', stage: 'ROLLING_BACK' });
        const sourceHistoryId = String(payload.historyId);
        const storedEntry = (this.store.state.history || []).find(item => String(item.id) === sourceHistoryId);
        const upstreamIds = storedEntry && Array.isArray(storedEntry.upstreamHistoryIds) && storedEntry.upstreamHistoryIds.length
          ? storedEntry.upstreamHistoryIds.slice().reverse()
          : [sourceHistoryId];
        const results = [];
        for (const historyId of upstreamIds) results.push(await this.homeeasy.rollback(String(historyId), context));
        const qa = {
          ok: results.every(item => item && item.qa && item.qa.ok !== false),
          batches: results.map(item => ({ historyId: item.historyId, qa: item.qa }))
        };
        const entry = { id: crypto.randomUUID(), type: 'ROLLBACK', at: new Date().toISOString(), sourceHistoryId,
          upstreamHistoryIds: results.map(item => item.historyId).filter(Boolean), qa, actor };
        this.store.addHistory(entry); this.store.updateOperation(operation.id, { state: 'completed', stage: 'COMPLETED', result: entry });
      } catch (error) { this.fail(operation.id, error); }
    });
    return operation;
  }

  publicScan(scanOrId) {
    const scan = typeof scanOrId === 'string' ? this.store.scan(scanOrId) : scanOrId;
    if (!scan) return null;
    const local = scan.localModelCandidate;
    const results = (scan.results || []).map(item => {
      const {
        sourceModel, validationCases, priceEvidence, ...safe
      } = item || {};
      return safe;
    });
    const catalogActions = (scan.catalogActions || []).map(item => {
      const { mutation, evidence, ...safe } = item || {};
      return safe;
    });
    const catalogChanges = (scan.catalogChanges || []).map(item => ({
      ...item,
      live: item && item.live ? {
        name: item.live.name,
        productCode: item.live.productCode,
        groupCode: item.live.groupCode,
        associationGroup: item.live.associationGroup,
        primaryGroup: item.live.primaryGroup,
        calculationType: item.live.calculationType,
        unit: item.live.unit,
        path: item.live.path
      } : null
    }));
    return {
      ...scan,
      results,
      catalogActions,
      catalogChanges,
      localModelCandidate: local ? {
        version: local.version,
        generatedAt: local.generatedAt,
        sourceVersion: local.sourceVersion,
        summary: local.summary
      } : null
    };
  }

  fail(id, error) { this.store.updateOperation(id, { state: 'failed', stage: 'FAILED', error: { code: String(error.code || 'PENTAGRAMA_SYNC_FAILED'), message: String(error.message || 'Sync failed').slice(0, 300) } }); }
  status() {
    const scheduler = this.store.schedulerState();
    return { latestScan: this.publicScan(this.store.latestScan()), nextScheduledCheck: this.store.state.nextScheduledCheck,
      lastAutomaticCheck: scheduler.lastRunAt, automaticResult: scheduler.lastResult };
  }
}

module.exports = Object.freeze({ PentagramaPhase2, statusFor, operationContext, publicInventorySummary, SCAN_MAX_AGE_MS });
