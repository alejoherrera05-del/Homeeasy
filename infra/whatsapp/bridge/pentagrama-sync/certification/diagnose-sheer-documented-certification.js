'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HomeEasySyncClient } = require(path.join(__dirname, '..', 'homeeasy-sync'));
const {
  SOURCE,
  SYSTEMS,
  supports,
  selectedOptionValue,
  productionSignatures
} = require('./sheer-fabrication-policy');

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const targets = registry.products
  .filter(item =>
    item.family === 'Sheer Elegance' &&
    item.status === 'REVIEW_REQUIRED' &&
    item.candidate === 'EXACT_CANDIDATE' &&
    item.productCode &&
    item.groupCode
  )
  .map(item => ({
    homeeasyId:item.homeeasyId,
    reference:item.reference,
    productCode:String(item.productCode),
    groupCode:String(item.groupCode),
    associationGroup:String(item.associationGroup || 'SHEERSTD'),
    calculationType:String(item.calculationType || 'NormalProduct')
  }));

const PRICE_SAMPLES = Object.freeze([
  Object.freeze({id:'price-a',width:1.0,height:1.3}),
  Object.freeze({id:'price-b',width:1.4,height:1.8}),
  Object.freeze({id:'price-c',width:1.8,height:2.1})
]);

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(Number(value || 0) * factor) / factor;
}

function approxEqual(a, b, tolerance = 0.02) {
  return Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    Math.abs(Number(a) - Number(b)) <= tolerance;
}

async function post(body) {
  const response = await fetch(API + '/api/pentagrama-sync/catalog', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-HomeEasy-Token':TOKEN},
    body:JSON.stringify(body)
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || !payload || !payload.ok) {
    return {ok:false,code:String(payload && (payload.code || payload.error) || 'PENTAGRAMA_CATALOG_FAILED')};
  }
  return {ok:true,result:payload.result};
}

async function fixedPrice(target, sample) {
  const response = await post({
    operation:'fixedPrice',
    params:{Code:target.productCode,cantidad:1,ancho:sample.width,alto:sample.height}
  });
  if (!response.ok) return response;
  const raw = response.result;
  const value = typeof raw === 'number'
    ? raw
    : Number(raw && (raw.Price ?? raw.price ?? raw.Value ?? raw.value));
  if (!Number.isFinite(value) || value <= 0) return {ok:false,code:'FIXED_PRICE_NOT_POSITIVE'};
  return {
    ok:true,
    fixed:round(value),
    area:round(sample.width * sample.height, 4),
    rateNet:round(value / (sample.width * sample.height))
  };
}

async function selectedHead(target) {
  const response = await post({
    operation:'attributes',
    params:{
      ProductCode:target.productCode,
      Group:target.associationGroup,
      GroupCode:target.groupCode,
      LineNumber:'',
      PrimaryGroup:'',
      Discount:0,
      CalculationType:target.calculationType,
      Modified:''
    }
  });
  if (!response.ok) return response;
  return {ok:true,value:selectedOptionValue(String(response.result || ''), 'cabezal').toUpperCase()};
}

function productionParity() {
  const missing = [];
  const checked = [];
  const skipped = [];

  if (!supports('standard', 1.0, 1.3) ||
      !supports('standard', 1.6, 1.8) ||
      !supports('standard', 2.6, 1.2) ||
      supports('standard', 1.7, 1.8) ||
      supports('standard', 2.6, 1.3)) {
    missing.push('standard matrix self-check');
  } else {
    checked.push('embedded-standard-matrix');
  }

  const repoRoot = process.env.HOMEEASY_REPO_ROOT
    ? path.resolve(process.env.HOMEEASY_REPO_ROOT)
    : path.resolve(__dirname, '../../../../..');
  const productionPath = path.join(repoRoot, SOURCE.production);
  const auditPath = path.join(repoRoot, SOURCE.audit);

  if (fs.existsSync(productionPath)) {
    const source = fs.readFileSync(productionPath, 'utf8');
    for (const signature of productionSignatures()) {
      if (!source.includes(signature.mechanism)) missing.push('production mechanism ' + signature.mechanism);
      if (!source.includes(signature.tuple)) missing.push('production tuple ' + signature.tuple);
    }
    checked.push(SOURCE.production);
  } else {
    skipped.push(SOURCE.production + ' not mounted in Bridge container');
  }

  if (fs.existsSync(auditPath)) {
    const audit = fs.readFileSync(auditPath, 'utf8');
    if (!audit.includes(SOURCE.document)) missing.push('audit source ' + SOURCE.document);
    checked.push(SOURCE.audit);
  } else {
    skipped.push(SOURCE.audit + ' not mounted in Bridge container');
  }

  return {ok:missing.length === 0,missing,checked,skipped};
}

