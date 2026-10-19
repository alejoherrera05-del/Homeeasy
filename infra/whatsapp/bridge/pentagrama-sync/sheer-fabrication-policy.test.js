'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCE,
  SYSTEMS,
  findConfiguration,
  supports,
  selectedOptionValue,
  productionSignatures
} = require('./certification/sheer-fabrication-policy');

test('Sheer documented Standard matrix enforces the Pentagrama limits', () => {
  assert.equal(SOURCE.document, '581_FichaSheerElegance.pdf');
  assert.equal(findConfiguration('standard', 1.0, 1.3).mechanism, 'R8/VTX10');
  assert.equal(findConfiguration('standard', 1.6, 1.8).tubeDiameterMm, 32);
  assert.equal(findConfiguration('standard', 2.4, 1.2).mechanism, 'R8');
  assert.equal(findConfiguration('standard', 2.6, 1.2).tubeDiameterMm, 38);
  assert.equal(supports('standard', 1.7, 1.8), false);
  assert.equal(supports('standard', 2.6, 1.3), false);
  assert.equal(supports('standard', 2.7, 1.0), false);
});

test('Sheer documented Binovo matrix keeps its three mechanism envelopes', () => {
  assert.equal(findConfiguration('binovo', 1.7, 2.6).mechanism, 'VTX10 / CLIC S');
  assert.equal(findConfiguration('binovo', 2.6, 3.0).mechanism, 'VTX15 / CLIC M');
  assert.equal(findConfiguration('binovo', 3.0, 2.2).mechanism, 'VTX20 / CLIC M');
  assert.equal(supports('binovo', 3.0, 2.3), false);
});

test('Sheer head selection is read from the option actually selected by Pentagrama', () => {
  const html = '<select id="cabezal" idAttribute="5244"><option value="">-- seleccione --</option><option value="STD" selected>Standard</option></select>';
  assert.equal(selectedOptionValue(html, 'cabezal'), 'STD');
  assert.equal(selectedOptionValue(html, 'motor'), '');
});

test('fabrication policy exposes every production signature used by the audit guard', () => {
  const signatures = productionSignatures();
  assert.equal(signatures.length, 5);
  assert.ok(signatures.some(item => item.tuple === 'maxWidthM:1.6,maxHeightM:1.8'));
  assert.ok(signatures.some(item => item.tuple === 'maxWidthM:3,maxHeightM:2.2'));
  assert.equal(SYSTEMS.standard.headCode, 'STD');
});
