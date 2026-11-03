'use strict';

const { PentagramaClient } = require('./client');
const { PentagramaCatalog } = require('./catalog');
const { PentagramaPricing } = require('./pricing');
const { HomeEasyCostClient } = require('./homeeasy');
const { PentagramaComparison } = require('./comparison');
const { INITIAL_MAPPINGS } = require('./mapper');
const { PentagramaLiveResolver } = require('./live-resolver');
const { PentagramaCatalogInventory } = require('./catalog-inventory');
const { buildEnrollablesLocalCandidate } = require('./local-model');

function createPentagramaSync(options = {}) {
  const client = options.client || new PentagramaClient(options);
  const catalog = options.catalog || new PentagramaCatalog(client);
  const mode = String(options.mode || process.env.PENTAGRAMA_MODE || 'direct').toLowerCase();
  const pricing = options.pricing || (mode === 'agent'
    ? new (require('../pentagrama-agents/pricing').AgentPentagramaPricing)(options.dispatcher)
    : new PentagramaPricing(client, options));
  const homeeasy = options.homeeasy || new HomeEasyCostClient(options);
  const comparison = options.comparison || new PentagramaComparison({ pricing, homeeasy, mappings: options.mappings || INITIAL_MAPPINGS });
  const liveResolver = options.liveResolver || new PentagramaLiveResolver({ catalog, pricing, vatRate: options.vatRate });
  const directCatalogGateway = {
    dispatch: async (type, payload = {}) => {
      if (type !== 'catalog') throw Object.assign(new Error('Unsupported local catalog job'), { code: 'AGENT_JOB_NOT_ALLOWED' });
      const operation = String(payload.operation || '');
      if (!['categories', 'products'].includes(operation) || typeof catalog[operation] !== 'function') {
        throw Object.assign(new Error('Catalog operation is not allowed'), { code: 'AGENT_CATALOG_OPERATION_NOT_ALLOWED' });
      }
      return catalog[operation](payload.params || {});
    }
  };
  const inventoryGateway = mode === 'agent' && options.dispatcher && typeof options.dispatcher.dispatch === 'function'
    ? options.dispatcher
    : directCatalogGateway;
  const catalogInventory = options.catalogInventory || new PentagramaCatalogInventory({ gateway: inventoryGateway });
  const localModel = Object.freeze({ build: source => buildEnrollablesLocalCandidate({
    source,
    quoteBase: input => liveResolver.quoteBase(input),
    resolveLive: input => liveResolver.resolve(input),
    configurationOptions: input => liveResolver.configurationOptions(input)
  }) });
  return Object.freeze({ mode, client, catalog, pricing, homeeasy, comparison, liveResolver, catalogInventory, localModel });
}

module.exports = Object.freeze({ createPentagramaSync });
