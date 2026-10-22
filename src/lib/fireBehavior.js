/**
 * Quantitative fire-behavior models.
 *
 *  - Rothermel (1972) surface fire spread
 *  - Byram (1959) fireline intensity and flame length
 *  - Van Wagner (1977) crown-fire initiation threshold
 *  - NFDRS-style Energy Release Component / Burning Index helpers
 *
 * These are physics models that need weather + fuel-moisture inputs the
 * historical fire-occurrence schema does NOT contain. They are therefore
 * "scenario" calculators: the caller supplies the environmental inputs, and
 * may seed slope/elevation from a record.
 *
 * References: Rothermel 1972 (INT-115); Albini 1976; Byram 1959;
 * Van Wagner 1977; Andrews 2018 (BehavePlus); Cohen & Deeming 1985 (NFDRS).
 */

import { getFuelModel } from './fuelModels.js';

/**
 * Rothermel surface rate of spread.
 *
 * R = I_R * xi * (1 + phi_w + phi_s) / (rho_b * eps * Q_ig)
 *
 * @param {object} opts
 * @param {string} opts.fuelModel     fuel model key (e.g. "FM10")
 * @param {number} opts.dead1hMoisture fraction (e.g. 0.06 for 6%)
 * @param {number} [opts.windSpeed]   midflame wind speed, mi/h (default 0)
 * @param {number} [opts.slope]       slope steepness, fraction rise/run (default 0)
 * @returns {object} spread results in both English and SI-ish units
 */
export function rothermelSpread({ fuelModel, dead1hMoisture, windSpeed = 0, slope = 0 }) {
  if (dead1hMoisture == null || Number.isNaN(dead1hMoisture)) {
    throw new Error('dead1hMoisture (fraction) is required');
  }
  const fm = getFuelModel(fuelModel);

  const { w0, sigma, depth, mx, h, rhoP } = fm;
  const Mf = dead1hMoisture;

  // Net fuel load (assume no mineral/moisture correction beyond standard total
  // mineral content ST=0.0555, effective mineral SE=0.01).
  const ST = 0.0555;
  const SE = 0.01;
  const wn = w0 * (1 - ST); // net fuel load

  // Bulk density and packing ratio.
  const rhoB = w0 / depth; // oven-dry bulk density lb/ft^3
  const beta = rhoB / rhoP; // packing ratio
  const betaOpt = 3.348 * Math.pow(sigma, -0.8189); // optimum packing ratio
  const betaRatio = beta / betaOpt;

  // Maximum reaction velocity and optimum reaction velocity.
  const gammaMax = Math.pow(sigma, 1.5) / (495 + 0.0594 * Math.pow(sigma, 1.5));
  const A = 133 * Math.pow(sigma, -0.7913);
  const gammaPrime =
    gammaMax *
    Math.pow(betaRatio, A) *
    Math.exp(A * (1 - betaRatio));

  // Moisture damping coefficient.
  const rM = Math.min(Mf / mx, 1);
  const etaM = 1 - 2.59 * rM + 5.11 * rM * rM - 3.52 * rM * rM * rM;

  // Mineral damping coefficient.
  const etaS = Math.min(0.174 * Math.pow(SE, -0.19), 1);

  // Reaction intensity (BTU/ft^2/min).
  const IR = gammaPrime * wn * h * etaM * etaS;

  // Propagating flux ratio.
  const xi =
    Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) /
    (192 + 0.2595 * sigma);

  // Wind factor. windSpeed mi/h -> ft/min.
  const U = windSpeed * 88; // ft/min
  const C = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
  const B = 0.02526 * Math.pow(sigma, 0.54);
  const E = 0.715 * Math.exp(-3.59e-4 * sigma);
  const phiW =
    U > 0 ? C * Math.pow(U, B) * Math.pow(betaRatio, -E) : 0;

  // Slope factor.
  const phiS = slope > 0 ? 5.275 * Math.pow(beta, -0.3) * slope * slope : 0;

  // Heat sink.
  const epsilon = Math.exp(-138 / sigma); // effective heating number
  const Qig = 250 + 1116 * Mf; // heat of preignition BTU/lb
  const heatSink = rhoB * epsilon * Qig;

  // Rate of spread (ft/min).
  const R = (IR * xi * (1 + phiW + phiS)) / heatSink;

  return {
    fuelModel: fm.key,
    inputs: { dead1hMoisture: Mf, windSpeedMph: windSpeed, slope },
    reactionIntensity_BTU_ft2_min: round(IR),
    rateOfSpread_ft_min: round(R),
    rateOfSpread_chains_hr: round(R * (60 / 66)), // 1 chain = 66 ft
    rateOfSpread_m_min: round(R * 0.3048),
    windFactor: round(phiW),
    slopeFactor: round(phiS),
    packingRatio: round(beta, 5),
  };
}

/**
 * Byram fireline intensity and flame length.
 *
 *   I = H * w * R           (Byram 1959)   kW/m or BTU/ft/s depending on units
 *   L = 0.0775 * I^0.46     (Byram)        flame length (ft) from I in BTU/ft/s
 *
 * We compute Byram's intensity from reaction intensity and residence time, the
 * standard BehavePlus approach:
 *   I_B (BTU/ft/s) = I_R * R * t_r / 60, with residence time t_r = 384 / sigma (min).
 *
 * @param {object} opts
 * @param {number} opts.reactionIntensity BTU/ft^2/min (I_R from Rothermel)
 * @param {number} opts.rateOfSpread      ft/min (R from Rothermel)
 * @param {number} opts.sigma             surface-area-to-volume ratio (ft^-1)
 * @returns {object}
 */
