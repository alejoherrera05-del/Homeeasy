'use strict';

const structuralProfiles = require('./enrollables-structural-profiles.json');

const BANDS = Object.freeze({
  STANDARD: Object.freeze([
    Object.freeze({ maxWidthMm: 1600, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 3200, maxHeightMm: 3100, mechanism: 'M05' })
  ]),
  GROUP_5: Object.freeze([
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 3500, mechanism: 'M05' }),
    Object.freeze({ maxWidthMm: 1900, maxHeightMm: 3200, mechanism: 'M05' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 2800, mechanism: 'M05' })
  ]),
  GROUP_5B: Object.freeze([
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 3500, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 1900, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M08' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 2800, mechanism: 'M08' })
  ]),
  MIMO_5B: Object.freeze([
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 3500, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 1900, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 2800, mechanism: 'M05' })
  ]),
  LONA_CRISTAL: Object.freeze([
    Object.freeze({ maxWidthMm: 1370, maxHeightMm: 3500, mechanism: 'M05' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 3500, mechanism: 'M08' })
  ])
});

function portalProfile(definition) {
  if (!definition) return null;
  const bands = BANDS[definition.mechanismProfile];
  if (!bands) return null;
  return {
    id: definition.id,
    source: structuralProfiles.source,
    verifiedAt: structuralProfiles.verifiedAt,
    casesPassed: Number(definition.casesPassed || 4),
    maxDifference: 0,
    sizeGroup: definition.sizeGroup,
    rollWidthMm: Number(definition.rollWidthMm),
    canRotate: true,
    rotateAtRollWidth: Boolean(definition.rotateAtRollWidth),
    orientationAcrossCode: String(definition.orientationAcrossCode || 'TAT'),
    orientationAddedCode: String(definition.orientationAddedCode || 'TAN'),
    mechanismBands: [
      ...bands.map(item => ({ ...item })),
      ...(Number(definition.maxM08WidthMm) > 0
        ? [{ maxWidthMm: Number(definition.maxM08WidthMm), maxHeightMm: 3500, mechanism: 'M08' }]
        : []),
      { maxWidthMm: null, maxHeightMm: null, mechanism: 'NA' }
    ]
  };
}

function profileForProduct(product) {
  if (product && product.fabricationProfile && Array.isArray(product.fabricationProfile.mechanismBands)) return product.fabricationProfile;
  return portalProfile(structuralProfiles.profiles && structuralProfiles.profiles[product && product.homeeasyId]);
}

function resolveFabrication(profile, width, height) {
  if (!profile || !Array.isArray(profile.mechanismBands)) return null;
  const widthMm = Number(width) * 1000;
  const heightMm = Number(height) * 1000;
  const rollWidth = Number(profile.rollWidthMm || 0);
  let orientationCode = 'DIN';
  const crossesRoll = rollWidth && (profile.rotateAtRollWidth ? widthMm >= rollWidth : widthMm > rollWidth);
  if (crossesRoll) orientationCode = heightMm <= rollWidth
    ? String(profile.orientationAcrossCode || 'TAT')
    : String(profile.orientationAddedCode || 'TAN');
  const band = profile.mechanismBands.find(item =>
    (!Number(item.maxWidthMm) || widthMm <= Number(item.maxWidthMm)) &&
    (!Number(item.maxHeightMm) || heightMm <= Number(item.maxHeightMm))
  );
  const mechanism = String(band && band.mechanism || '');
  if (!mechanism || mechanism === 'NA') return { outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '' };
  return {
    outcome: orientationCode === 'DIN' ? 'PRICE' : 'ALTERNATIVE',
    orientationCode,
    mechanism,
    requiresAuthorization: orientationCode.startsWith('TAN') || orientationCode.endsWith('SG'),
    warranty: !orientationCode.startsWith('TAN') && !orientationCode.endsWith('SG')
  };
}

module.exports = Object.freeze({ BANDS, portalProfile, profileForProduct, resolveFabrication });
