'use strict';

const crypto = require('crypto');
const { INITIAL_MAPPINGS, MAPPING_STATUSES, mappingIsReady, mappingIsCertified, pentagramaParamsForCase, homeEasyItemForCase } = require('./mapper');
const { roundMoney } = require('./comparison');
const { buildProposal, same } = require('./strategies');
const { HomeEasySyncClient } = require('./homeeasy-sync');
const { Phase2Store } = require('./phase2-store');
const { registry: DEFAULT_CERTIFICATION_REGISTRY } = require('./catalog-certification');
const { PentagramaCatalogInventory, compareInventory } = require('./catalog-inventory');
const { buildCatalogBindings } = require('./catalog-bindings');
const DEFAULT_ENROLLABLES_REGISTRY = require('./enrollables-live-products.json');
const { CatalogCertifier, isRing, isRenueva, referenceName, sourceRowValues } = require('./catalog-certifier');

const SCAN_MAX_AGE_MS = 30 * 60 * 1000;

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

class PentagramaPhase2 {
  constructor(options = {}) {
    this.pricing = options.pricing;
    this.homeeasyCost = options.homeeasyCost;
    this.homeeasy = options.homeeasy || new HomeEasySyncClient(options);
    this.gateway = options.gateway;
    this.mappings = options.mappings || INITIAL_MAPPINGS;
    this.certificationRegistry = options.certificationRegistry || DEFAULT_CERTIFICATION_REGISTRY;
    this.enrollablesRegistry = options.enrollablesRegistry || DEFAULT_ENROLLABLES_REGISTRY;
    this.inventory = options.inventory || (this.gateway ? new PentagramaCatalogInventory({ gateway: this.gateway }) : null);
    this.catalogCertifier = options.catalogCertifier || (this.pricing && typeof this.pricing.supplierCost === 'function' ? new CatalogCertifier({ pricing: this.pricing }) : null);
    this.store = options.store || new Phase2Store(options);
  }

  startScan(actor, context) {
    const operation = this.store.operation('scan', actor);
    setImmediate(() => this.runScan(operation.id, context).catch(error => this.fail(operation.id, error)));
    return operation;
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
    try {
      return await this.gateway.dispatch('catalogInventory', {}, { lockKey: 'catalog-inventory:full' });
    } catch (error) {
      // Agentes anteriores a 1.4.0 no conocen el trabajo compuesto. Conservamos
      // compatibilidad recorriendo el catálogo con jobs pequeños hasta actualizar el agente.
      if (String(error && error.code || '') !== 'AGENT_JOB_NOT_ALLOWED') throw error;
      if (!this.inventory) throw error;
      return this.inventory.scan();
    }
  }

