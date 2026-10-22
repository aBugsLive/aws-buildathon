// Pages the full WA DNR wildfire dataset from the ArcGIS REST service into SQLite.
// Run with: npm run sync
import { openDb } from './db.js'

const LAYER_URL =
  'https://gis.dnr.wa.gov/site3/rest/services/Public_Wildfire/WADNR_PUBLIC_WD_WildFire_Data/MapServer/2'

const OUT_FIELDS = [
  'OBJECTID',
  'INCIDENT_NM',
  'COUNTY_LABEL_NM',
  'FIREGCAUSE_LABEL_NM',
  'ACRES_BURNED',
  'DSCVR_DT',
  'REGION_NAME',
  'PROTECTION_TYPE',
  'LAT_COORD',
  'LON_COORD',
]

const PAGE_SIZE = 2000

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: OUT_FIELDS.join(','),
    orderByFields: 'OBJECTID ASC',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    returnGeometry: 'false',
    outSR: '4326',
    f: 'json',
  })
  const res = await fetch(`${LAYER_URL}/query?${params.toString()}`)
  if (!res.ok) throw new Error(`Request failed at offset ${offset}: ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'ArcGIS query error')
  return {
    rows: (data.features || []).map((f) => f.attributes),
    exceededLimit: Boolean(data.exceededTransferLimit),
  }
}

function toRecord(a) {
  const discoveredAt = a.DSCVR_DT ?? null
  return {
    objectid: a.OBJECTID,
    incident_name: a.INCIDENT_NM ?? null,
    county: a.COUNTY_LABEL_NM ?? null,
    cause: a.FIREGCAUSE_LABEL_NM ?? null,
    acres_burned: a.ACRES_BURNED ?? null,
    discovered_at: discoveredAt,
    discovered_year: discoveredAt ? new Date(discoveredAt).getUTCFullYear() : null,
    region: a.REGION_NAME ?? null,
    protection_type: a.PROTECTION_TYPE ?? null,
    lat: a.LAT_COORD ?? null,
    lon: a.LON_COORD ?? null,
  }
}

async function main() {
  const db = openDb()

  const upsert = db.prepare(`
    INSERT INTO fires (
      objectid, incident_name, county, cause, acres_burned,
      discovered_at, discovered_year, region, protection_type, lat, lon
    ) VALUES (
      @objectid, @incident_name, @county, @cause, @acres_burned,
      @discovered_at, @discovered_year, @region, @protection_type, @lat, @lon
    )
    ON CONFLICT(objectid) DO UPDATE SET
      incident_name   = excluded.incident_name,
      county          = excluded.county,
      cause           = excluded.cause,
      acres_burned    = excluded.acres_burned,
      discovered_at   = excluded.discovered_at,
      discovered_year = excluded.discovered_year,
      region          = excluded.region,
      protection_type = excluded.protection_type,
      lat             = excluded.lat,
      lon             = excluded.lon
  `)

  const insertMany = (records) => {
    db.exec('BEGIN')
    try {
      for (const r of records) upsert.run(r)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  let offset = 0
  let total = 0
  console.log('Syncing WA DNR wildfire data into SQLite…')

  // Loop until a page comes back smaller than PAGE_SIZE and no transfer limit flag.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows, exceededLimit } = await fetchPage(offset)
    if (rows.length === 0) break

    insertMany(rows.map(toRecord))
    total += rows.length
    process.stdout.write(`  fetched ${total} rows\r`)

    offset += rows.length
    if (rows.length < PAGE_SIZE && !exceededLimit) break
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM fires').get().n
  console.log(`\nDone. ${total} rows synced this run. Table now holds ${count} rows.`)
  db.close()
}

main().catch((err) => {
  console.error('\nSync failed:', err.message)
  process.exit(1)
})
