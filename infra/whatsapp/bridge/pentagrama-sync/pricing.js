'use strict';

const { UpstreamResponseError } = require('./errors');

function decimalFraction(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number > 1 ? number / 100 : number;
}

function requiredText(value, name) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) throw Object.assign(new Error(`${name} is required`), { statusCode: 400 });
  return text;
}

class PentagramaPricing {
  constructor(client, options = {}) {
    this.client = client;
    this.vatRate = decimalFraction(options.vatRate === undefined ? 0.19 : options.vatRate);
    this.termsTtlMs = Math.max(30000, Number(options.termsTtlMs || 10 * 60 * 1000));
    this.terms = null;
  }

  async price(params) {
    const query = {
      ProductCode: requiredText(params.ProductCode, 'ProductCode'),
      Quantity: requiredText(params.Quantity === undefined ? 1 : params.Quantity, 'Quantity'),
      Width: requiredText(params.Width, 'Width'),
      Height: requiredText(params.Height, 'Height'),
      GroupCode: params.GroupCode === undefined ? '' : params.GroupCode,
      calculationType: requiredText(params.calculationType || 'NormalProduct', 'calculationType'),
      Degrees: params.Degrees === undefined ? '' : params.Degrees,
      Panels: params.Panels === undefined ? 0 : params.Panels,
      Cabezal: params.Cabezal === undefined ? '' : params.Cabezal,
      ItemCodeFather: params.ItemCodeFather === undefined ? '' : params.ItemCodeFather
    };
    const data = await this.client.get('/Order/GetProductPrice', query);
    const price = typeof data === 'number' ? data : Number(data && (data.Price ?? data.price ?? data.Value ?? data.value));
    if (!Number.isFinite(price) || price < 0) {
      throw new UpstreamResponseError('Pentagrama price response does not contain a valid amount');
    }
    return price;
  }

  async accountTerms() {
    if (this.terms && this.terms.expiresAt > Date.now()) return this.terms.value;
    const html = await this.client.get('/Order/SearchProduct?reset=True', null, 'html');
    const percentMatch = html.match(/\bdistDiscount\s*=\s*parseFloat\s*\(\s*String\s*\(\s*['"]([\d.,]+)['"]/i);
    const fractionMatch = html.match(/\bdistDiscountAttributes\s*=\s*parseFloat\s*\(\s*['"]([\d.,]+)['"]/i);
    const raw = percentMatch ? percentMatch[1] : fractionMatch ? fractionMatch[1] : '';
    if (!raw) throw new UpstreamResponseError('Pentagrama account discount was not found in the authenticated order model');
    const distributorDiscount = decimalFraction(String(raw).replace(',', '.'));
    if (distributorDiscount >= 1) throw new UpstreamResponseError('Pentagrama account discount is invalid');
    const value = Object.freeze({ distributorDiscount, vatRate: this.vatRate });
    this.terms = { value, expiresAt: Date.now() + this.termsTtlMs };
    return value;
  }

  async supplierCost(params, options = {}) {
    const pricingMode = String(options.pricingMode || 'account-discount');
    if (!['account-discount', 'net-before-vat'].includes(pricingMode)) {
      throw Object.assign(new Error('Unsupported Pentagrama pricing mode'), { statusCode: 400 });
    }
    const basePrice = await this.price(params);
    const terms = pricingMode === 'net-before-vat'
      ? { distributorDiscount: 0, vatRate: this.vatRate }
      : await this.accountTerms();
    const productDiscount = decimalFraction(options.productDiscount || 0);
    const subtotal = basePrice * (1 - terms.distributorDiscount) * (1 - productDiscount);
    const total = Math.round(subtotal * (1 + terms.vatRate) * 100) / 100;
    return {
      basePrice,
      distributorDiscount: terms.distributorDiscount,
      productDiscount,
      pricingMode,
      subtotal: Math.round(subtotal * 100) / 100,
      vatRate: terms.vatRate,
      total
    };
  }
}

module.exports = Object.freeze({ PentagramaPricing, decimalFraction });
