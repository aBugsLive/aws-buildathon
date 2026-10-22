/**
 * Descriptive analytics derived directly from the historical fire-occurrence
 * records. Everything here uses only fields present in the source schema:
 * cause, location, elevation, the discovery -> control -> out timeline, acres
 * burned, stocking breakdown, fire class, and region.
 */

import { classifyRegime } from './regime.js';

const MS_PER_HOUR = 3600 * 1000;

/* ----------------------------- helpers ---------------------------------- */

function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function sum(arr, f) {
  return arr.reduce((s, x) => s + (f(x) || 0), 0);
}

function mean(arr, f) {
  const vals = arr.map(f).filter((v) => typeof v === 'number' && !Number.isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function median(nums) {
  const v = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function round(n, p = 2) {
  if (n == null || Number.isNaN(n)) return null;
  const f = Math.pow(10, p);
  return Math.round(n * f) / f;
}

function year(rec) {
  return rec.discovered ? rec.discovered.getUTCFullYear() : null;
}

/* --------------------------- size classes ------------------------------- */

/** NWCG fire size classes by acres burned. */
export function sizeClass(acres) {
  if (acres == null) return null;
  if (acres <= 0.25) return 'A';
  if (acres < 10) return 'B';
  if (acres < 100) return 'C';
  if (acres < 300) return 'D';
  if (acres < 1000) return 'E';
  if (acres < 5000) return 'F';
  return 'G';
}

/* --------------------------- public analytics --------------------------- */

/** Overall summary of a record set. */
export function summarize(records) {
  const acres = records.map((r) => r.acresBurned).filter((a) => typeof a === 'number');
  const years = records.map(year).filter((y) => y != null);
  return {
    count: records.length,
    totalAcresBurned: round(acres.reduce((a, b) => a + b, 0)),
    meanAcres: round(mean(records, (r) => r.acresBurned)),
    medianAcres: round(median(acres)),
    maxAcres: acres.length ? Math.max(...acres) : null,
    yearRange: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
    regimeBreakdown: countBy(records, classifyRegime),
  };
}

function countBy(records, keyFn) {
  const out = {};
  for (const r of records) {
    const k = keyFn(r) ?? 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Monthly and seasonal ignition + area-burned distribution. Uses DSCVR_MONTH
 * when present, else derives month from the discovery date.
 */
export function seasonality(records) {
  const monthName = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const months = {};
  for (let i = 0; i < 12; i++) {
    months[monthName[i]] = { ignitions: 0, acres: 0 };
  }

  for (const r of records) {
    let name = r.discoveryMonth && months[r.discoveryMonth] ? r.discoveryMonth : null;
    if (!name && r.discovered) name = monthName[r.discovered.getUTCMonth()];
    if (!name) continue;
    months[name].ignitions += 1;
    months[name].acres += r.acresBurned || 0;
  }

  for (const k of Object.keys(months)) months[k].acres = round(months[k].acres);

  const season = (m) => {
    if (['December', 'January', 'February'].includes(m)) return 'winter';
    if (['March', 'April', 'May'].includes(m)) return 'spring';
    if (['June', 'July', 'August'].includes(m)) return 'summer';
    return 'fall';
  };
  const seasons = { winter: { ignitions: 0, acres: 0 }, spring: { ignitions: 0, acres: 0 }, summer: { ignitions: 0, acres: 0 }, fall: { ignitions: 0, acres: 0 } };
  for (const m of Object.keys(months)) {
    const s = season(m);
    seasons[s].ignitions += months[m].ignitions;
    seasons[s].acres = round(seasons[s].acres + months[m].acres);
  }

  // Peak month by ignitions.
  const peak = Object.entries(months).sort((a, b) => b[1].ignitions - a[1].ignitions)[0];
  return { byMonth: months, bySeason: seasons, peakMonth: peak ? peak[0] : null };
}

/** Cause attribution, optionally broken out by regime. */
export function causeAttribution(records, { byRegime = true } = {}) {
  const overall = countBy(records, (r) => r.generalCause || 'Unknown');

  // Human vs lightning vs other heuristic on the general cause label.
  const bucket = (label) => {
    const l = String(label || '').toLowerCase();
    if (l.includes('lightning') || l.includes('natural')) return 'lightning';
    if (!label) return 'unknown';
    if (l.includes('under investigation') || l.includes('undetermined')) return 'undetermined';
    return 'human';
  };
  const buckets = countBy(records, (r) => bucket(r.generalCause));

  const result = { byGeneralCause: overall, byCauseBucket: buckets };
  if (byRegime) {
    const perRegime = {};
    for (const [regime, recs] of groupBy(records, classifyRegime)) {
      perRegime[regime] = {
        byCauseBucket: countBy(recs, (r) => bucket(r.generalCause)),
        count: recs.length,
      };
    }
    result.byRegime = perRegime;
  }
  return result;
}

/** NWCG size-class distribution plus heavy-tail share. */
export function sizeClassDistribution(records) {
  const dist = countBy(records, (r) => sizeClass(r.acresBurned));
  const totalAcres = sum(records, (r) => r.acresBurned);
  // Share of total acres coming from the largest 5% of fires (heavy tail).
  const sorted = records
    .map((r) => r.acresBurned)
    .filter((a) => typeof a === 'number')
    .sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(sorted.length * 0.05));
  const topAcres = sorted.slice(0, topN).reduce((a, b) => a + b, 0);
  return {
    byClass: dist,
    totalAcres: round(totalAcres),
    heavyTail: {
      topFivePercentCount: topN,
      topFivePercentAcres: round(topAcres),
      shareOfTotalAcres: totalAcres > 0 ? round(topAcres / totalAcres, 4) : null,
    },
  };
}

/**
 * Containment performance: discovery->control and discovery->out durations and
 * an effective growth rate (acres per hour to control).
 */
export function containmentPerformance(records) {
  const rows = [];
  for (const r of records) {
    if (!r.discovered) continue;
    const toControlHr = r.controlled ? (r.controlled - r.discovered) / MS_PER_HOUR : null;
    const toOutHr = r.out ? (r.out - r.discovered) / MS_PER_HOUR : null;
    const growthRate =
      toControlHr && toControlHr > 0 && typeof r.acresBurned === 'number'
        ? r.acresBurned / toControlHr
        : null;
    rows.push({ id: r.id, toControlHr, toOutHr, growthRate, acres: r.acresBurned });
  }
  const controlHrs = rows.map((x) => x.toControlHr).filter((v) => v != null && v >= 0);
  const outHrs = rows.map((x) => x.toOutHr).filter((v) => v != null && v >= 0);
  const growth = rows.map((x) => x.growthRate).filter((v) => v != null);
  return {
    n: rows.length,
    discoveryToControl_hr: { mean: round(mean(rows, (x) => (x.toControlHr >= 0 ? x.toControlHr : null))), median: round(median(controlHrs)) },
    discoveryToOut_hr: { mean: round(mean(rows, (x) => (x.toOutHr >= 0 ? x.toOutHr : null))), median: round(median(outHrs)) },
    effectiveGrowthRate_acres_hr: { mean: round(growth.reduce((a, b) => a + b, 0) / (growth.length || 1)), median: round(median(growth)) },
  };
}

/**
 * Fire-return interval and burn frequency for a spatial grouping.
 *
 * FRI (mean fire-return interval) for a spatial unit = (span of years observed)
 * / (number of fires in that unit). Burn frequency = fires per year. This is a
 * record-based approximation of point-level FRI; dendro/MTBS data give the true
 * landscape FRI, so results are a lower-bound screening metric.
 *
 * @param {Array} records
 * @param {'county'|'region'|'grid'} groupBy
 * @param {number} [gridDeg] grid cell size in degrees for 'grid' grouping
 */
export function fireReturnInterval(records, grouping = 'county', gridDeg = 0.1) {
  const keyFn = {
    county: (r) => r.county,
    region: (r) => r.region,
    grid: (r) =>
      r.lat != null && r.lon != null
        ? `${(Math.floor(r.lat / gridDeg) * gridDeg).toFixed(3)},${(Math.floor(r.lon / gridDeg) * gridDeg).toFixed(3)}`
        : null,
  }[grouping];
  if (!keyFn) throw new Error(`Unknown grouping "${grouping}". Use county | region | grid.`);

  const groups = groupBy ? groupByLocal(records, keyFn) : new Map();
  const out = [];
  for (const [unit, recs] of groups) {
    const years = recs.map(year).filter((y) => y != null);
    const span = years.length ? Math.max(...years) - Math.min(...years) + 1 : null;
    const fires = recs.length;
    out.push({
      unit,
      fires,
      yearSpan: span,
      burnFrequency_per_yr: span ? round(fires / span, 3) : null,
      meanReturnInterval_yr: span && fires > 0 ? round(span / fires, 2) : null,
      totalAcres: round(sum(recs, (r) => r.acresBurned)),
    });
  }
  out.sort((a, b) => (b.fires || 0) - (a.fires || 0));
  return out;
}

function groupByLocal(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/**
 * Risk/exposure prioritization. Expected-value style score per spatial unit:
 *
 *   score = burnFrequency(per yr) * meanSize(acres)
 *
 * This keeps hazard (how often) and consequence magnitude (how big) together,
 * reflecting the principle that risk != hazard. It is a screening ranking, not
 * a calibrated NVC; true net-value-change needs values-at-risk layers absent
 * from this schema.
 */
export function exposurePrioritization(records, grouping = 'region', gridDeg = 0.1) {
  const fri = fireReturnInterval(records, grouping, gridDeg);
  const scored = fri.map((u) => {
    const meanSize = u.fires > 0 ? u.totalAcres / u.fires : 0;
    const score = (u.burnFrequency_per_yr || 0) * meanSize;
    return {
      unit: u.unit,
      fires: u.fires,
      burnFrequency_per_yr: u.burnFrequency_per_yr,
      meanSize_acres: round(meanSize),
      expectedAnnualAcres: round((u.burnFrequency_per_yr || 0) * meanSize),
      priorityScore: round(score),
    };
  });
  scored.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  return scored;
}
