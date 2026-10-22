/**
 * Analytics routes: descriptive methods over historical fire-occurrence records.
 *
 * All endpoints accept the same body shape:
 *   { records: [ ...ESRI attribute objects... ] }   // or
 *   { features: [ { attributes: {...} }, ... ] }      // or
 *   [ ...ESRI attribute objects... ]
 */

import express from 'express';
import { normalizeMany } from '../schema/record.js';
import {
  summarize,
  seasonality,
  causeAttribution,
  sizeClassDistribution,
  containmentPerformance,
  fireReturnInterval,
  exposurePrioritization,
} from '../lib/analytics.js';

export const analyticsRouter = express.Router();

function load(req, res) {
  const records = normalizeMany(req.body);
  if (!records.length) {
    res.status(400).json({
      error: 'No records found. Provide {records:[...]}, {features:[...]}, or a raw array of ESRI attribute objects.',
    });
    return null;
  }
  return records;
}

analyticsRouter.post('/summary', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  res.json(summarize(recs));
});

analyticsRouter.post('/seasonality', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  res.json(seasonality(recs));
});

analyticsRouter.post('/cause-attribution', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  const byRegime = req.query.byRegime !== 'false';
  res.json(causeAttribution(recs, { byRegime }));
});

analyticsRouter.post('/size-class', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  res.json(sizeClassDistribution(recs));
});

analyticsRouter.post('/containment', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  res.json(containmentPerformance(recs));
});

analyticsRouter.post('/fire-return-interval', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  try {
    const grouping = req.query.groupBy || 'county';
    const gridDeg = req.query.gridDeg ? Number(req.query.gridDeg) : 0.1;
    res.json(fireReturnInterval(recs, grouping, gridDeg));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

analyticsRouter.post('/exposure', (req, res) => {
  const recs = load(req, res);
  if (!recs) return;
  try {
    const grouping = req.query.groupBy || 'region';
    const gridDeg = req.query.gridDeg ? Number(req.query.gridDeg) : 0.1;
    res.json(exposurePrioritization(recs, grouping, gridDeg));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
