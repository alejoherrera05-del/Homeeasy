'use strict';

const crypto = require('crypto');
const { INITIAL_MAPPINGS, pentagramaParams, homeEasyItem } = require('./mapper');
const { roundMoney } = require('./comparison');
const { HomeEasySyncClient } = require('./homeeasy-sync');
const { Phase2Store } = require('./phase2-store');

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
    this.store = options.store || new Phase2Store(options);
  }

  startScan(actor, context) {
    const operation = this.store.operation('scan', actor);
    setImmediate(() => this.runScan(operation.id, context).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  async runScan(operationId, context) {
    this.store.updateOperation(operationId, { state: 'running', stage: 'READING_HOMEEASY' });
    const source = await this.homeeasy.catalog(context);
    this.store.updateOperation(operationId, { stage: 'READING_PENTAGRAMA' });
    let catalogSummary = { categories: null };
    try {
      const categories = await this.gateway.dispatch('catalog', { operation: 'categories', params: {} }, { lockKey: 'catalog:categories' });
      catalogSummary.categories = Array.isArray(categories) ? categories.length : null;
    } catch (error) { catalogSummary.error = String(error.code || 'CATALOG_UNAVAILABLE'); }

    const results = [];
    const mappedIds = new Set(this.mappings.map(item => item.homeeasyId));
    for (const item of source.products || []) {
      if (!mappedIds.has(item.id)) results.push({ homeeasyId: item.id, family: item.familyName, reference: item.reference, status: 'UNMAPPED' });
    }
    this.store.updateOperation(operationId, { stage: 'COMPARING' });
    for (const mapping of this.mappings) {
      const sourceItem = (source.products || []).find(item => item.id === mapping.homeeasyId);
      if (!sourceItem) { results.push({ homeeasyId: mapping.homeeasyId, family: mapping.family, reference: mapping.reference, status: 'UNMAPPED' }); continue; }
      try {
        const [pentagrama, current] = await Promise.all([
          this.pricing.supplierCost(pentagramaParams(mapping), { productDiscount: mapping.productDiscount, pricingMode: mapping.pricingMode }),
          this.homeeasyCost.cost(homeEasyItem(mapping), context)
        ]);
        const oldCost = roundMoney(current.amount); const newCost = roundMoney(pentagrama.total);
        const difference = roundMoney(newCost - oldCost); const percent = oldCost ? roundMoney((difference / oldCost) * 100) : null;
        const status = statusFor(oldCost, newCost);
        const currentRate = Number(sourceItem.rate);
        const proposedRate = oldCost > 0 && Number.isFinite(currentRate) ? roundMoney(currentRate * newCost / oldCost) : null;
        results.push({ id: mapping.id, homeeasyId: mapping.homeeasyId, family: mapping.family, reference: mapping.reference,
          productCode: mapping.productCode, oldCost, newCost, difference, percent, status,
          width: mapping.width, height: mapping.height, quantity: mapping.quantity,
          severity: Math.abs(percent || 0) >= 30 ? 'review_required' : Math.abs(percent || 0) >= 15 ? 'warning' : 'normal',
          sourceRow: sourceItem.row, expectedRate: currentRate, proposedRate, updateField: mapping.updateField,
          priceEvidence: { basePrice: pentagrama.basePrice, distributorDiscount: pentagrama.distributorDiscount, productDiscount: pentagrama.productDiscount, vatRate: pentagrama.vatRate, total: pentagrama.total }
        });
      } catch (error) {
        results.push({ id: mapping.id, homeeasyId: mapping.homeeasyId, family: mapping.family, reference: mapping.reference, status: 'ERROR', error: String(error.code || 'SCAN_FAILED') });
      }
    }
    const counts = results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
    const scan = { id: crypto.randomUUID(), checkedAt: new Date().toISOString(), sourceVersion: source.version, catalogSummary,
      expiresAt: new Date(Date.now() + SCAN_MAX_AGE_MS).toISOString(), counts, results };
    this.store.addScan(scan);
    this.store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', scanId: scan.id, result: { scanId: scan.id, counts } });
  }

  startApply(actor, context, payload) {
    const scan = this.store.scan(String(payload.scanId || ''));
    if (!scan || Date.parse(scan.expiresAt) < Date.now()) throw Object.assign(new Error('Scan is missing or expired'), { statusCode: 409, code: 'PENTAGRAMA_SCAN_EXPIRED' });
    const requested = Array.isArray(payload.changeIds) ? new Set(payload.changeIds.map(String)) : null;
    const changes = scan.results.filter(item => ['INCREASED', 'DECREASED', 'NEW'].includes(item.status) && item.severity !== 'review_required' && (!requested || requested.has(item.id)));
    if (!changes.length) throw Object.assign(new Error('No safe mapped changes were selected'), { statusCode: 409, code: 'PENTAGRAMA_NO_APPLICABLE_CHANGES' });
    const operation = this.store.operation('apply', actor);
    setImmediate(() => this.runApply(operation.id, scan, changes, context).catch(error => this.fail(operation.id, error)));
    return operation;
  }

  async runApply(operationId, scan, changes, context) {
    this.store.updateOperation(operationId, { state: 'running', stage: 'SNAPSHOT' });
    this.store.updateOperation(operationId, { stage: 'WRITING_SHEET' });
    const applied = await this.homeeasy.apply(scan, changes.map(item => ({
      id: item.id, homeeasyId: item.homeeasyId, row: item.sourceRow, field: item.updateField,
      expectedRate: item.expectedRate, proposedRate: item.proposedRate, oldCost: item.oldCost, newCost: item.newCost, difference: item.difference, percent: item.percent
      , width: item.width, height: item.height, quantity: item.quantity
    })), context);
    this.store.updateOperation(operationId, { stage: 'QA' });
    const entry = { id: applied.historyId, type: 'APPLY', at: new Date().toISOString(), scanId: scan.id, changed: changes.length, qa: applied.qa, actor: this.store.operationById(operationId).actor };
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
  status() { return { latestScan: this.store.latestScan(), nextScheduledCheck: this.store.state.nextScheduledCheck }; }
}

module.exports = Object.freeze({ PentagramaPhase2, statusFor, operationContext, SCAN_MAX_AGE_MS });