(async()=>{
  const parity = productionParity();
  if (!parity.ok) {
    console.log(JSON.stringify({
      summary:{aborted:true,reason:'SHEER_DOCUMENTED_MATRIX_DRIFT',targets:targets.length},
      source:SOURCE,
      parity
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const homeeasy = new HomeEasySyncClient();
  const catalog = await homeeasy.catalog({
    serviceKey:process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY,
    deviceId:'sheer-documented-certification',
    deviceName:'Sheer Documented Certification',
    platform:'VPS',
    browser:'Node'
  });
  const sourceById = new Map((catalog.products || []).map(item => [String(item.id), item]));

  const rows = [];
  for (const target of targets) {
    const source = sourceById.get(String(target.homeeasyId)) || null;
    const currentRate = source ? Number(source.rate || 0) : null;

    const reads = [];
    for (const sample of PRICE_SAMPLES) {
      const result = await fixedPrice(target, sample);
      reads.push(Object.assign({}, sample, result));
    }

    const positiveRates = reads.filter(item => item.ok).map(item => item.rateNet);
    const priceConsistent = reads.length === PRICE_SAMPLES.length &&
      positiveRates.length === PRICE_SAMPLES.length &&
      positiveRates.every(rate => approxEqual(rate, positiveRates[0]));

    const pentagramaRateNet = priceConsistent ? round(positiveRates[0]) : null;
    const pentagramaRateVat = pentagramaRateNet == null ? null : round(pentagramaRateNet * 1.19);
    const rateDifference = currentRate != null && pentagramaRateVat != null
      ? round(pentagramaRateVat - currentRate)
      : null;
    const exactCurrent = rateDifference != null && Math.abs(rateDifference) <= 0.02;

    const head = await selectedHead(target);
    const associationStandard = target.associationGroup === 'SHEERSTD';
    const headStd = head.ok && head.value === SYSTEMS.standard.headCode;
    const headEvidence = headStd
      ? 'HTML_SELECTED_STD'
      : (head.ok && !head.value && associationStandard ? 'ASSOCIATION_GROUP_SHEERSTD' : null);

    const certifiable = Boolean(
      priceConsistent &&
      exactCurrent &&
      headEvidence &&
      currentRate > 0
    );

    rows.push({
      homeeasyId:target.homeeasyId,
      reference:target.reference,
      productCode:target.productCode,
      groupCode:target.groupCode,
      certifiable,
      currentRate,
      pentagramaRateNet,
      pentagramaRateVat,
      rateDifference,
      priceConsistent,
      head:head.ok ? head.value : null,
      headEvidence,
      associationGroup:target.associationGroup,
      headCode:head.ok ? null : head.code,
      reads
    });
  }

  const failures = rows
    .filter(row => !row.certifiable)
    .map(row => ({
      homeeasyId:row.homeeasyId,
      reference:row.reference,
      priceConsistent:row.priceConsistent,
      currentRate:row.currentRate,
      pentagramaRateVat:row.pentagramaRateVat,
      rateDifference:row.rateDifference,
      head:row.head,
      headEvidence:row.headEvidence,
      associationGroup:row.associationGroup,
      headCode:row.headCode
    }));

  const output = {
    checkedAt:new Date().toISOString(),
    source:{
      price:'Pentagrama authenticated fixedPrice endpoint',
      fabricationDocument:SOURCE.document,
      fabricationPages:SOURCE.pages,
      audit:SOURCE.audit,
      production:SOURCE.production,
      vatFactor:1.19
    },
    fabrication:{
      standard:SYSTEMS.standard.configurations,
      binovo:SYSTEMS.binovo.configurations
    },
    summary:{
      aborted:false,
      targets:rows.length,
      priceConsistent:rows.filter(row => row.priceConsistent).length,
      exactCurrentMatches:rows.filter(row => row.rateDifference != null && Math.abs(row.rateDifference) <= 0.02).length,
      headStd:rows.filter(row => row.head === SYSTEMS.standard.headCode).length,
      standardAssociationEvidence:rows.filter(row => row.headEvidence === 'ASSOCIATION_GROUP_SHEERSTD').length,
      headEvidenceResolved:rows.filter(row => Boolean(row.headEvidence)).length,
      certifiable:rows.filter(row => row.certifiable).length,
      pending:rows.filter(row => !row.certifiable).length,
      productionParity:true
    },
    certifiedIds:rows.filter(row => row.certifiable).map(row => row.homeeasyId),
    failures
  };

  if (process.env.SHEER_FULL_EVIDENCE === '1') output.rows = rows;
  console.log(JSON.stringify(output, null, 2));
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:String(error.code || error.message || 'SHEER_DOCUMENTED_CERTIFICATION_FAILED')}));
  process.exitCode = 1;
});
