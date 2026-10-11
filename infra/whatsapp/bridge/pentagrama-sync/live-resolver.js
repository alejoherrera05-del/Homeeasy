'use strict';

const { decimalFraction } = require('./pricing');
const liveInventory = require('./enrollables-live-products.json');
const certificationRegistry = require('./certification/catalog-certifications.json');

const SUPPORTED_PRODUCTS = Object.freeze(Object.fromEntries(
  Object.entries(liveInventory.products || {}).map(([id, product]) => [id, Object.freeze({ ...product, categories: Object.freeze({ ...product.categories }) })])
));
const CERTIFIED_FALLBACKS = new Set((certificationRegistry.products || [])
  .filter(product => product.status === 'CERTIFIED')
  .map(product => product.homeeasyId));

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
    const name = String(item && (item.FriendlyName ?? item.friendlyName ?? item.Name ?? item.name ?? item.AttributeName ?? item.attributeName) || '').trim().toLowerCase();
    const value = String(item && (item.DefaultValue ?? item.defaultValue ?? item.Value ?? item.value) || '').trim();
    if (name && value) out[name] = value;
  });
  return out;
}

function hasAttributeField(html, id) {
  const escaped = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<select\\b[^>]*\\bid=["']${escaped}["']`, 'i').test(String(html || ''));
}

function attributeOption(html, selectId, labelPattern) {
  const source = String(html || '');
  const escaped = String(selectId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const select = source.match(new RegExp(`<select\\b([^>]*)\\bid=["']${escaped}["']([^>]*)>([\\s\\S]*?)<\\/select>`, 'i'));
  if (!select) return null;
  const selectAttributes = `${select[1]} ${select[2]}`;
  const idAttribute = (selectAttributes.match(/\bidattribute=["']([^"']*)["']/i) || [])[1] || '';
  for (const option of select[3].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const label = option[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!labelPattern.test(label)) continue;
    const attrs = option[1];
    const value = (attrs.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '';
    const itemCode = (attrs.match(/\bitemcode=["']([^"']*)["']/i) || [])[1] || '';
    const calculationType = (attrs.match(/\bcalculationtype=["']([^"']*)["']/i) || [])[1] || '';
    const idAttributeValue = (attrs.match(/\bidattributevalues=["']([^"']*)["']/i) || [])[1] || '';
    return value && itemCode && calculationType && idAttributeValue && idAttribute
      ? { idAttribute, idAttributeValue, value, itemCode, calculationType, label }
      : null;
  }
  return null;
}

function fixedAmount(data) {
  const number = typeof data === 'number' ? data : Number(data && (data.Price ?? data.price ?? data.Value ?? data.value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function orientationFor(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return { code: '', id: '', label: '' };
  if (code === 'NAN') return { code, id: 'not_manufacturable', label: 'No fabricable' };
  if (code === 'TANSG') return { code, id: 'atravesada_y_anadida_sin_garantia', label: 'Atravesada y añadida sin garantía' };
  if (code === 'TATSG') return { code, id: 'atravesada_sin_garantia', label: 'Atravesada sin garantía' };
  if (code === 'TAN') return { code, id: 'atravesada_y_anadida', label: 'Atravesada y añadida' };
  if (code === 'TAT') return { code, id: 'atravesada', label: 'Atravesada' };
  if (code === 'DIN') return { code, id: 'normal', label: 'Normal' };
  return { code, id: code.toLowerCase(), label: code };
}

function unresolved(reason, details = {}) {
  return {
    ok: false,
    outcome: 'CONFIGURATION_UNRESOLVED',
    code: 'PENTAGRAMA_CONFIGURATION_UNRESOLVED',
    reason,
    ...details,
    fallback: { allowed: false }
  };
}

function fallbackFor(homeeasyId) {
  const allowed = CERTIFIED_FALLBACKS.has(homeeasyId);
  return { allowed, reason: allowed ? 'HomeEasy local mapping is CERTIFIED' : 'HomeEasy local mapping is not CERTIFIED' };
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
      const homeeasyId = String(input.homeeasyId || input.product || '').trim();
      return { ok: false, outcome: 'UNSUPPORTED', code: 'PENTAGRAMA_LIVE_PRODUCT_UNSUPPORTED', fallback: fallbackFor(homeeasyId) };
    }
    const width = requiredNumber(input.width, 'width');
    const height = requiredNumber(input.height, 'height');
    const quantity = Math.trunc(requiredNumber(input.quantity === undefined ? 1 : input.quantity, 'quantity', 1));
    const priceParams = {
      ProductCode: product.productCode, Quantity: quantity, Width: width, Height: height,
      GroupCode: product.groupCode, calculationType: product.calculationType,
      Degrees: '', Panels: 0, Cabezal: '', ItemCodeFather: '', AssociationGroup: product.associationGroup
    };
    const requestedConfiguration = String(input.configuration || 'standard').trim().toLowerCase();

    // Mirrors the portal flow: render the available attributes, validate alerts,
    // request both product price paths, then resolve SAP defaults for the entered size.
    const attributes = await this.catalog.attributes({
      ProductCode: product.productCode,
      Group: product.associationGroup,
      GroupCode: product.groupCode,
      LineNumber: '',
      PrimaryGroup: product.primaryGroup,
      Discount: product.discount,
      CalculationType: product.calculationType,
      Modified: ''
    });
    await this.catalog.alerts({
      code: product.productCode,
      AsosiationGroup: product.associationGroup,
      ancho: width,
      alto: height,
      Cat1: product.categories.Cat1,
      Cat2: product.categories.Cat2,
      Cat3: product.categories.Cat3,
      Cat4: product.categories.Cat4,
      Cat5: product.categories.Cat5,
      product: false,
      attribute: []
    });
    if (!hasAttributeField(attributes, 'direccion-de-la-tela') || !hasAttributeField(attributes, 'mecanismo')) {
      return unresolved('Pentagrama did not expose the manufacturing attribute selectors');
    }

    const fixed = fixedAmount(await this.catalog.fixedPrice({ Code: product.productCode, cantidad: quantity, ancho: width, alto: height }));
    const quoted = await this.pricing.supplierCost(priceParams, {
      pricingMode: 'account-discount',
      productDiscount: product.discount,
      AssociationGroup: product.associationGroup
    });
    const defaults = defaultMap(await this.catalog.defaults({
      ProductCode: product.productCode, Quantity: quantity, Width: width, Height: height,
      Group: product.associationGroup, PrimaryGroup: product.primaryGroup
    }));
    const orientation = orientationFor(defaults['direccion-de-la-tela']);
    const mechanism = String(defaults.mecanismo || '').trim().toUpperCase();
    if (!orientation.code || !mechanism) {
      return unresolved('Pentagrama did not resolve Dirección de la tela and Mecanismo');
    }
    if (orientation.code === 'NAN') {
      return { ok: false, outcome: 'NOT_MANUFACTURABLE', code: 'PENTAGRAMA_NOT_MANUFACTURABLE', reason: 'Pentagrama explicitly returned a non-manufacturable direction', fallback: { allowed: false } };
    }

    const head = String(defaults.cabezal || defaults['tipo-de-cabezal'] || product.head || '').trim().toUpperCase();
    const validation = await this.catalog.validateRoller({
      codigoProducto: product.productCode,
      ancho: width,
      alto: height,
      cabezal: head,
      mecanismo: mechanism,
      cenefa: String(defaults.tipocenefa || defaults['tipo-de-cenefa'] || '').trim(),
      motor: String(defaults.motor || '').trim()
    });
    if (!validation || Number(validation.codigo) !== 100) {
      return unresolved('Pentagrama did not complete Enrollable manufacturing validation');
    }
    if (Number(validation.altMaxEnrollable) !== 1) {
      return {
        ok: false,
        outcome: 'NOT_MANUFACTURABLE',
        code: 'PENTAGRAMA_NOT_MANUFACTURABLE',
        reason: String(validation.mensajeAlerta || 'Pentagrama rejected the resolved Enrollable configuration'),
        validation: { code: validation.codigo, message: String(validation.mensajeAlerta || '') },
        fallback: { allowed: false }
      };
    }

    const base = fixed > 0
      ? { basePrice: fixed, distributorDiscount: 0, productDiscount: 0, pricingMode: 'fixed-price', subtotal: fixed, vatRate: this.vatRate, total: roundMoney(fixed * (1 + this.vatRate)) }
      : quoted;

    let configuredHead = null;
    if (requestedConfiguration.includes('penta13')) {
      configuredHead = attributeOption(attributes, 'cenefa', /^PENTA\s*13\b/i);
      if (!configuredHead) return unresolved('Pentagrama did not expose a Penta13 option for this product');
      const dependency = await this.catalog.dependencies({
        idAttribute: configuredHead.idAttribute,
        idValueSelected: configuredHead.value,
        productCode: product.productCode,
        idAttributeValue: configuredHead.idAttributeValue
      });
      if (!dependency || Number(dependency.codigo) !== 100) {
        return unresolved('Pentagrama did not resolve the Penta13 dependencies');
      }
    }

    const selectedComplements = [];
    if (input.coverlight) selectedComplements.push(String(input.coverlight));
    if (Array.isArray(input.addons)) selectedComplements.push(...input.addons.map(String));
    let complementsSubtotal = 0;
    const complements = [];
    if (configuredHead) {
      const cost = await this.pricing.supplierCost({
        ProductCode: configuredHead.itemCode,
        Quantity: quantity,
        Width: width,
        Height: height,
        calculationType: configuredHead.calculationType,
        Degrees: '',
        Panels: 0,
        Cabezal: '',
        ItemCodeFather: product.productCode,
        AssociationGroup: product.associationGroup
      }, { pricingMode: 'account-discount', AssociationGroup: product.associationGroup });
      complementsSubtotal += cost.subtotal;
      complements.push({ id: 'penta13', productCode: configuredHead.itemCode, subtotal: cost.subtotal, total: cost.total });
    }
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
      configuration: { orientation: orientation.id, orientationCode: orientation.code, mechanism, system: product.system, head: configuredHead ? configuredHead.label : head },
      fabrication: {
        supported: true,
        orientation: orientation.id,
        mechanism,
        requiresAuthorization: orientation.code === 'TAN' || orientation.code.endsWith('SG'),
        warranty: orientation.code !== 'TAN' && !orientation.code.endsWith('SG')
      },
      pricing: { ...base, complements, subtotal, vatRate: this.vatRate, total },
      alternative: alternative ? { id: orientation.id, label: orientation.label, mechanism, requiresConfirmedCost: false } : null,
      fallback: fallbackFor(product.homeeasyId)
    };
  }
}

module.exports = Object.freeze({ PentagramaLiveResolver, SUPPORTED_PRODUCTS, CERTIFIED_FALLBACKS, COMPLEMENTS, attributeOption, defaultMap, fixedAmount, hasAttributeField, orientationFor });
