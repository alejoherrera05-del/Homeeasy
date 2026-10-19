'use strict';

const SOURCE = Object.freeze({
  document: '581_FichaSheerElegance.pdf',
  pages: Object.freeze([2, 3, 5]),
  audit: 'docs/SHEER_STANDARD_PHYSICAL_AUDIT.md',
  production: 'products/sheer/production/apply-sheer-fabric-pack.js'
});

const SYSTEMS = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    headCode: 'STD',
    configurations: Object.freeze([
      Object.freeze({ id:'standard-manual-r8-vtx10-t32', mechanism:'R8/VTX10', tubeDiameterMm:32, maxWidthM:1.6, maxHeightM:1.8 }),
      Object.freeze({ id:'standard-manual-r8-t38', mechanism:'R8', tubeDiameterMm:38, maxWidthM:2.6, maxHeightM:1.2 })
    ])
  }),
  binovo: Object.freeze({
    id: 'binovo',
    configurations: Object.freeze([
      Object.freeze({ id:'binovo-manual-vtx10-clic-s-t32', mechanism:'VTX10 / CLIC S', tubeDiameterMm:32, maxWidthM:1.7, maxHeightM:2.6 }),
      Object.freeze({ id:'binovo-manual-vtx15-clic-m-t38', mechanism:'VTX15 / CLIC M', tubeDiameterMm:38, maxWidthM:2.6, maxHeightM:3 }),
      Object.freeze({ id:'binovo-manual-vtx20-clic-m-t50', mechanism:'VTX20 / CLIC M', tubeDiameterMm:50, maxWidthM:3, maxHeightM:2.2 })
    ])
  })
});

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findConfiguration(systemId, width, height) {
  const system = SYSTEMS[String(systemId || '').trim().toLowerCase()];
  const w = finitePositive(width);
  const h = finitePositive(height);
  if (!system || w == null || h == null) return null;
  return system.configurations.find(item =>
    w <= Number(item.maxWidthM) + 1e-9 &&
    h <= Number(item.maxHeightM) + 1e-9
  ) || null;
}

function supports(systemId, width, height) {
  return Boolean(findConfiguration(systemId, width, height));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

function selectedOptionValue(html, selectId) {
  const safe = escapeRegex(selectId);
  const select = String(html || '').match(new RegExp(
    '<select\\b[^>]*\\bid=["\\']' + safe + '["\\'][^>]*>([\\s\\S]*?)<\\/select>',
    'i'
  ));
  if (!select) return '';
  const optionRx = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let match;
  while ((match = optionRx.exec(select[1]))) {
    if (!/\bselected\b/i.test(match[1])) continue;
    const value = match[1].match(/\bvalue=["']([^"']*)/i);
    return value ? String(value[1]).trim() : '';
  }
  return '';
}

function productionSignatures() {
  return Object.values(SYSTEMS).flatMap(system =>
    system.configurations.map(item => ({
      id: item.id,
      mechanism: item.mechanism,
      tuple: 'maxWidthM:' + item.maxWidthM + ',maxHeightM:' + item.maxHeightM
    }))
  );
}

module.exports = Object.freeze({
  SOURCE,
  SYSTEMS,
  findConfiguration,
  supports,
  selectedOptionValue,
  productionSignatures
});