  inventoryAudit(sourceProducts, inventory) {
    const bindingState = buildCatalogBindings(sourceProducts, {
      mappings: this.mappings,
      enrollables: this.enrollablesRegistry
    });
    const comparison = compareInventory(bindingState.bindings, inventory && inventory.products || [], {
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
    const sourceById = new Map(sourceProducts.map(item => [String(item.id), item]));
    const sourceIds = new Set(sourceProducts.map(item => String(item.id)));
    const bindingState = buildCatalogBindings(sourceProducts, {
      mappings: this.mappings,
      enrollables: this.enrollablesRegistry
    });
    const comparison = compareInventory(bindingState.bindings, inventory && inventory.products || [], {
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
    const inventory = await this.fullCatalogInventory();
    const catalogInventoryAudit = this.inventoryAudit(source.products || [], inventory);
    const catalogActions = await this.buildCatalogActions(source, inventory);
    const catalogSummary = {
      categories: Number(inventory && inventory.counts && inventory.counts.roots || inventory && inventory.roots || 0),
      leaves: Number(inventory && inventory.counts && inventory.counts.leaves || inventory && inventory.leaves || 0),
      products: Number(inventory && inventory.counts && inventory.counts.products || (inventory && inventory.products || []).length),
      requests: Number(inventory && inventory.requests || 0)
    };

    const results = [];
    const mappedIds = new Set(this.mappings.map(item => item.homeeasyId));
    const certifiedMappingIds = new Set(this.mappings.filter(mappingIsCertified).map(item => item.homeeasyId));
    const certificationById = new Map((this.certificationRegistry.products || []).map(item => [item.homeeasyId, item]));
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
    for (const mapping of this.mappings) {
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
    const scan = { id: crypto.randomUUID(), checkedAt: new Date().toISOString(), sourceVersion: source.version, sourceValidThrough: source.validThrough, catalogSummary,
      catalogInventoryAudit,
      catalogChanges: catalogInventoryAudit.changes,
      catalogActions,
      catalogAudit: { total: (source.products || []).length, mapped: results.filter(item => item.id).length,
        certified: results.filter(item => item.id && certifiedMappingIds.has(item.homeeasyId)).length,
        autoUpdatable: results.filter(item => item.autoApplicable).length,
        reviewRequired: results.filter(item => item.status === 'REVIEW_REQUIRED').length,
        unmapped: results.filter(item => item.status === 'UNMAPPED').length, strategies: strategyCounts,
        pentagramaProducts: catalogSummary.products,
        newReferences: Number(catalogInventoryAudit.counts.NEW || 0),
        discontinued: Number(catalogInventoryAudit.counts.DISCONTINUED || 0),
        renamed: Number(catalogInventoryAudit.counts.RENAMED || 0),
        structureChanged: Number(catalogInventoryAudit.counts.STRUCTURE_CHANGED || 0),
        bindingConflicts: catalogInventoryAudit.bindingConflicts.length,
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
    const verified = [];
    for (const item of changes) {
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

      const qa = {
        ok: true,
        checked: postQa.length + Number(appliedCatalog && appliedCatalog.qa && appliedCatalog.qa.checked || 0),
        maxDifference: postQa.reduce((max, item) => Math.max(max, Math.abs(item.difference)), 0),
        cases: postQa,
        priceSheet: appliedPrices && appliedPrices.qa || null,
        catalogSheet: appliedCatalog && appliedCatalog.qa || null
      };
      const changedIds = new Set(changes.map(item => item.id));
      const appliedCatalogIds = new Set(verifiedCatalog.map(item => item.id));
      const appliedExternalKeys = new Set(verifiedCatalog.map(item => item.externalKey).filter(Boolean));
      const verifiedResults = scan.results.map(item => changedIds.has(item.id) ? { ...item, status: 'UNCHANGED', oldCost: item.newCost,
        difference: 0, percent: 0, appliedAt: new Date().toISOString() } : item);
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
      catalogAudit.catalogReviewRequired = remainingCatalogActions.filter(item => item.autoApplicable !== true && item.status !== 'UNCHANGED').length;
      const verifiedScan = { ...scan, id: crypto.randomUUID(), parentScanId: scan.id, checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SCAN_MAX_AGE_MS).toISOString(), counts: verifiedCounts, results: verifiedResults,
        catalogChanges: remainingCatalogChanges, catalogActions: remainingCatalogActions, catalogAudit };
      this.store.addScan(verifiedScan);

      const upstreamHistoryIds = [appliedPrices && appliedPrices.historyId, appliedCatalog && appliedCatalog.historyId].filter(Boolean);
      const entry = { id: crypto.randomUUID(), type: 'APPLY', at: new Date().toISOString(), scanId: scan.id, verifiedScanId: verifiedScan.id,
        changed: changes.length + verifiedCatalog.length, priceChanges: changes.length, catalogChanges: verifiedCatalog.length,
        upstreamHistoryIds, qa, actor: this.store.operationById(operationId).actor };
      this.store.addHistory(entry);
      this.store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', result: entry });
    } catch (error) {
      const rollbackResults = [];
      for (const historyId of [appliedCatalog && appliedCatalog.historyId, appliedPrices && appliedPrices.historyId].filter(Boolean)) {
        try { rollbackResults.push(await this.homeeasy.rollback(historyId, context)); } catch (rollbackError) {
          rollbackResults.push({ status: 'error', historyId, error: String(rollbackError.code || rollbackError.message || rollbackError) });
        }
      }
      if (rollbackResults.length) {
        throw Object.assign(new Error('La transacción no pasó QA y HomeEasy intentó restaurar todos los cambios.'), {
          code: 'PENTAGRAMA_TRANSACTION_ROLLED_BACK',
          causeCode: String(error.code || 'PENTAGRAMA_SYNC_FAILED'),
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

  fail(id, error) { this.store.updateOperation(id, { state: 'failed', stage: 'FAILED', error: { code: String(error.code || 'PENTAGRAMA_SYNC_FAILED'), message: String(error.message || 'Sync failed').slice(0, 300) } }); }
  status() {
    const scheduler = this.store.schedulerState();
    return { latestScan: this.store.latestScan(), nextScheduledCheck: this.store.state.nextScheduledCheck,
      lastAutomaticCheck: scheduler.lastRunAt, automaticResult: scheduler.lastResult };
  }
}

module.exports = Object.freeze({ PentagramaPhase2, statusFor, operationContext, SCAN_MAX_AGE_MS });
