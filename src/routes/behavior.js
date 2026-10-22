/**
 * Fire-behavior routes: physics models (Rothermel, Byram, Van Wagner, NFDRS).
 *
 * These require environmental inputs the historical schema lacks (wind, fuel
 * moisture, fuel model, canopy structure), so they operate in scenario mode.
 * An optional `record` (raw ESRI attributes) can be supplied to seed slope from
 * terrain or elevation context; the behavior inputs themselves must be given.
 */

import express from 'express';
import { normalizeRecord } from '../schema/record.js';
import {
  rothermelSpread,
  byramIntensity,
  vanWagnerCrownInit,
  nfdrsBurningIndex,
  ercProxy,
} from '../lib/fireBehavior.js';
import { getFuelModel, FUEL_MODELS } from '../lib/fuelModels.js';

export const behaviorRouter = express.Router();

/** List available fuel models. */
behaviorRouter.get('/fuel-models', (_req, res) => {
  res.json(Object.values(FUEL_MODELS));
});

/** Rothermel surface rate of spread. */
behaviorRouter.post('/rothermel', (req, res) => {
  try {
    const { fuelModel, dead1hMoisture, windSpeed, slope } = req.body || {};
    res.json(rothermelSpread({ fuelModel, dead1hMoisture, windSpeed, slope }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Byram fireline intensity + flame length (from explicit inputs). */
behaviorRouter.post('/byram', (req, res) => {
  try {
    const { reactionIntensity, rateOfSpread, sigma } = req.body || {};
    if (reactionIntensity == null || rateOfSpread == null || sigma == null) {
      throw new Error('reactionIntensity, rateOfSpread, and sigma are required');
    }
    res.json(byramIntensity({ reactionIntensity, rateOfSpread, sigma }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Van Wagner crown-fire initiation threshold. */
behaviorRouter.post('/crown-init', (req, res) => {
  try {
    const { canopyBaseHeight_m, foliarMoisturePct, surfaceIntensity_kW_m } = req.body || {};
    res.json(
      vanWagnerCrownInit({ canopyBaseHeight_m, foliarMoisturePct, surfaceIntensity_kW_m })
    );
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** NFDRS Burning Index from spread + energy release components. */
behaviorRouter.post('/nfdrs/burning-index', (req, res) => {
  try {
    const { spreadComponent, energyReleaseComponent } = req.body || {};
    res.json(nfdrsBurningIndex({ spreadComponent, energyReleaseComponent }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Full behavior scenario: Rothermel -> Byram -> Van Wagner + ERC proxy in one
 * call. This is the primary "apply the models" endpoint. It optionally accepts
 * a `record` to associate the result with a historical fire event.
 */
behaviorRouter.post('/scenario', (req, res) => {
  try {
    const {
      fuelModel,
      dead1hMoisture,
      windSpeed = 0,
      slope = 0,
      canopyBaseHeight_m,
      foliarMoisturePct = 100,
      record,
    } = req.body || {};

    const fm = getFuelModel(fuelModel);
    const spread = rothermelSpread({ fuelModel, dead1hMoisture, windSpeed, slope });
    const intensity = byramIntensity({
      reactionIntensity: spread.reactionIntensity_BTU_ft2_min,
      rateOfSpread: spread.rateOfSpread_ft_min,
      sigma: fm.sigma,
    });

    let crown = null;
    if (canopyBaseHeight_m != null) {
      crown = vanWagnerCrownInit({
        canopyBaseHeight_m,
        foliarMoisturePct,
        surfaceIntensity_kW_m: intensity.firelineIntensity_kW_m,
      });
    }

    const erc = ercProxy({
      reactionIntensity: spread.reactionIntensity_BTU_ft2_min,
      sigma: fm.sigma,
    });

    const response = { spread, intensity, crown, ercProxy: erc };

    if (record) {
      const r = normalizeRecord(record);
      response.record = {
        id: r.id,
        incidentName: r.incidentName,
        county: r.county,
        region: r.region,
        elevationFt: r.elevationFt,
        acresBurned: r.acresBurned,
      };
    }

    res.json(response);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
