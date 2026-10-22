import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DB_PATH = join(__dirname, 'fires.db')

/** Open the database (creating the file if needed) and ensure the schema exists. */
export function openDb() {
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS fires (
      objectid        INTEGER PRIMARY KEY,
      incident_name   TEXT,
      county          TEXT,
      cause           TEXT,
      acres_burned    REAL,
      discovered_at   INTEGER,  -- epoch ms
      discovered_year INTEGER,
      region          TEXT,
      protection_type TEXT,
      lat             REAL,
      lon             REAL
    );
    CREATE INDEX IF NOT EXISTS idx_fires_county ON fires(county);
    CREATE INDEX IF NOT EXISTS idx_fires_cause  ON fires(cause);
    CREATE INDEX IF NOT EXISTS idx_fires_year   ON fires(discovered_year);
    CREATE INDEX IF NOT EXISTS idx_fires_acres  ON fires(acres_burned);
  `)
  return db
}
