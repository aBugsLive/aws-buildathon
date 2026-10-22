/**
 * Standard surface fuel models (Anderson 13 subset) with the parameters the
 * Rothermel spread model needs. Values are the commonly published figures.
 *
 * Units:
 *   w0   oven-dry fuel load             lb/ft^2
 *   sigma surface-area-to-volume ratio  ft^-1
 *   depth fuel bed depth                ft
 *   mx    dead fuel moisture of extinction (fraction)
 *   h     low heat content             BTU/lb
 *   rhoP  oven-dry particle density     lb/ft^3
 *
 * These are intentionally the dead-fuel-dominant static models; dynamic
 * live/herbaceous load transfer is out of scope for this reference impl.
 */
export const FUEL_MODELS = {
  // Short grass
  GR1: { key: 'GR1', name: 'Short grass', w0: 0.034, sigma: 3500, depth: 0.4, mx: 0.15, h: 8000, rhoP: 32 },
  // Timber grass/understory
  FM2: { key: 'FM2', name: 'Timber grass and understory', w0: 0.184, sigma: 3000, depth: 1.0, mx: 0.15, h: 8000, rhoP: 32 },
  // Chaparral / brush
  FM4: { key: 'FM4', name: 'Chaparral', w0: 0.230, sigma: 2000, depth: 6.0, mx: 0.20, h: 8000, rhoP: 32 },
  // Dormant brush
  FM6: { key: 'FM6', name: 'Dormant brush', w0: 0.138, sigma: 1750, depth: 2.5, mx: 0.25, h: 8000, rhoP: 32 },
  // Timber litter and understory (closed timber)
  FM8: { key: 'FM8', name: 'Closed timber litter', w0: 0.069, sigma: 2000, depth: 0.2, mx: 0.30, h: 8000, rhoP: 32 },
  // Hardwood/long-needle litter
  FM9: { key: 'FM9', name: 'Hardwood litter', w0: 0.134, sigma: 2500, depth: 0.2, mx: 0.25, h: 8000, rhoP: 32 },
  // Timber with litter and understory
  FM10: { key: 'FM10', name: 'Timber (litter and understory)', w0: 0.138, sigma: 2000, depth: 1.0, mx: 0.25, h: 8000, rhoP: 32 },
  // Logging slash (light)
  FM11: { key: 'FM11', name: 'Light logging slash', w0: 0.345, sigma: 1500, depth: 1.0, mx: 0.15, h: 8000, rhoP: 32 },
};

/** Return a fuel model by key, throwing a clear error if unknown. */
export function getFuelModel(key) {
  const m = FUEL_MODELS[String(key || '').toUpperCase()];
  if (!m) {
    throw new Error(
      `Unknown fuel model "${key}". Valid keys: ${Object.keys(FUEL_MODELS).join(', ')}`
    );
  }
  return m;
}
