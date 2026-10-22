import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rothermelSpread, byramIntensity, vanWagnerCrownInit, nfdrsBurningIndex } from '../src/lib/fireBehavior.js';
import { sizeClass } from '../src/lib/analytics.js';
import { classifyRegime } from '../src/lib/regime.js';

test('rothermel: no wind/slope gives a positive, finite spread rate', () => {
  const r = rothermelSpread({ fuelModel: 'FM10', dead1hMoisture: 0.06 });
  assert.ok(r.rateOfSpread_ft_min > 0, 'spread should be positive');
  assert.ok(Number.isFinite(r.reactionIntensity_BTU_ft2_min));
});

test('rothermel: wind increases rate of spread', () => {
  const calm = rothermelSpread({ fuelModel: 'FM2', dead1hMoisture: 0.06, windSpeed: 0 });
  const windy = rothermelSpread({ fuelModel: 'FM2', dead1hMoisture: 0.06, windSpeed: 10 });
  assert.ok(windy.rateOfSpread_ft_min > calm.rateOfSpread_ft_min);
  assert.ok(windy.windFactor > 0);
});

test('rothermel: wetter fuel slows or stops spread', () => {
  const dry = rothermelSpread({ fuelModel: 'FM2', dead1hMoisture: 0.04 });
  const wet = rothermelSpread({ fuelModel: 'FM2', dead1hMoisture: 0.14 });
  assert.ok(wet.rateOfSpread_ft_min < dry.rateOfSpread_ft_min);
});

test('byram: flame length rises with intensity', () => {
  const low = byramIntensity({ reactionIntensity: 2000, rateOfSpread: 2, sigma: 2000 });
  const high = byramIntensity({ reactionIntensity: 6000, rateOfSpread: 10, sigma: 2000 });
  assert.ok(high.flameLength_ft > low.flameLength_ft);
  assert.ok(high.firelineIntensity_kW_m > low.firelineIntensity_kW_m);
});

test('vanWagner: higher surface intensity triggers crown fire', () => {
  const r = vanWagnerCrownInit({ canopyBaseHeight_m: 2, foliarMoisturePct: 100, surfaceIntensity_kW_m: 5000 });
  assert.equal(r.crownFireInitiates, true);
  const r2 = vanWagnerCrownInit({ canopyBaseHeight_m: 10, foliarMoisturePct: 120, surfaceIntensity_kW_m: 100 });
  assert.equal(r2.crownFireInitiates, false);
});

test('nfdrs: burning index is a non-negative integer', () => {
  const r = nfdrsBurningIndex({ spreadComponent: 40, energyReleaseComponent: 60 });
  assert.ok(Number.isInteger(r.burningIndex));
  assert.ok(r.burningIndex >= 0);
});

test('sizeClass maps acres to NWCG classes', () => {
  assert.equal(sizeClass(0.1), 'A');
  assert.equal(sizeClass(5), 'B');
  assert.equal(sizeClass(50), 'C');
  assert.equal(sizeClass(6000), 'G');
});

test('regime: east vs west classification by region and longitude', () => {
  assert.equal(classifyRegime({ region: 'Northeast' }), 'east');
  assert.equal(classifyRegime({ region: 'Pacific Cascade' }), 'west');
  assert.equal(classifyRegime({ region: null, lon: -122.5 }), 'west');
  assert.equal(classifyRegime({ region: null, lon: -119.0 }), 'east');
});
