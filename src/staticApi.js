// Static-mode API: mirrors server/index.js endpoints entirely in the browser,
// reading a bundled snapshot of the dataset. Used when VITE_DATA_MODE=static
// (e.g. on Vercel, where there is no backend). Logic intentionally matches the
// server so the two modes behave identically.
import { exposurePrioritization } from './lib/analytics.js'
import { weekPairs, summarizeYears } from './seasonWindow.js'

const BASE = import.meta.env.BASE_URL || '/'
const DATA_URL = `${BASE}data/fires.json`.replace(/\/{2,}/g, '/')
const COUNTIES_URL = `${BASE}data/wa-counties.geojson`.replace(/\/{2,}/g, '/')

let _fires = null
let _counties = null

async function loadFires() {
  if (_fires) return _fires
  const res = await fetch(DATA_URL)
  if (!res.ok) throw new Error(`Could not load dataset (${res.status})`)
  _fires = await res.json()
  return _fires
}

async function loadCounties() {
  if (_counties) return _counties
  const res = await fetch(COUNTIES_URL)
  if (!res.ok) throw new Error(`Could not load county boundaries (${res.status})`)
  _counties = await res.json()
  return _counties
}

// --- filtering (mirrors server buildFilters) ---
function toList(raw) {
  if (!raw || raw === 'ALL') return null
  const values = String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v && v !== 'ALL')
  return values.length ? new Set(values) : null
}

