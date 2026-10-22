/**
 * Fire-regime classification for Washington State.
 *
 * The single most important split in WA fire management is the Cascade crest:
 *  - West side: wet maritime forests; fire is infrequent but can be
 *    catastrophic and wind-driven.
 *  - East side: drier continental forests and shrub-steppe; fire is frequent
 *    and fuel/drought limited.
 *
 * The crest runs roughly along longitude -121.1 in WA, but it is not a clean
 * meridian. We primarily classify by DNR region name (authoritative when
 * present) and fall back to longitude.
 */

// DNR region names grouped by side of the crest. REGION_NAME is length-12 in
// the source schema, so values are short labels; we match case-insensitively
// on a normalized key.
const WEST_REGIONS = new Set([
  'pacific cascade',
  'south puget sound',
  'northwest',
  'olympic',
]);

const EAST_REGIONS = new Set([
  'northeast',
  'southeast',
  'central',
]);

/** Approximate longitude of the Cascade crest through WA. */
export const CREST_LON = -121.1;

function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Classify a normalized record into 'west', 'east', or 'unknown'.
 * @param {object} rec normalized record (see schema/record.js)
 * @returns {'west'|'east'|'unknown'}
 */
export function classifyRegime(rec) {
  const key = normKey(rec.region);
  if (WEST_REGIONS.has(key)) return 'west';
  if (EAST_REGIONS.has(key)) return 'east';

  // Fall back to longitude when region is missing/unrecognized.
  if (typeof rec.lon === 'number' && !Number.isNaN(rec.lon)) {
    return rec.lon < CREST_LON ? 'west' : 'east';
  }
  return 'unknown';
}
