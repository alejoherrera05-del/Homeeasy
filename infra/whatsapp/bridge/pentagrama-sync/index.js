'use strict';

const { PentagramaClient } = require('./client');
const { PentagramaCatalog } = require('./catalog');
const { PentagramaPricing } = require('./pricing');
const { HomeEasyCostClient } = require('./homeeasy');
const { PentagramaComparison } = require('./comparison');
const { INITIAL_MAPPINGS } = require('./mapper');

function createPentagramaSync(options = {}) {
  const client = options.client || new PentagramaClient(options);
  const catalog = options.catalog || new PentagramaCatalog(client);
  const mode = String(options.mode || process.env.PENTAGRAMA_MODE || 'direct').toLowerCase();
  const pricing = options.pricing || (mode === 'agent'
    ? new (require('../pentagrama-agents/pricing').AgentPentagramaPricing)(options.dispatcher)
    : new PentagramaPricing(client, options));
  const homeeasy = options.homeeasy || new HomeEasyCostClient(options);
  const comparison = options.comparison || new PentagramaComparison({ pricing, homeeasy, mappings: options.mappings || INITIAL_MAPPINGS });
  return Object.freeze({ mode, client, catalog, pricing, homeeasy, comparison });
}

module.exports = Object.freeze({ createPentagramaSync });