function dateMs(str, endOfDay) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const ms = Date.parse(`${str}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(ms) ? null : ms
}

function applyFilters(rows, f = {}) {
  const counties = toList(f.county)
  const causes = toList(f.cause)
  const protections = toList(f.protection)
  const minAcres = f.minAcres ? Number(f.minAcres) : 0
  const startMs = dateMs(f.startDate, false)
  const endMs = dateMs(f.endDate, true)
  const year = f.year && f.year !== 'ALL' ? Number(f.year) : null

  return rows.filter((r) => {
    if (counties && !counties.has(r.county)) return false
    if (causes && !causes.has(r.cause)) return false
    if (protections && !protections.has(r.protection_type)) return false
    if (minAcres > 0 && (r.acres_burned || 0) < minAcres) return false
    if (startMs != null && !(r.discovered_at >= startMs)) return false
    if (endMs != null && !(r.discovered_at <= endMs)) return false
    if (year != null && r.discovered_year !== year) return false
    return true
  })
}

function featureOf(r, extra = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    properties: {
      objectid: r.objectid,
      incident_name: r.incident_name,
      county: r.county,
      cause: r.cause,
      acres_burned: r.acres_burned,
      discovered_at: r.discovered_at,
      discovered_year: r.discovered_year,
      region: r.region,
      protection_type: r.protection_type,
      ...extra,
    },
  }
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// --- endpoint equivalents ---
export async function fetchOptions() {
  const rows = await loadFires()
  const uniq = (key) =>
    [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort()
  const years = [...new Set(rows.map((r) => r.discovered_year).filter(Boolean))].sort(
    (a, b) => b - a,
  )
  const dates = rows.map((r) => r.discovered_at).filter(Boolean)
  const toYmd = (ms) => new Date(ms).toISOString().slice(0, 10)
  return {
    counties: uniq('county'),
    causes: uniq('cause'),
    protections: uniq('protection_type'),
    years,
    dateRange: dates.length
      ? { min: toYmd(Math.min(...dates)), max: toYmd(Math.max(...dates)) }
      : { min: null, max: null },
  }
}

export async function fetchSummary(filters) {
  const rows = applyFilters(await loadFires(), filters)
  const totalFires = rows.length
  let totalAcres = 0
  let maxAcres = 0
  let largest = null
  const causeMap = new Map()
  const countyMap = new Map()
  const yearMap = new Map()

  for (const r of rows) {
    const a = r.acres_burned || 0
    totalAcres += a
    if (a > maxAcres) {
      maxAcres = a
      largest = { incident_name: r.incident_name, acres_burned: a, county: r.county }
    }
    const c = r.cause || 'Unknown'
    causeMap.set(c, (causeMap.get(c) || 0) + 1)
    const ct = r.county || 'Unknown'
    countyMap.set(ct, (countyMap.get(ct) || 0) + a)
    if (r.discovered_year) {
      const y = yearMap.get(r.discovered_year) || { fires: 0, acres: 0 }
      y.fires += 1
      y.acres += a
      yearMap.set(r.discovered_year, y)
    }
  }

  const byCause = [...causeMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  const byCounty = [...countyMap.entries()]
    .map(([name, acres]) => ({ name, acres: Math.round(acres) }))
    .sort((a, b) => b.acres - a.acres)
    .slice(0, 10)
  const byYear = [...yearMap.entries()]
    .map(([year, v]) => ({ year, fires: v.fires, acres: Math.round(v.acres) }))
    .sort((a, b) => a.year - b.year)

  return {
    kpis: {
      totalFires,
      totalAcres,
      avgAcres: totalFires ? totalAcres / totalFires : 0,
      maxAcres,
    },
    largest,
    byCause,
    byCounty,
    byYear,
  }
}

export async function fetchFires(filters) {
  const rows = applyFilters(await loadFires(), filters)
  const limit = Math.min(filters?.limit ?? 100, 5000)
  return [...rows]
    .sort((a, b) => (b.acres_burned || 0) - (a.acres_burned || 0))
    .slice(0, limit)
}

export async function fetchFiresGeoJSON(filters) {
  const rows = applyFilters(await loadFires(), filters).filter(
    (r) => r.lat != null && r.lon != null,
  )
  return { type: 'FeatureCollection', features: rows.map((r) => featureOf(r)) }
}

export async function fetchCountiesGeoJSON(filters) {
  const rows = applyFilters(await loadFires(), filters)
  const counties = await loadCounties()
  const stats = new Map()
  for (const r of rows) {
    const s = stats.get(r.county) || { fire_count: 0, total_acres: 0 }
    s.fire_count += 1
    s.total_acres += r.acres_burned || 0
    stats.set(r.county, s)
  }
  let maxCount = 0
  const features = counties.features.map((f) => {
    const s = stats.get(f.properties.name) || { fire_count: 0, total_acres: 0 }
    if (s.fire_count > maxCount) maxCount = s.fire_count
    return {
      ...f,
      properties: {
        ...f.properties,
        fire_count: s.fire_count,
        total_acres: Math.round(s.total_acres),
      },
    }
  })
  return { type: 'FeatureCollection', features, maxCount }
}

export async function fetchExposureModel(filters) {
  const rows = applyFilters(await loadFires(), filters).filter(
    (r) => r.lat != null && r.lon != null,
  )
  const gridDeg = 0.1
  const records = rows.map((r) => ({
    id: r.objectid,
    county: r.county,
    region: r.region,
    acresBurned: r.acres_burned,
    lat: r.lat,
    lon: r.lon,
    discovered: r.discovered_at ? new Date(r.discovered_at) : null,
  }))
  const scored = exposurePrioritization(records, 'grid', gridDeg)
  let maxScore = 0
  const features = []
  for (const cell of scored) {
    if (!cell.unit || typeof cell.unit !== 'string') continue
    const [latStr, lonStr] = cell.unit.split(',')
    const lat0 = Number(latStr)
    const lon0 = Number(lonStr)
    if (Number.isNaN(lat0) || Number.isNaN(lon0)) continue
    const score = cell.priorityScore || 0
    if (score > maxScore) maxScore = score
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [lon0, lat0],
            [lon0 + gridDeg, lat0],
            [lon0 + gridDeg, lat0 + gridDeg],
            [lon0, lat0 + gridDeg],
            [lon0, lat0],
          ],
        ],
      },
      properties: {
        fires: cell.fires,
        burnFrequency_per_yr: cell.burnFrequency_per_yr,
        meanSize_acres: cell.meanSize_acres,
        expectedAnnualAcres: cell.expectedAnnualAcres,
        priorityScore: score,
      },
    })
  }
  return { type: 'FeatureCollection', features, maxScore, gridDeg }
}

export async function fetchFiresWithin({ lat, lon, radius, ...filters }) {
  const rows = applyFilters(await loadFires(), filters).filter(
    (r) => r.lat != null && r.lon != null,
  )
  const within = []
  let totalAcres = 0
  for (const r of rows) {
    const dist = haversineMiles(lat, lon, r.lat, r.lon)
    if (dist <= radius) {
      within.push({ ...r, distance_mi: Math.round(dist * 100) / 100 })
      totalAcres += r.acres_burned || 0
    }
  }
  within.sort((a, b) => a.distance_mi - b.distance_mi)
  return {
    center: { lat, lon },
    radius,
    summary: {
      count: within.length,
      totalAcres: Math.round(totalAcres),
      avgAcres: within.length ? Math.round(totalAcres / within.length) : 0,
    },
    geojson: {
      type: 'FeatureCollection',
      features: within.map((r) => featureOf(r, { distance_mi: r.distance_mi })),
    },
  }
}

export async function fetchSeason({ mode, asOf }) {
  const rows = await loadFires()
  const ref = asOf ? new Date(`${asOf}T00:00:00`) : new Date()
  const thisYear = ref.getFullYear()

  // Build the set of (month, day) pairs (week) or month (month mode).
  let matchFn
  if (mode === 'month') {
    const m = ref.getMonth() + 1
    matchFn = (d) => d.getUTCMonth() + 1 === m
  } else {
    const pairs = weekPairs(ref) // [{month, day}, ...]
    const key = (mo, dy) => `${mo}-${dy}`
    const set = new Set(pairs.map((p) => key(p.month, p.day)))
    matchFn = (d) => set.has(key(d.getUTCMonth() + 1, d.getUTCDate()))
  }

  const ne = rows.filter(
    (r) => r.region === 'NORTHEAST' && r.discovered_at != null,
  )
  const yearMap = new Map()
  let largest = null
  for (const r of ne) {
    const d = new Date(r.discovered_at)
    if (!matchFn(d)) continue
    const y = d.getUTCFullYear()
    const agg = yearMap.get(y) || { year: y, fires: 0, acres: 0 }
    agg.fires += 1
    agg.acres += r.acres_burned || 0
    yearMap.set(y, agg)
    if (
      y === thisYear &&
      (!largest || (r.acres_burned || 0) > (largest.acres_burned || 0))
    ) {
      largest = {
        incident_name: r.incident_name,
        county: r.county,
        cause: r.cause,
        acres_burned: r.acres_burned,
        discovered_at: r.discovered_at,
      }
    }
  }

  const yearRows = [...yearMap.values()].map((v) => ({
    year: v.year,
    fires: v.fires,
    acres: Math.round(v.acres * 100) / 100,
  }))
  const summary = summarizeYears(yearRows, thisYear)

  return {
    region: 'NORTHEAST',
    mode: mode === 'month' ? 'month' : 'week',
    asOf: asOf || null,
    databaseRows: rows.length,
    largestThisYear: largest,
    ...summary,
  }
}
