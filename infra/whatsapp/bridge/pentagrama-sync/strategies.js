'use strict';

const { PRICE_STRATEGIES, mappingIsCertified } = require('./mapper');
const TOLERANCE = 0.02;

function money(value) { return Math.round(Number(value) * 100) / 100; }
function meters(value) { return Number(value || 0); }
function effectiveArea(source, sample) {
  const width = meters(sample.width); const height = meters(sample.height);
  return Math.max(width * Math.max(height, meters(source.minHeight)), meters(source.minArea));
}
function homeEasyRateCost(rate, source, sample) {
  const discount = source.promotional ? (100 - Number(source.extraDiscount || 0)) / 100 : 1;
  return money(Math.round(effectiveArea(source, sample) * Number(rate) * 100 * discount) / 100);
}
function complementFactor(mapping, source, sample) {
  const quantity = Number(mapping && mapping.homeeasy && mapping.homeeasy.quantity || mapping && mapping.quantity || 1);
  if (!(quantity > 0)) return 0;
  if (String(source && source.method || '') === 'linear-height') return meters(sample.height) * quantity;
  if (String(source && source.method || '') === 'linear-width') return meters(sample.width) * quantity;
  if (String(source && source.method || '') === 'unit') return quantity;
  return 0;
}
function homeEasyComplementCost(rate, mapping, source, sample) {
  const discount = source.promotional ? (100 - Number(source.extraDiscount || 0)) / 100 : 1;
  return money(Math.round(complementFactor(mapping, source, sample) * Number(rate) * 100 * discount) / 100);
}
function same(a, b) { return Math.abs(Number(a) - Number(b)) <= TOLERANCE; }

function rateM2Proposal(mapping, source, evidence) {
  if (String(source.method) !== 'area') return { autoApplicable: false, reason: 'HomeEasy no usa una tarifa por m² para esta referencia.' };
  const derives = evidence.filter(item => item.role === 'derive');
  if (derives.length < 2) return { autoApplicable: false, reason: 'Se requieren dos medidas lineales no afectadas por mínimos.' };
  if (derives.some(item => effectiveArea(source, item) !== Number(item.width) * Number(item.height))) {
    return { autoApplicable: false, reason: 'Una medida de derivación está afectada por un mínimo HomeEasy.' };
  }
  const discount = source.promotional ? (100 - Number(source.extraDiscount || 0)) / 100 : 1;
  if (!(discount > 0)) return { autoApplicable: false, reason: 'El descuento configurado no permite reconstruir la tarifa.' };
  const rates = derives.map(item => Number(item.pentagrama.total) / (effectiveArea(source, item) * discount));
  if (Math.max(...rates) - Math.min(...rates) > 0.02) {
    return { autoApplicable: false, reason: 'Pentagrama no mostró una tarifa lineal consistente entre las dos medidas.' };
  }
  const proposedRate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
  const cases = evidence.map(item => ({ id: item.id, role: item.role, width: item.width, height: item.height,
    expected: money(item.pentagrama.total), reproduced: homeEasyRateCost(proposedRate, source, item) }));
  const mismatch = cases.find(item => !same(item.expected, item.reproduced));
  if (mismatch) return { autoApplicable: false, proposedRate, cases,
    reason: `La tarifa propuesta no reproduce Pentagrama en ${mismatch.id} (diferencia mayor a $0,02).` };
  return { autoApplicable: true, proposedRate, cases, reason: null };
}

function complementProposal(mapping, source, evidence) {
  const derives = evidence.filter(item => item.role === 'derive');
  if (derives.length < 2) return { autoApplicable: false, reason: 'Se requieren dos medidas lineales del complemento.' };
  const discount = source.promotional ? (100 - Number(source.extraDiscount || 0)) / 100 : 1;
  const factors = derives.map(item => complementFactor(mapping, source, item));
  if (factors.some(value => !(value > 0)) || !(discount > 0)) {
    return { autoApplicable: false, reason: 'El método lineal o la cantidad del complemento no son válidos.' };
  }
  const rates = derives.map((item, index) => Number(item.pentagrama.total) / (factors[index] * discount));
  if (Math.max(...rates) - Math.min(...rates) > 0.02) {
    return { autoApplicable: false, reason: 'Pentagrama no mostró una tarifa lineal consistente para el complemento.' };
  }
  const proposedRate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
  const cases = evidence.map(item => ({
    id: item.id, role: item.role, width: item.width, height: item.height,
    expected: money(item.pentagrama.total), reproduced: homeEasyComplementCost(proposedRate, mapping, source, item)
  }));
  const mismatch = cases.find(item => !same(item.expected, item.reproduced));
  if (mismatch) return { autoApplicable: false, proposedRate, cases,
    reason: `La tarifa lineal propuesta no reproduce Pentagrama en ${mismatch.id} (diferencia mayor a $0,02).` };
  return { autoApplicable: true, proposedRate, cases, reason: null };
}

function buildProposal(mapping, source, evidence) {
  if (!mappingIsCertified(mapping)) return { autoApplicable: false,
    reason: mapping && mapping.reviewReason || 'El mapping no tiene certificado Pentagrama vigente.' };
  if (!mapping || mapping.autoApplicable === false) return { autoApplicable: false, reason: mapping && mapping.reviewReason || 'Mapping no autorizado para actualización automática.' };
  if (!Array.isArray(evidence) || !evidence.length) return { autoApplicable: false, reason: 'No existe evidencia de precio suficiente.' };
  if (mapping.strategy === PRICE_STRATEGIES.RATE_M2) return rateM2Proposal(mapping, source, evidence);
  if (mapping.strategy === PRICE_STRATEGIES.COMPLEMENT) return complementProposal(mapping, source, evidence);
  if (mapping.strategy === PRICE_STRATEGIES.MATRIX) return { autoApplicable: false, reason: 'La matriz requiere celdas Pentagrama explícitas; no se admite proporcionalidad.' };
  if (mapping.strategy === PRICE_STRATEGIES.FIXED_PRICE) {
    return { autoApplicable: false, reason: 'Falta declarar el factor y destino exactos del valor fijo/complemento.' };
  }
  return { autoApplicable: false, reason: 'La configuración especial no está completamente determinada.' };
}

module.exports = Object.freeze({ TOLERANCE, effectiveArea, homeEasyRateCost, complementFactor, homeEasyComplementCost, buildProposal, same });
