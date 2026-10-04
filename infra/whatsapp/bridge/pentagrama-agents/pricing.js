'use strict';

class AgentPentagramaPricing {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async price(params) {
    const result = await this.gateway.dispatch('getPrice', { params, options: { pricingMode: 'net-before-vat' } });
    return Number(result.basePrice);
  }

  async supplierCost(params, options = {}) {
    return this.gateway.dispatch('getPrice', { params, options });
  }
}

module.exports = Object.freeze({ AgentPentagramaPricing });
