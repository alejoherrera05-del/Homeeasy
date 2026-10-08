'use strict';

const registry = require('./certification/catalog-certifications.json');
const { PRICE_STRATEGIES, MAPPING_STATUSES } = require('./mapper');

const CANDIDATE_CLASSES = Object.freeze({
  EXACT_CANDIDATE: 'EXACT_CANDIDATE', AMBIGUOUS: 'AMBIGUOUS', NO_CANDIDATE: 'NO_CANDIDATE'
});

function summarizeCatalogCertification(value = registry) {
  const products = Array.isArray(value.products) ? value.products : [];
  const count = (field, expected) => products.filter(item => item[field] === expected).length;
  const certifiedStrategies = Object.values(PRICE_STRATEGIES).reduce((result, strategy) => {
    result[strategy] = products.filter(item => item.status === MAPPING_STATUSES.CERTIFIED && item.strategy === strategy).length;
    return result;
  }, {});
  return Object.freeze({
    total: products.length,
    exactCandidates: count('candidate', CANDIDATE_CLASSES.EXACT_CANDIDATE),
    ambiguous: count('candidate', CANDIDATE_CLASSES.AMBIGUOUS),
    noCandidate: count('candidate', CANDIDATE_CLASSES.NO_CANDIDATE),
    certified: count('status', MAPPING_STATUSES.CERTIFIED),
    reviewRequired: count('status', MAPPING_STATUSES.REVIEW_REQUIRED),
    unmapped: count('status', MAPPING_STATUSES.UNMAPPED),
    certifiedStrategies
  });
}

function validateCatalogCertification(value = registry) {
  const summary = summarizeCatalogCertification(value);
  if (summary.total !== 452) throw new Error(`Certification registry must contain 452 products, found ${summary.total}`);
  for (const item of value.products) {
    if (!Object.values(CANDIDATE_CLASSES).includes(item.candidate)) throw new Error(`Invalid candidate class for ${item.homeeasyId}`);
    if (!Object.values(MAPPING_STATUSES).includes(item.status)) throw new Error(`Invalid status for ${item.homeeasyId}`);
    if (item.status === MAPPING_STATUSES.CERTIFIED) {
      if (item.candidate !== CANDIDATE_CLASSES.EXACT_CANDIDATE || !item.productCode || !item.groupCode ||
          !item.verifiedAt || Number(item.casesPassed) < 3 || Number(item.maxDifference) > 0.02) {
        throw new Error(`Incomplete Pentagrama certificate for ${item.homeeasyId}`);
      }
    }
  }
  return summary;
}

module.exports = Object.freeze({ registry, CANDIDATE_CLASSES, summarizeCatalogCertification, validateCatalogCertification });