export function byramIntensity({ reactionIntensity, rateOfSpread, sigma }) {
  const residenceTimeMin = 384 / sigma;
  // Heat per unit area (BTU/ft^2) then fireline intensity (BTU/ft/s).
  const heatPerArea = reactionIntensity * residenceTimeMin; // BTU/ft^2
  const R_ft_s = rateOfSpread / 60; // ft/min -> ft/s
  const I_B = heatPerArea * R_ft_s; // BTU/ft/s

  const flameLengthFt = 0.45 * Math.pow(I_B, 0.46); // Byram (English form)
  const I_B_kW_m = I_B * 3.46414; // BTU/ft/s -> kW/m

  return {
    firelineIntensity_BTU_ft_s: round(I_B),
    firelineIntensity_kW_m: round(I_B_kW_m),
    flameLength_ft: round(flameLengthFt),
    flameLength_m: round(flameLengthFt * 0.3048),
    residenceTime_min: round(residenceTimeMin, 3),
    interpretation: interpretFlameLength(flameLengthFt),
  };
}

/** Suppression-difficulty interpretation of flame length (Hauling Chart). */
function interpretFlameLength(ft) {
  if (ft < 4) return 'Direct attack by hand crews is generally feasible.';
  if (ft < 8) return 'Too intense for direct hand attack; equipment/aircraft needed.';
  if (ft < 11) return 'Serious control problems; crown fire and spotting likely.';
  return 'Crowning, spotting, major runs probable; control efforts at the head ineffective.';
}

/**
 * Van Wagner (1977) crown-fire initiation.
 *
 * Critical surface fireline intensity to initiate crowning:
 *   I_0 = (0.010 * CBH * (460 + 25.9 * FMC))^1.5    (kW/m)
 * where CBH = canopy base height (m) and FMC = foliar moisture content (%).
 *
 * @param {object} opts
 * @param {number} opts.canopyBaseHeight_m
 * @param {number} opts.foliarMoisturePct  e.g. 100 for 100%
 * @param {number} [opts.surfaceIntensity_kW_m] optional actual surface intensity to compare
 * @returns {object}
 */
export function vanWagnerCrownInit({
  canopyBaseHeight_m,
  foliarMoisturePct,
  surfaceIntensity_kW_m,
}) {
  if (canopyBaseHeight_m == null || foliarMoisturePct == null) {
    throw new Error('canopyBaseHeight_m and foliarMoisturePct are required');
  }
  const I0 = Math.pow(
    0.01 * canopyBaseHeight_m * (460 + 25.9 * foliarMoisturePct),
    1.5
  );

  const result = {
    criticalSurfaceIntensity_kW_m: round(I0),
    inputs: { canopyBaseHeight_m, foliarMoisturePct },
  };
  if (surfaceIntensity_kW_m != null) {
    result.surfaceIntensity_kW_m = round(surfaceIntensity_kW_m);
    result.crownFireInitiates = surfaceIntensity_kW_m >= I0;
  }
  return result;
}

/**
 * NFDRS-style helpers.
 *
 * Simplified Energy Release Component (ERC) proxy and Burning Index (BI).
 * Full NFDRS requires a calibrated fuel model and a moisture time series; this
 * provides the standard BI relationship from spread component and ERC, and a
 * transparent ERC proxy from available heat and dryness so the endpoint is
 * usable with the limited inputs at hand.
 *
 * BI = 0.301 * (SC * ERC)^0.46 * 10   (NFDRS, scaled to a 0-100+ index)
 *
 * @param {object} opts
 * @param {number} opts.spreadComponent  SC (unitless, ~ rate of spread based)
 * @param {number} opts.energyReleaseComponent ERC (unitless, ~ available energy)
 * @returns {object}
 */
export function nfdrsBurningIndex({ spreadComponent, energyReleaseComponent }) {
  if (spreadComponent == null || energyReleaseComponent == null) {
    throw new Error('spreadComponent and energyReleaseComponent are required');
  }
  const BI = Math.round(
    0.301 * Math.pow(spreadComponent * energyReleaseComponent, 0.46) * 10
  );
  // Flame length implied by BI (NFDRS: FL = BI / 10 feet).
  return {
    burningIndex: BI,
    impliedFlameLength_ft: round(BI / 10),
  };
}

/**
 * ERC proxy from reaction intensity (available energy) when the full NFDRS
 * pipeline is unavailable. ERC is defined as 0.04 * total heat release per unit
 * area; we approximate heat/area from Rothermel's reaction intensity and a
 * standard residence time.
 *
 * @param {object} opts
 * @param {number} opts.reactionIntensity BTU/ft^2/min
 * @param {number} opts.sigma            ft^-1
 * @returns {number} ERC proxy
 */
export function ercProxy({ reactionIntensity, sigma }) {
  const residenceTimeMin = 384 / sigma;
  const heatPerArea = reactionIntensity * residenceTimeMin; // BTU/ft^2
  return round(0.04 * heatPerArea);
}

function round(n, places = 2) {
  if (n == null || Number.isNaN(n)) return null;
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
