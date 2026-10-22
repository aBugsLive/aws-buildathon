// Export the full dataset + static assets to public/data/ so the frontend can
// run in "static" mode (no backend) on Vercel. Run with: npm run export:static
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'data')

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const db = openDb()

  // Full fire dataset (only the fields the UI needs).
  const fires = db
    .prepare(
      `SELECT objectid, incident_name, county, cause, acres_burned,
              discovered_at, discovered_year, region, protection_type, lat, lon
       FROM fires`,
    )
    .all()
  writeFileSync(join(OUT_DIR, 'fires.json'), JSON.stringify(fires))

  // County boundaries (static) — copy alongside the data.
  const counties = readFileSync(
    join(__dirname, 'data', 'wa-counties.geojson'),
    'utf8',
  )
  writeFileSync(join(OUT_DIR, 'wa-counties.geojson'), counties)

  db.close()
  console.log(`Exported ${fires.length} fires + county boundaries to public/data/`)
}

main()
