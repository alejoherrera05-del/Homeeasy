'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveMechanismBands,
  learnedMechanismBands,
  learnedMechanismBoundaryProbes
} = require('./local-model');

function ev(width, height, mechanism, outcome = 'PRICE') {
  return { width, height, mechanism, outcome };
}

test('learns a live width boundary that is not one of the historical Pentagrama templates', () => {
  const evidence = [
    ev(1.2, 2.2, 'M03'),
    ev(1.8, 2.2, 'M03'),
    ev(2.4, 2.2, 'M03'),
    ev(2.999, 2.2, 'M05'),
    ev(3.0, 2.2, 'M05'),
    ev(3.001, 2.2, 'M08', 'ALTERNATIVE'),
    ev(3.2, 2.2, 'M08', 'ALTERNATIVE')
  ];

  const learned = learnedMechanismBands(evidence);
  assert.ok(Array.isArray(learned) && learned.length >= 2);
  assert.equal(
    learned.find(item => item.mechanism === 'M05')?.maxWidthMm,
    3000
  );
});

test('requires direct edge probes before accepting a learned boundary', () => {
  const evidence = [
    ev(1.2, 2.2, 'M03'),
    ev(2.5, 2.2, 'M05'),
    ev(3.0, 2.2, 'M05'),
    ev(3.2, 2.2, 'M08', 'ALTERNATIVE')
  ];

  const learned = learnedMechanismBands(evidence);
  const probes = learnedMechanismBoundaryProbes(learned, evidence);
  assert.ok(probes.some(item => Math.round(item.width * 1000) === 3001));
});

test('derives learned live bands after the exact edge has been proven', () => {
  const evidence = [
    ev(1.0, 2.2, 'M03'),
    ev(1.8, 2.2, 'M03'),
    ev(2.399, 2.2, 'M03'),
    ev(2.4, 2.2, 'M03'),
    ev(2.401, 2.2, 'M05', 'ALTERNATIVE'),
    ev(3.0, 2.2, 'M05', 'ALTERNATIVE')
  ];

  const bands = deriveMechanismBands(evidence, null, 'live-custom');
  assert.equal(bands.find(item => item.mechanism === 'M03')?.maxWidthMm, 2400);
  assert.equal(bands.at(-1).mechanism, 'M05');
});
