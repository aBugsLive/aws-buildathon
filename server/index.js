import express from 'express'
import cors from 'cors'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb } from './db.js'
import { exposurePrioritization } from './models/analytics.js'
import {
  parseAsOf,
  buildSeasonSql,
  buildLargestSql,
  summarizeYears,
  isoDate,
} from '../src/seasonWindow.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = openDb()
const app = express()
app.use(cors())

const PORT = process.env.PORT || 4000

// WA county boundaries (static), loaded once at startup.
const COUNTY_GEOJSON = JSON.parse(
  readFileSync(join(__dirname, 'data', 'wa-counties.geojson'), 'utf8'),
)

// Parse a YYYY-MM-DD string into epoch ms (UTC). Returns null if invalid.
function parseDateMs(str, endOfDay = false) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const ms = Date.parse(`${str}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Build a WHERE clause + params from query filters shared by several endpoints.
 * Supported query params: county, cause, protection, minAcres, year,
 * startDate (YYYY-MM-DD), endDate (YYYY-MM-DD).
 */
function buildFilters(query) {
  const clauses = []
  const params = {}

  // Multi-value filter: accepts a comma-separated list, builds `col IN (...)`.
  const addInClause = (raw, column, prefix) => {
    if (!raw || raw === 'ALL') return
    const values = String(raw)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v !== 'ALL')
    if (!values.length) return
    const keys = values.map((v, i) => {
      const key = `${prefix}${i}`
      params[key] = v
      return `@${key}`
    })
    clauses.push(`${column} IN (${keys.join(', ')})`)
  }

  addInClause(query.county, 'county', 'county')
  addInClause(query.cause, 'cause', 'cause')
  addInClause(query.protection, 'protection_type', 'protection')

  if (query.minAcres) {
    const n = Number(query.minAcres)
    if (!Number.isNaN(n) && n > 0) {
      clauses.push('acres_burned >= @minAcres')
      params.minAcres = n
    }
  }
  if (query.year && query.year !== 'ALL') {
    const y = Number(query.year)
    if (!Number.isNaN(y)) {
      clauses.push('discovered_year = @year')
      params.year = y
    }
  }

  // Date range on discovery date (epoch ms). Either bound is optional.
  const startMs = parseDateMs(query.startDate, false)
  if (startMs != null) {
    clauses.push('discovered_at >= @startMs')
    params.startMs = startMs
  }
  const endMs = parseDateMs(query.endDate, true)
  if (endMs != null) {
    clauses.push('discovered_at <= @endMs')
    params.endMs = endMs
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

// Health check
app.get('/api/health', (_req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS n FROM fires').get()
  res.json({ ok: true, rows: row.n })
})

// Distinct filter options (counties, causes, years)
app.get('/api/options', (_req, res) => {
  const counties = db
    .prepare('SELECT DISTINCT county FROM fires WHERE county IS NOT NULL ORDER BY county')
    .all()
    .map((r) => r.county)
  const causes = db
    .prepare('SELECT DISTINCT cause FROM fires WHERE cause IS NOT NULL ORDER BY cause')
    .all()
    .map((r) => r.cause)
  const years = db
    .prepare(
      'SELECT DISTINCT discovered_year AS y FROM fires WHERE discovered_year IS NOT NULL ORDER BY y DESC',
    )
    .all()
    .map((r) => r.y)
  const protections = db
    .prepare(
      'SELECT DISTINCT protection_type FROM fires WHERE protection_type IS NOT NULL ORDER BY protection_type',
    )
    .all()
    .map((r) => r.protection_type)

  // Full date range of the data, as YYYY-MM-DD, for the date-picker bounds.
  const range = db
    .prepare(
      'SELECT MIN(discovered_at) AS min, MAX(discovered_at) AS max FROM fires WHERE discovered_at IS NOT NULL',
    )
    .get()
  const toYmd = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null)
  const dateRange = { min: toYmd(range.min), max: toYmd(range.max) }

  res.json({ counties, causes, years, protections, dateRange })
})

// Filtered list of incidents
app.get('/api/fires', (req, res) => {
  const { where, params } = buildFilters(req.query)
  const limit = Math.min(Number(req.query.limit) || 200, 5000)
  const rows = db
    .prepare(
      `SELECT objectid, incident_name, county, cause, acres_burned,
              discovered_at, discovered_year, region, protection_type, lat, lon
       FROM fires ${where}
       ORDER BY acres_burned DESC
       LIMIT @limit`,
    )
    .all({ ...params, limit })
  res.json(rows)
})

// Filtered incidents as a GeoJSON FeatureCollection for the map.
// Only rows with valid coordinates are included.
app.get('/api/fires.geojson', (req, res) => {
  const { where, params } = buildFilters(req.query)
  const coordClause = where
    ? `${where} AND lat IS NOT NULL AND lon IS NOT NULL`
    : 'WHERE lat IS NOT NULL AND lon IS NOT NULL'

  const rows = db
    .prepare(
      `SELECT objectid, incident_name, county, cause, acres_burned,
              discovered_at, discovered_year, region, protection_type, lat, lon
       FROM fires ${coordClause}`,
    )
    .all(params)

  const features = rows.map((r) => ({
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
    },
  }))

  res.json({ type: 'FeatureCollection', features })
})

// Exact great-circle distance in miles between two WGS84 points.
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613 // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Fires within a radius (miles) of a clicked point, honoring the usual filters.
// Query params: lat, lon, radius (miles) + county/cause/protection/year/minAcres.
// Returns a GeoJSON FeatureCollection plus a summary block.
app.get('/api/fires/within', (req, res) => {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  const radius = Number(req.query.radius)
  if (
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    Number.isNaN(radius) ||
    radius <= 0
  ) {
    return res
      .status(400)
      .json({ error: 'lat, lon and a positive radius (miles) are required' })
  }

  const { where, params } = buildFilters(req.query)

  // Cheap bounding-box pre-filter so we only haversine a small subset.
  // ~69 miles per degree latitude; longitude shrinks by cos(lat).
  const latDelta = radius / 69
  const lonDelta = radius / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  const bboxClauses = [
    'lat IS NOT NULL',
    'lon IS NOT NULL',
    'lat BETWEEN @latMin AND @latMax',
    'lon BETWEEN @lonMin AND @lonMax',
  ]
  const bboxParams = {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
  }
  const fullWhere = where
    ? `${where} AND ${bboxClauses.join(' AND ')}`
    : `WHERE ${bboxClauses.join(' AND ')}`

  const candidates = db
    .prepare(
      `SELECT objectid, incident_name, county, cause, acres_burned,
              discovered_at, discovered_year, region, protection_type, lat, lon
       FROM fires ${fullWhere}`,
    )
    .all({ ...params, ...bboxParams })

  // Exact distance filter.
  const within = []
  let totalAcres = 0
  for (const r of candidates) {
    const dist = haversineMiles(lat, lon, r.lat, r.lon)
    if (dist <= radius) {
      within.push({ ...r, distance_mi: Math.round(dist * 100) / 100 })
      totalAcres += r.acres_burned || 0
    }
  }
  within.sort((a, b) => a.distance_mi - b.distance_mi)

  const features = within.map((r) => ({
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
      distance_mi: r.distance_mi,
    },
  }))

  res.json({
    center: { lat, lon },
    radius,
    summary: {
      count: within.length,
      totalAcres: Math.round(totalAcres),
      avgAcres: within.length ? Math.round(totalAcres / within.length) : 0,
    },
    geojson: { type: 'FeatureCollection', features },
  })
})

// County boundaries with per-county fire counts (honoring filters), for the
// choropleth. Returns a GeoJSON FeatureCollection; each feature gets fire_count
// and total_acres properties. Also returns the max count for color scaling.
app.get('/api/counties.geojson', (req, res) => {
  const { where, params } = buildFilters(req.query)
  const stats = db
    .prepare(
      `SELECT county,
              COUNT(*) AS fire_count,
              COALESCE(SUM(acres_burned), 0) AS total_acres
       FROM fires ${where}
       GROUP BY county`,
    )
    .all(params)

  const byCounty = new Map(
    stats.map((s) => [s.county, { fire_count: s.fire_count, total_acres: s.total_acres }]),
  )

  let maxCount = 0
  const features = COUNTY_GEOJSON.features.map((f) => {
    const stat = byCounty.get(f.properties.name) || { fire_count: 0, total_acres: 0 }
    if (stat.fire_count > maxCount) maxCount = stat.fire_count
    return {
      ...f,
      properties: {
        ...f.properties,
        fire_count: stat.fire_count,
        total_acres: Math.round(stat.total_acres),
      },
    }
  })

  res.json({ type: 'FeatureCollection', features, maxCount })
})

// Map Tom's model (exposure prioritization) over the filtered fire records,
// gridded, and return it as a GeoJSON grid of risk cells.
//   priorityScore = burnFrequency(per yr) * meanSize(acres)   [analytics.js]
// Each cell is a gridDeg x gridDeg square; `unit` is the cell's SW corner.
app.get('/api/model/exposure.geojson', (req, res) => {
  const { where, params } = buildFilters(req.query)
  const gridDeg = Number(req.query.gridDeg) || 0.1

  const coordWhere = where
    ? `${where} AND lat IS NOT NULL AND lon IS NOT NULL`
    : 'WHERE lat IS NOT NULL AND lon IS NOT NULL'

  const rows = db
    .prepare(
      `SELECT objectid, county, region, acres_burned, discovered_at, lat, lon
       FROM fires ${coordWhere}`,
    )
    .all(params)

  // Adapt DB rows to the shape the model library expects (see models/record.js).
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

  res.json({ type: 'FeatureCollection', features, maxScore, gridDeg })
})

// Summary KPIs + aggregates for the dashboard
app.get('/api/summary', (req, res) => {
  const { where, params } = buildFilters(req.query)

  const kpis = db
    .prepare(
      `SELECT
         COUNT(*)             AS totalFires,
         COALESCE(SUM(acres_burned), 0) AS totalAcres,
         COALESCE(AVG(acres_burned), 0) AS avgAcres,
         COALESCE(MAX(acres_burned), 0) AS maxAcres
       FROM fires ${where}`,
    )
    .get(params)

  const largest = db
    .prepare(
      `SELECT incident_name, acres_burned, county
       FROM fires ${where}
       ORDER BY acres_burned DESC
       LIMIT 1`,
    )
    .get(params)

  const byCause = db
    .prepare(
      `SELECT COALESCE(cause, 'Unknown') AS name, COUNT(*) AS value
       FROM fires ${where}
       GROUP BY name
       ORDER BY value DESC`,
    )
    .all(params)

  const byCounty = db
    .prepare(
      `SELECT COALESCE(county, 'Unknown') AS name,
              ROUND(SUM(acres_burned)) AS acres
       FROM fires ${where}
       GROUP BY name
       ORDER BY acres DESC
       LIMIT 10`,
    )
    .all(params)

  const yearWhere = where
    ? `${where} AND discovered_year IS NOT NULL`
    : 'WHERE discovered_year IS NOT NULL'
  const byYear = db
    .prepare(
      `SELECT discovered_year AS year, COUNT(*) AS fires,
              ROUND(SUM(acres_burned)) AS acres
       FROM fires ${yearWhere}
       GROUP BY discovered_year
       ORDER BY discovered_year ASC`,
    )
    .all(params)

  res.json({ kpis, largest, byCause, byCounty, byYear })
})

// Northeast fires and acres on the same calendar dates, every year on record.
// mode=week (7 days ending on asOf) or mode=month. asOf=YYYY-MM-DD.
app.get('/api/season', (req, res) => {
  const mode = req.query.mode === 'month' ? 'month' : 'week'
  const asOf = parseAsOf(typeof req.query.asOf === 'string' ? req.query.asOf : null)
  const { sql, params } = buildSeasonSql(mode, asOf)
  const yearRows = db.prepare(sql).all(params)
  const summary = summarizeYears(yearRows, asOf.getFullYear())
  const largestQuery = buildLargestSql(mode, asOf)
  const largestThisYear =
    db.prepare(largestQuery.sql).get(largestQuery.params) || null
  const databaseRows = db.prepare('SELECT COUNT(*) AS n FROM fires').get().n
  res.json({
    region: 'NORTHEAST',
    mode,
    asOf: isoDate(asOf),
    databaseRows,
    largestThisYear,
    ...summary,
  })
})

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
})
