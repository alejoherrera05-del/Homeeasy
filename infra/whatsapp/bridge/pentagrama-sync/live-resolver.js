'use strict';

const { decimalFraction } = require('./pricing');

const SUPPORTED_PRODUCTS = Object.freeze({
  'enrollable-blackout-matte3': Object.freeze({
    homeeasyId: 'enrollable-blackout-matte3',
    family: 'Enrollable',
    reference: 'Matte 3',
    productCode: 'ENRSTDBOMA3090',
    groupCode: '599',
    associationGroup: 'ENRSTD',
    calculationType: 'NormalProduct',
    discount: 0,
    categories: Object.freeze({ Cat1: '4', Cat2: '79', Cat3: '8', Cat4: '118', Cat5: '24' })
  })
});

const COMPLEMENTS = Object.freeze({
  'coverlight-standard': Object.freeze({ productCode: 'KITPERCOLIBLA', groupCode: '616', calculationType: 'DimensionsHeight' }),
  'coverlight-plus': Object.freeze({ productCode: 'KITPERCOLIPLUBLA', groupCode: '616', calculationType: 'DimensionsHeight' }),
  'coverlight-advance': Object.freeze({ productCode: 'KITPERCOLIADVBLA', groupCode: '616', calculationType: 'DimensionsHeight' }),
  'coverlight-single': Object.freeze({ productCode: 'KITPERCOLISINBLA', groupCode: '616', calculationType: 'DimensionsHeight' })
});

function requiredNumber(value, name, minimum = 0.001) {
  const number = Number(String(value === undefined ? '' : value).replace(',', '.'));
  if (!Number.isFinite(number) || number < minimum) {
    throw Object.assign(new Error(`${name} must be a number greater than or equal to ${minimum}`), { statusCode: 400, code: 'LIVE_PRICE_INVALID_INPUT' });
  }
  return number;
}

function roundMoney(value) { return Math.round(Number(value || 0) * 100) / 100; }

function defaultMap(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data && data.Data) ? data.Data : [];
  const out = {};
  list.forEach(item => {
    const name = String(item && (item.Name ?? item.name ?? item.AttributeName ?? item.attributeName) || '').trim().toLowerCase();
    const value = String(item && (item.DefaultValue ?? item.defaultValue ?? item.Value ?? item.value) || '').trim();
    if (name && value) out[name] = value;
  });
  return out;
}

function fixedAmount(data) {
  const number = typeof data === 'number' ? data : Number(data && (data.Price ?? data.price ?? data.Value ?? data.value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function orientationFor(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'TAN') return { code, id: 'atravesada_y_anadida', label: 'Atravesada y añadida' };
  if (code === 'TAT') return { code, id: 'atravesada', label: 'Atravesada' };
  return { code: code || 'DIN', id: 'normal', label: 'Normal' };
}

class PentagramaLiveResolver {
  constructor({ catalog, pricing, vatRate = 0.19 } = {}) {
    this.catalog = catalog;
    this.pricing = pricing;
    this.vatRate = decimalFraction(vatRate);
  }

  async resolve(input = {}) {
    const product = SUPPORTED_PRODUCTS[String(input.homeeasyId || input.product || '').trim()];
    if (!product) {
      return { ok: false, outcome: 'UNSUPPORTED', code: 'PENTAGRAMA_LIVE_PRODUCT_UNSUPPORTED', fallback: { allowed: false, reason: 'Product has no live resolver mapping' } };
    }
    const width = requiredNumber(input.width, 'width');
    const height = requiredNumber(input.height, 'height');
    const quantity = Math.trunc(requiredNumber(input.quantity === undefined ? 1 : input.quantity, 'quantity', 1));
    const priceParams = {
      ProductCode: product.productCode, Quantity: quantity, Width: width, Height: height,
      GroupCode: product.groupCode, calculationType: product.calculationType,
      Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '', AssociationGroup: product.associationGroup
    };
    const defaults = defaultMap(await this.catalog.defaults({
      ProductCode: product.productCode, Quantity: quantity, Width: width, Height: height,
      Group: product.associationGroup, PrimaryGroup: product.groupCode
    }));
    const orientation = orientationFor(defaults['direccion-de-la-tela']);
    const mechanism = String(defaults.mecanismo || '').trim().toUpperCase();
    if (!orientation.code || !mechanism) {
      return { ok: false, outcome: 'NOT_MANUFACTURABLE', code: 'PENTAGRAMA_NOT_MANUFACTURABLE', reason: 'Pentagrama did not return a valid manufacturing configuration', fallback: { allowed: false } };
    }

    const fixed = fixedAmount(await this.catalog.fixedPrice({ Code: product.productCode, cantidad: quantity, ancho: width, alto: height }));
    const base = fixed > 0
      ? { basePrice: fixed, distributorDiscount: 0, productDiscount: 0, pricingMode: 'fixed-price', subtotal: fixed, vatRate: this.vatRate, total: roundMoney(fixed * (1 + this.vatRate)) }
      : await this.pricing.supplierCost(priceParams, { pricingMode: 'account-discount', productDiscount: product.discount, AssociationGroup: product.associationGroup });

    const selectedComplements = [];
    if (input.coverlight) selectedComplements.push(String(input.coverlight));
    if (Array.isArray(input.addons)) selectedComplements.push(...input.addons.map(String));
    let complementsSubtotal = 0;
    const complements = [];
    for (const id of selectedComplements) {
      const complement = COMPLEMENTS[id];
      if (!complement) {
        return { ok: false, outcome: 'UNSUPPORTED', code: 'PENTAGRAMA_LIVE_COMPLEMENT_UNSUPPORTED', reason: `Complement ${id} is not mapped`, fallback: { allowed: false } };
      }
      const cost = await this.pricing.supplierCost({
        ProductCode: complement.productCode, Quantity: quantity, Width: width, Height: height,
        GroupCode: complement.groupCode, calculationType: complement.calculationType,
        Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: product.productCode, AssociationGroup: product.associationGroup
      }, { pricingMode: 'account-discount', AssociationGroup: product.associationGroup });
      complementsSubtotal += cost.subtotal;
      complements.push({ id, productCode: complement.productCode, subtotal: cost.subtotal, total: cost.total });
    }

    const subtotal = roundMoney(base.subtotal + complementsSubtotal);
    const total = roundMoney(subtotal * (1 + this.vatRate));
    const alternative = orientation.code !== 'DIN';
    return {
      ok: true,
      outcome: alternative ? 'ALTERNATIVE' : 'PRICE',
      source: 'pentagrama-live',
      checkedAt: new Date().toISOString(),
      product: { homeeasyId: product.homeeasyId, productCode: product.productCode, groupCode: product.groupCode, reference: product.reference },
      request: { width, height, quantity },
      configuration: { orientation: orientation.id, orientationCode: orientation.code, mechanism },
      fabrication: {
        supported: true,
        orientation: orientation.id,
        mechanism,
        requiresAuthorization: orientation.code === 'TAN',
        warranty: orientation.code !== 'TAN'
      },
      pricing: { ...base, complements, subtotal, vatRate: this.vatRate, total },
      alternative: alternative ? { id: orientation.id, label: orientation.label, mechanism, requiresConfirmedCost: false } : null,
      fallback: { allowed: false, reason: 'Matte 3 local mapping is not CERTIFIED' }
    };
  }
}

module.exports = Object.freeze({ PentagramaLiveResolver, SUPPORTED_PRODUCTS, COMPLEMENTS, defaultMap, fixedAmount });
