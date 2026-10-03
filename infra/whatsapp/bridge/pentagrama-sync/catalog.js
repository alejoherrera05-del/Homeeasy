'use strict';

class PentagramaCatalog {
  constructor(client) {
    this.client = client;
  }

  categories(params) {
    return this.client.get('/Order/GetJsonCategoryList', params);
  }

  products(params) {
    return this.client.get('/Order/GetJsonProductList', params);
  }

  attributes(params) {
    return this.client.get('/Atribute/ProductAttributes', params, 'html');
  }

  defaults(params) {
    return this.client.get('/Atribute/GetAttributesDefaultValues', params);
  }

  dependencies(params) {
    return this.client.post('/Atribute/AttributeDepends', params);
  }

  alerts(params) {
    return this.client.post('/Order/GetAlertListByParameters', params);
  }

  validateRoller(params) {
    return this.client.postForm('/Order/ValidarAltMaxEnrollable', params);
  }
}

module.exports = Object.freeze({ PentagramaCatalog });
