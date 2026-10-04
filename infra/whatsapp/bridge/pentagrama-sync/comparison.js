'use strict';

const { mappingIsReady, selectMappings, pentagramaParams, homeEasyItem } = require('./mapper');

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

class PentagramaComparison {
  constructor(options) {
    this.pricing = options.pricing;
    this.homeeasy = options.homeeasy;
    this.mappings = options.mappings;
  }

  async check(options = {}) {
    const mappings = selectMappings(options.mappingIds, this.mappings);
    const changes = [];
    const results = [];
    let same = 0;
    let errors = 0;

    for (const mapping of mappings) {
      if (!mappingIsReady(mapping)) {
        errors += 1;
        results.push({ id: mapping.id, family: mapping.family, ok: false, error: 'MAPPING_INCOMPLETE' });
        continue;
      }
      try {
        const [pentagrama, current] = await Promise.all([
          this.pricing.supplierCost(pentagramaParams(mapping), {
            productDiscount: mapping.productDiscount,
            pricingMode: mapping.pricingMode
          }),
          this.homeeasy.cost(homeEasyItem(mapping), options.homeeasyContext)
        ]);
        const difference = roundMoney(pentagrama.total - current.amount);
        const percent = current.amount ? roundMoney((difference / current.amount) * 100) : null;
        const result = {
          id: mapping.id,
          family: mapping.family,
          homeeasyId: mapping.homeeasyId,
          productCode: mapping.productCode,
          oldCost: current.amount,
          newCost: pentagrama.total,
          difference,
          percent,
          same: Math.abs(difference) < 0.01
        };
        results.push(result);
        if (result.same) same += 1;
        else changes.push(result);
      } catch (error) {
        errors += 1;
        results.push({ id: mapping.id, family: mapping.family, ok: false, error: String(error.code || 'CHECK_FAILED') });
      }
    }

    return {
      ok: errors === 0,
      checkedAt: new Date().toISOString(),
      summary: { checked: mappings.length, same, changed: changes.length, errors },
      changes,
      results
    };
  }
}

module.exports = Object.freeze({ PentagramaComparison, roundMoney });
