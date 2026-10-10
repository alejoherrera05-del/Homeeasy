'use strict';

const crypto = require('crypto');
const { INITIAL_MAPPINGS, MAPPING_STATUSES, mappingIsReady, mappingIsCertified, pentagramaParamsForCase, homeEasyItemForCase } = require('./mapper');
const { roundMoney } = require('./comparison');
const { buildProposal, same } = require('./strategies');
const { HomeEasySyncClient } = require('./homeeasy-sync');
const { Phase2Store } = require('./phase2-store');
const { registry: DEFAULT_CERTIFICATION_REGISTRY } = require('./catalog-certification');

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

  async runScan(operationId, context) {
    this.store.updateOperation(operationId, { state: 'running', stage: 'READING_HOMEEASY' });
    const source = await this.homeeasy.catalog(context);
    this.store.updateOperation(operationId, { stage: 'READING_PENTAGRAMA' });
    const catalogSummary = { categories: null };
    try {
      const categories = await this.gateway.dispatch('catalog', { operation: 'categories', params: {} }, { lockKey: 'catalog:categories' });
      catalogSummary.categories = Array.isArray(categories) ? categories.length : null;
    } catch (error) { catalogSummary.error = String(error.code || 'CATALOG_UNAVAILABLE'); }

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
    const scan = { id: crypto.randomUUID(), checkedAt: new Date().toISOString(), sourceVersion: source.version, catalogSummary,
      catalogAudit: { total: (source.products || []).length, mapped: results.filter(item => item.id).length,
        certified: results.filter(item => item.id && certifiedMappingIds.has(item.homeeasyId)).length,
        autoUpdatable: results.filter(item => item.autoApplicable).length,
        reviewRequired: results.filter(item => item.status === 'REVIEW_REQUIRED').length,
        unmapped: results.filter(item => item.status === 'UNMAPPED').length, strategies: strategyCounts },
      expiresAt: new Date(Date.now() + SCAN_MAX_AGE_MS).toISOString(), counts, results };
    this.store.addScan(scan);
    this.store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', scanId: scan.id, result: { scanId: scan.id, counts } });
  }

  startApply(actor, context, payload) {
    const scan = this.store.scan(String(payload.scanId || ''));
    if (!scan || Date.parse(scan.expiresAt) < Date.now()) throw Object.assign(new Error('Scan is missing or expired'), { statusCode: 409, code: 'PENTAGRAMA_SCAN_EXPIRED' });
    const requested = Array.isArray(payload.changeIds) ? new Set(payload.changeIds.map(String)) : null;
    const changes = scan.results.filter(item => ['INCREASED', 'DECREASED', 'NEW'].includes(item.status) && item.autoApplicable === true && (!requested || requested.has(item.id)));
    if (!changes.length) throw Object.assign(new Error('No verified changes were selected'), { statusCode: 409, code: 'PENTAGRAMA_NO_APPLICABLE_CHANGES' });
    const operation = this.store.operation('apply', actor);
    setImmediate(() => this.runApply(operation.id, scan, changes, context).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  async runApply(operationId, scan, changes, context) {
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
    this.store.updateOperation(operationId, { stage: 'SNAPSHOT' });
    this.store.updateOperation(operationId, { stage: 'WRITING_SHEET' });
    const applied = await this.homeeasy.apply(scan, verified.map(({ item, mapping, validation }) => ({
      id: item.id, homeeasyId: item.homeeasyId, row: item.sourceRow, field: item.updateField,
      expectedRate: item.expectedRate, proposedRate: item.proposedRate, oldCost: item.oldCost, newCost: item.newCost,
      difference: item.difference, percent: item.percent, width: item.width, height: item.height, quantity: item.quantity,
      strategy: item.strategy, destination: item.destination,
      qaCases: validation.evidence.map(sample => ({ id: sample.id, width: sample.width, height: sample.height,
        quantity: item.quantity, expected: roundMoney(sample.pentagrama.total), homeeasy: homeEasyItemForCase(mapping, sample) }))
    })), context);
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
      const rollback = await this.homeeasy.rollback(applied.historyId, context);
      throw Object.assign(new Error('Post-apply Pentagrama QA failed; the batch was rolled back'), {
        code: 'PENTAGRAMA_POST_APPLY_QA_ROLLED_BACK', rollbackHistoryId: rollback.historyId
      });
    }
    const qa = { ok: true, checked: postQa.length, maxDifference: postQa.reduce((max, item) => Math.max(max, Math.abs(item.difference)), 0), cases: postQa, sheet: applied.qa };
    const changedIds = new Set(changes.map(item => item.id));
    const verifiedResults = scan.results.map(item => changedIds.has(item.id) ? { ...item, status: 'UNCHANGED', oldCost: item.newCost,
      difference: 0, percent: 0, appliedAt: new Date().toISOString() } : item);
    const verifiedCounts = verifiedResults.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
    const verifiedScan = { ...scan, id: crypto.randomUUID(), parentScanId: scan.id, checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SCAN_MAX_AGE_MS).toISOString(), counts: verifiedCounts, results: verifiedResults };
    this.store.addScan(verifiedScan);
    const entry = { id: applied.historyId, type: 'APPLY', at: new Date().toISOString(), scanId: scan.id, verifiedScanId: verifiedScan.id,
      changed: changes.length, qa, actor: this.store.operationById(operationId).actor };
    this.store.addHistory(entry);
    this.store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', result: entry });
  }

  startRollback(actor, context, payload) {
    if (!payload || !payload.confirmed || !payload.historyId) throw Object.assign(new Error('Explicit rollback confirmation is required'), { statusCode: 400, code: 'ROLLBACK_CONFIRMATION_REQUIRED' });
    const operation = this.store.operation('rollback', actor);
    setImmediate(async () => {
      try {
        this.store.updateOperation(operation.id, { state: 'running', stage: 'ROLLING_BACK' });
        const result = await this.homeeasy.rollback(String(payload.historyId), context);
        const entry = { id: result.historyId, type: 'ROLLBACK', at: new Date().toISOString(), sourceHistoryId: payload.historyId, qa: result.qa, actor };
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
