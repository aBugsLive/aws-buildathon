// Data source switch:
//   VITE_DATA_MODE=static  -> read a bundled JSON snapshot, all logic in-browser
//                             (used on Vercel / any static host, no backend)
//   otherwise (default)    -> talk to the live SQLite-backed API (local dev)
import * as staticApi from './staticApi.js'

const DATA_MODE = import.meta.env.VITE_DATA_MODE || 'live'
const USE_STATIC = DATA_MODE === 'static'

// Talks to the local SQLite-backed API (see server/index.js).
// Override with VITE_API_BASE if the API runs elsewhere.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

function buildQuery(filters = {}) {
  const params = new URLSearchParams()
  if (filters.county && filters.county !== 'ALL') params.set('county', filters.county)
  if (filters.cause && filters.cause !== 'ALL') params.set('cause', filters.cause)
  if (filters.protection && filters.protection !== 'ALL')
    params.set('protection', filters.protection)
  if (filters.year && filters.year !== 'ALL') params.set('year', String(filters.year))
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  if (filters.minAcres) params.set('minAcres', String(filters.minAcres))
  if (filters.limit) params.set('limit', String(filters.limit))
  return params.toString()
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  return res.json()
}

/** Distinct filter options: { counties, causes, protections, years, dateRange }. */
export function fetchOptions() {
  if (USE_STATIC) return staticApi.fetchOptions()
  return getJson('/api/options')
}

/** Dashboard aggregates + KPIs for the given filters. */
export function fetchSummary(filters) {
  if (USE_STATIC) return staticApi.fetchSummary(filters)
  const qs = buildQuery(filters)
  return getJson(`/api/summary${qs ? `?${qs}` : ''}`)
}

/** Filtered incident list (largest first). */
export function fetchFires(filters) {
  if (USE_STATIC) return staticApi.fetchFires(filters)
  const qs = buildQuery({ ...filters, limit: filters.limit ?? 100 })
  return getJson(`/api/fires${qs ? `?${qs}` : ''}`)
}

/**
 * Northeast historical severity for a calendar window.
 * @param {{ mode: 'week'|'month', asOf: string }} query
 */
export function fetchSeason({ mode, asOf }) {
  if (USE_STATIC) return staticApi.fetchSeason({ mode, asOf })
  const params = new URLSearchParams({ mode })
  if (asOf) params.set('asOf', asOf)
  return getJson(`/api/season?${params.toString()}`)
}

/** Filtered incidents as a GeoJSON FeatureCollection for the map. */
export function fetchFiresGeoJSON(filters) {
  if (USE_STATIC) return staticApi.fetchFiresGeoJSON(filters)
  const qs = buildQuery(filters)
  return getJson(`/api/fires.geojson${qs ? `?${qs}` : ''}`)
}

/**
 * County boundaries with per-county fire counts for the choropleth.
 * Returns a GeoJSON FeatureCollection with a `maxCount` field.
 */
export function fetchCountiesGeoJSON(filters) {
  if (USE_STATIC) return staticApi.fetchCountiesGeoJSON(filters)
  const qs = buildQuery(filters)
  return getJson(`/api/counties.geojson${qs ? `?${qs}` : ''}`)
}

/**
 * Exposure/risk model surface (Tom's exposurePrioritization), gridded.
 * Returns a GeoJSON grid with `maxScore` for color scaling.
 */
export function fetchExposureModel(filters) {
  if (USE_STATIC) return staticApi.fetchExposureModel(filters)
  const qs = buildQuery(filters)
  return getJson(`/api/model/exposure.geojson${qs ? `?${qs}` : ''}`)
}

/**
 * Fires within `radius` miles of a point, honoring the active filters.
 * Returns { center, radius, summary, geojson }.
 */
export function fetchFiresWithin({ lat, lon, radius, ...filters }) {
  if (USE_STATIC) return staticApi.fetchFiresWithin({ lat, lon, radius, ...filters })
  const params = new URLSearchParams(buildQuery(filters))
  params.set('lat', String(lat))
  params.set('lon', String(lon))
  params.set('radius', String(radius))
  return getJson(`/api/fires/within?${params.toString()}`)
}
