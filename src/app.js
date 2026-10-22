import express from 'express';
import { analyticsRouter } from './routes/analytics.js';
import { behaviorRouter } from './routes/behavior.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Self-describing index of endpoints.
  app.get('/', (_req, res) => {
    res.json({
      name: 'WA Fire Analytics & Behavior API',
      description:
        'Descriptive analytics over historical WA DNR fire-occurrence records plus fire-behavior models (Rothermel, Byram, Van Wagner, NFDRS).',
      endpoints: {
        analytics: {
          'POST /analytics/summary': 'Overall summary + regime breakdown',
          'POST /analytics/seasonality': 'Monthly/seasonal ignition and area-burned distribution',
          'POST /analytics/cause-attribution?byRegime=true': 'Human/lightning/other cause split',
          'POST /analytics/size-class': 'NWCG size-class distribution + heavy-tail share',
          'POST /analytics/containment': 'Discovery->control->out durations, growth rate',
          'POST /analytics/fire-return-interval?groupBy=county|region|grid&gridDeg=0.1': 'Burn frequency and mean return interval',
          'POST /analytics/exposure?groupBy=region|county|grid': 'Expected-value style prioritization',
        },
        behavior: {
          'GET /behavior/fuel-models': 'List available surface fuel models',
          'POST /behavior/rothermel': 'Surface rate of spread',
          'POST /behavior/byram': 'Fireline intensity + flame length',
          'POST /behavior/crown-init': 'Van Wagner crown-fire initiation threshold',
          'POST /behavior/nfdrs/burning-index': 'NFDRS Burning Index',
          'POST /behavior/scenario': 'Full chained scenario (primary model endpoint)',
        },
      },
    });
  });

  app.use('/analytics', analyticsRouter);
  app.use('/behavior', behaviorRouter);

  // 404 + error handlers.
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message || 'Internal error' });
  });

  return app;
}
